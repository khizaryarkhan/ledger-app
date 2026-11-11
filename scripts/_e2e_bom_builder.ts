/**
 * Dev-database check of the BOM Builder save path (lib/inventory/bom-save.ts) and the
 * 0134 unique indexes. Creates ONE throwaway BOM in the first org that has a producible
 * and two consumable items, exercises it, then deletes it. Refuses to run against
 * anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_bom_builder.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

let failed = 0;
const check = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!pass) failed++; };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.DATABASE_URL.includes("ep-ancient-math-ab44z2jn")) throw new Error("Refusing to run: not the dev endpoint");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { createBom, replaceBom, loadBomFull, suggestFor, BomValidationError } = await import("../lib/inventory/bom-save");
  const { kindOf } = await import("../lib/inventory/item-kinds");

  const items = await db.select({ id: S.apItems.id, orgId: S.apItems.orgId, productType: S.apItems.productType, baseUom: S.apItems.baseUom, name: S.apItems.name }).from(S.apItems);
  const byOrg = new Map<string, typeof items>();
  for (const i of items) (byOrg.get(i.orgId) ?? byOrg.set(i.orgId, []).get(i.orgId)!).push(i);
  let orgId = "", out: any, ins: any[] = [];
  for (const [o, list] of byOrg) {
    const fp = list.find(i => kindOf(i.productType).producible);
    const rm = list.filter(i => kindOf(i.productType).consumable && i.id !== fp?.id);
    const stocked = rm.filter(i => kindOf(i.productType).tracked);
    if (fp && rm.length >= 2 && stocked.length >= 1) { orgId = o; out = fp; const sub = stocked[0]; ins = [...rm.filter(i => i.id !== sub.id).slice(0, 2), sub]; if (ins.length < 3) continue; break; }
  }
  if (!orgId) { console.log("No org with a producible + 2 consumable items on dev; nothing to test."); return; }
  console.log(`Org ${orgId}; output ${out.name}; inputs ${ins.map(i => i.name).join(", ")}`);

  const code = "E2E_BOM_" + Date.now();
  const input = {
    code, name: "E2E throwaway", outputItemId: out.id, outputSkuId: null, status: "Draft", batchType: "Output", batchSize: 100, expYield: 98,
    processingStep: null, notes: null, outputs: [{ skuId: null, qty: 1 }],
    inputs: [{ itemId: ins[0].id, qty: 5, uom: ins[0].baseUom }, { itemId: ins[1].id, qty: 2, uom: ins[1].baseUom }],
    packs: [], ops: [],
  } as any;
  const msg = (e: any) => String(e?.message ?? e) + String(e?.cause?.message ?? "");

  // duplicates are refused before anything is written
  try { await createBom(orgId, { ...input, code: code + "D", inputs: [input.inputs[0], input.inputs[0]] }); check("duplicate ingredient refused", false); }
  catch (e: any) { check("duplicate ingredient refused", e instanceof BomValidationError && /more than once/.test(e.message), e.message); }
  const stray = await db.select({ id: S.boms.id }).from(S.boms).where(and(eq(S.boms.orgId, orgId), eq(S.boms.code, code + "D")));
  check("nothing was written for the refused save", stray.length === 0);

  const id = await createBom(orgId, input);
  try {
    const full = await loadBomFull(orgId, id);
    check("created and read back", !!full && full.input.inputs.length === 2 && full.input.outputs.length === 1);

    // DB-level guard: the legacy line route could still insert a duplicate if the index were missing
    try { await db.insert(S.bomLines).values({ orgId, bomId: id, role: "input", itemId: ins[0].id, qty: "1", uom: ins[0].baseUom } as any); check("index refuses a duplicate input row", false); }
    catch (e: any) { check("index refuses a duplicate input row", /bom_lines_input_unique|duplicate key|Failed query/i.test(msg(e)), msg(e).slice(0, 90)); }
    try { await db.insert(S.bomLines).values({ orgId, bomId: id, role: "output", itemId: out.id, skuId: null, qty: "1" } as any); check("index refuses a second base-unit output", false); }
    catch (e: any) { check("index refuses a second base-unit output", /bom_lines_output_unique|duplicate key|Failed query/i.test(msg(e)), msg(e).slice(0, 90)); }

    // edit with the right token works; a stale token is a 409
    await replaceBom(orgId, id, { ...input, inputs: [{ ...input.inputs[0], qty: 9 }, input.inputs[1]] }, full!.updatedAt);
    const after = await loadBomFull(orgId, id);
    check("edit replaced the lines", after!.input.inputs.find(i => i.itemId === ins[0].id)?.qty === 9);
    try { await replaceBom(orgId, id, input, full!.updatedAt); check("stale save refused", false); }
    catch (e: any) { check("stale save refused with 409", e instanceof BomValidationError && e.status === 409, e.message); }
    const kept = await loadBomFull(orgId, id);
    check("refused edit left the BOM intact", kept!.input.inputs.length === 2 && kept!.input.inputs.find(i => i.itemId === ins[0].id)?.qty === 9);

    // same code on another BOM is refused
    try { await createBom(orgId, { ...input }); check("duplicate BOM id refused", false); }
    catch (e: any) { check("duplicate BOM id refused", e instanceof BomValidationError && /already uses/.test(e.message), e.message); }

    // slice 1: substitutes and allowed SKUs round-trip, and bad ones are refused before any write
    const withSub = { ...input, status: "Active", code: code + "S", inputs: [{ ...input.inputs[0], substitutes: [{ itemId: ins[2].id, qty: 4 }] }, input.inputs[1]] };
    const sid = await createBom(orgId, withSub);
    try {
      const sf = await loadBomFull(orgId, sid);
      const l0 = sf!.input.inputs.find(i => i.itemId === ins[0].id);
      check("substitute saved and read back in order", l0?.substitutes?.length === 1 && l0.substitutes[0].itemId === ins[2].id && l0.substitutes[0].qty === 4);
      const copy = await suggestFor(orgId, out.id);
      check("copy suggestion carries the substitutes", copy.source?.id === sid && copy.input?.inputs.find(i => i.itemId === ins[0].id)?.substitutes?.length === 1, copy.source?.id === sid ? "" : "suggest picked a different BOM");
      await replaceBom(orgId, sid, { ...withSub, inputs: [{ ...withSub.inputs[0], substitutes: [] }, withSub.inputs[1]] }, sf!.updatedAt);
      const sf2 = await loadBomFull(orgId, sid);
      check("editing away the substitute removed it", (sf2!.input.inputs.find(i => i.itemId === ins[0].id)?.substitutes ?? []).length === 0);
    } finally { await db.delete(S.boms).where(eq(S.boms.id, sid)); }
    const subLeft = await db.select({ id: S.bomLineSubstitutes.id }).from(S.bomLineSubstitutes).where(eq(S.bomLineSubstitutes.bomId, sid));
    check("deleting the BOM cascaded its substitutes", subLeft.length === 0);
    try { await createBom(orgId, { ...input, code: code + "X", inputs: [{ ...input.inputs[0], substitutes: [{ itemId: ins[0].id, qty: 1 }] }, input.inputs[1]] }); check("own-substitute refused", false); }
    catch (e: any) { check("an ingredient as its own substitute is refused", e instanceof BomValidationError && /own substitute/.test(e.message), e.message); }
    try { await createBom(orgId, { ...input, code: code + "Y", inputs: [{ ...input.inputs[0], allowedSkuIds: ["00000000-0000-0000-0000-000000000001"] }, input.inputs[1]] }); check("foreign SKU refused", false); }
    catch (e: any) { check("a supplier SKU that is not the item's is refused", e instanceof BomValidationError && /SKU|supplier/i.test(e.message), e.message); }

    const sug = await suggestFor(orgId, out.id);
    check("suggest returns without throwing", !!sug && "suggestedCode" in sug, JSON.stringify({ code: sug.suggestedCode }));
  } finally {
    await db.delete(S.boms).where(eq(S.boms.id, id));
    const left = await db.select({ id: S.bomLines.id }).from(S.bomLines).where(eq(S.bomLines.bomId, id));
    check("cleanup removed the BOM and its lines", left.length === 0);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
