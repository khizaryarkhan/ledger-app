/**
 * Dev-database check of manufacturing orders honouring BOM substitutes and supplier-SKU
 * limits. Creates throwaway BOMs, lots and orders in the first org that can complete one,
 * exercises proposal / one-source rule / SKU limits / completion costing / void, then
 * removes everything it made. Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_mo_substitutes.ts
 */
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
loadEnv({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

let failed = 0;
const check = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (!pass) failed++; };
const rows = (r: any) => (r.rows ?? r) as any[];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.DATABASE_URL.includes("ep-ancient-math-ab44z2jn")) throw new Error("Refusing to run: not the dev endpoint");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { createBom } = await import("../lib/inventory/bom-save");
  const { createMO, setMoStatus, moDetail } = await import("../lib/inventory/manufacturing-orders");
  const { allocationView, setMaterialAllocation, releaseAllocations } = await import("../lib/inventory/mo-allocations");
  const { completeMoRun } = await import("../lib/inventory/mo-completion");
  const { voidProductionRun } = await import("../lib/inventory/void");
  const { commitReceipt, loadItemCostInfo, recalcItemCache } = await import("../lib/inventory/valuation");
  const { kindOf } = await import("../lib/inventory/item-kinds");

  // Find an org whose items can really complete an order (posting groups mapped).
  const items = await db.select().from(S.apItems);
  let orgId = "", out: any, P: any, Sub: any;
  const byOrg = new Map<string, any[]>();
  for (const i of items) (byOrg.get(i.orgId) ?? byOrg.set(i.orgId, []).get(i.orgId)!).push(i);
  // Test each candidate item ONCE (a handful per org), not every triple: the accounts must be mapped.
  const works = async (o: string, i: any) => { try { await loadItemCostInfo(o, [i.id]); return true; } catch { return false; } };
  for (const [o, list] of byOrg) {
    const tracked = list.filter(i => kindOf(i.productType).tracked).slice(0, 25);
    const okIds = new Set<string>();
    for (const i of tracked) if (await works(o, i)) okIds.add(i.id);
    const fp = tracked.find(i => okIds.has(i.id) && kindOf(i.productType).producible);
    const rms = tracked.filter(i => okIds.has(i.id) && kindOf(i.productType).consumable && i.id !== fp?.id);
    if (fp && rms.length >= 2) { orgId = o; out = fp; P = rms[0]; Sub = rms[1]; break; }
  }
  if (!orgId) { console.log("No org on dev with a producible item and two ingredients whose accounts are mapped; nothing to test."); return; }
  console.log(`Org ${orgId}; output ${out.name}; main ${P.name}; substitute ${Sub.name}`);

  const made = { lots: [] as string[], boms: [] as string[], mos: [] as string[], skus: [] as string[], runs: [] as string[] };
  const lot = async (item: any, qty: number, cost: number, supplierSkuId: string | null = null) => {
    const id = await commitReceipt(orgId, { itemId: item.id, qty, unitCost: cost, productType: item.productType, sourceType: "opening", receivedDate: new Date().toISOString().slice(0, 10), refType: "E2E", refId: randomUUID(), locationId: null, supplierSkuId });
    made.lots.push(id); return id;
  };
  const skuFor = async (item: any) => {
    const [r] = await db.insert(S.itemSupplierSkus).values({ orgId, itemId: item.id, supplierId: randomUUID(), skuName: "E2E SKU " + Date.now() } as any).returning({ id: S.itemSupplierSkus.id });
    made.skus.push(r.id); return r.id;
  };
  const mkBom = async (code: string, inputs: any[]) => {
    const id = await createBom(orgId, { code, name: code, outputItemId: out.id, outputSkuId: null, status: "Active", batchType: "Output", batchSize: 10, expYield: null, processingStep: null, notes: null, outputs: [], inputs, packs: [], ops: [] } as any);
    made.boms.push(id); return id;
  };
  const mkMo = async (bomId: string) => {
    const mo: any = await createMO(orgId, { bomId, outputItemId: out.id, outputs: [{ skuId: null, qty: 10 }] }, null);
    made.mos.push(mo.id); for (const st of ["Scheduled", "Released", "InProgress"] as const) await setMoStatus(orgId, mo.id, st); return mo.id as string;
  };
  const refuses = async (fn: () => Promise<any>, re: RegExp) => { try { await fn(); return "did not refuse"; } catch (e: any) { return re.test(String(e?.message)) ? true : String(e?.message); } };

  try {
    // 1. substitutes: proposal, one source, costing
    const ts = Date.now();
    const bom1 = await mkBom("E2E_MO_A_" + ts, [{ itemId: P.id, qty: 1000000, uom: P.baseUom, substitutes: [{ itemId: Sub.id, qty: 6 }] }]);
    const lotP = await lot(P, 2, 1);      // main item is SHORT: needs 1,000,000 whatever else is in stock
    const lotS = await lot(Sub, 10, 3);   // substitute covers its 6
    const mo1 = await mkMo(bom1);
    let v = await allocationView(orgId, mo1);
    let m = v.materials.find(x => x.itemId === P.id)!;
    check("MO copied the substitute (planned 6)", m.substitutes.length === 1 && m.substitutes[0].planned === 6, JSON.stringify(m.substitutes.map(s => s.planned)));
    check("short main item -> the substitute is PROPOSED, not applied", m.proposal?.itemId === Sub.id && m.allocated === 0 && m.usingSubstitute === null);

    await setMaterialAllocation(orgId, mo1, P.id, [{ lotId: lotP, qty: 2 }], null);
    const mix = await refuses(() => setMaterialAllocation(orgId, mo1, Sub.id, [{ lotId: lotS, qty: 6 }], null), /never a mix/i);
    check("a substitute is refused while the main item holds lots", mix === true, String(mix));
    await setMaterialAllocation(orgId, mo1, P.id, [], null);
    await setMaterialAllocation(orgId, mo1, Sub.id, [{ lotId: lotS, qty: 6 }], null);
    v = await allocationView(orgId, mo1); m = v.materials.find(x => x.itemId === P.id)!;
    check("planner's choice is recorded: usingSubstitute", m.usingSubstitute === Sub.id && m.proposal === null);
    const back = await refuses(() => setMaterialAllocation(orgId, mo1, P.id, [{ lotId: lotP, qty: 2 }], null), /never a mix/i);
    check("the main item is refused while a substitute holds lots", back === true, String(back));
    const det: any = await moDetail(orgId, mo1);
    const line = det.materials.lines.find((l: any) => l.itemId === P.id);
    check("MO detail shows the substitute and covers the material from it", line.substitute?.itemId === Sub.id && line.coverage === "full", JSON.stringify({ c: line.coverage, s: line.substitute?.name }));

    // 2. completion costs it as the replaced material, then voids cleanly
    try {
      const run: any = await completeMoRun(orgId, mo1, { final: true } as any, null);
      const runId = run.id ?? run.runId ?? run.run?.id;
      made.runs.push(runId);
      const cons = rows(await db.execute(sql`select item_id::text as item_id, for_item_id::text as for_item_id, qty::float as qty from production_consumptions where run_id = ${runId}`));
      check("consumption recorded the substitute and what it stood in for", cons.length === 1 && cons[0].item_id === Sub.id && cons[0].for_item_id === P.id, JSON.stringify(cons));
      const [lotAfter] = await db.select().from(S.inventoryLots).where(eq(S.inventoryLots.id, lotS));
      check("the substitute's lot was relieved by 6", Number(lotAfter.remainingQty) === 4, String(lotAfter.remainingQty));
      const [lotMain] = await db.select().from(S.inventoryLots).where(eq(S.inventoryLots.id, lotP));
      check("the main item's lot was NOT touched", Number(lotMain.remainingQty) === 2, String(lotMain.remainingQty));
      const d2: any = await moDetail(orgId, mo1);
      const sb = d2.completions[0]?.substitutions?.[0];
      check("MO detail names what stood in for what", sb?.itemId === Sub.id && sb?.forItemId === P.id, JSON.stringify(sb));
      await voidProductionRun(orgId, runId);
      made.runs.pop();
      const [lotRestored] = await db.select().from(S.inventoryLots).where(eq(S.inventoryLots.id, lotS));
      check("void restored the substitute's lot", Number(lotRestored.remainingQty) === 10, String(lotRestored.remainingQty));
    } catch (e: any) {
      check("completion and void on this dev data", false, String(e?.message).slice(0, 200));
    }

    // 3. supplier-SKU limit: unknown and other-SKU lots are refused
    const skuA = await skuFor(P), skuB = await skuFor(P);
    const bom2 = await mkBom("E2E_MO_B_" + ts, [{ itemId: P.id, qty: 4, uom: P.baseUom, allowedSkuIds: [skuA] }]);
    const okLot = await lot(P, 5, 1, skuA), unknownLot = await lot(P, 5, 1, null), otherLot = await lot(P, 5, 1, skuB);
    const mo2 = await mkMo(bom2);
    const v2 = await allocationView(orgId, mo2); const m2 = v2.materials.find(x => x.itemId === P.id)!;
    check("only the allowed-SKU lot is offered", m2.lots.some(l => l.lotId === okLot) && !m2.lots.some(l => l.lotId === unknownLot || l.lotId === otherLot));
    check("refused lots say why (unknown vs other)", m2.refused.some(r => r.lotId === unknownLot && r.reason === "unknown") && m2.refused.some(r => r.lotId === otherLot && r.reason === "other"));
    const rUnknown = await refuses(() => setMaterialAllocation(orgId, mo2, P.id, [{ lotId: unknownLot, qty: 4 }], null), /no supplier SKU on record/i);
    check("allocating a lot with an UNKNOWN supplier SKU is refused", rUnknown === true, String(rUnknown));
    const rOther = await refuses(() => setMaterialAllocation(orgId, mo2, P.id, [{ lotId: otherLot, qty: 4 }], null), /not limited to/i);
    check("allocating a lot of a different SKU is refused", rOther === true, String(rOther));
    await setMaterialAllocation(orgId, mo2, P.id, [{ lotId: okLot, qty: 4 }], null);
    check("the allowed-SKU lot can be allocated", true);
    await releaseAllocations(orgId, mo2);
  } finally {
    // cleanup: everything this script made, and nothing else
    for (const r of made.runs) { try { await voidProductionRun(orgId, r); } catch { /* already void */ } }
    if (made.mos.length) {
      await db.delete(S.lotAllocations).where(inArray(S.lotAllocations.moId, made.mos));
      await db.delete(S.productionRuns).where(inArray(S.productionRuns.moId, made.mos)).catch(() => {});
      await db.delete(S.manufacturingOrders).where(inArray(S.manufacturingOrders.id, made.mos));
    }
    if (made.boms.length) await db.delete(S.boms).where(inArray(S.boms.id, made.boms));
    if (made.lots.length) {
      await db.delete(S.lotAllocations).where(inArray(S.lotAllocations.lotId, made.lots));
      await db.delete(S.inventoryMovements).where(inArray(S.inventoryMovements.lotId, made.lots));
      await db.delete(S.inventoryLots).where(inArray(S.inventoryLots.id, made.lots));
    }
    if (made.skus.length) await db.delete(S.itemSupplierSkus).where(inArray(S.itemSupplierSkus.id, made.skus));
    for (const id of [P?.id, Sub?.id]) if (id) await recalcItemCache(orgId, id).catch(() => {});
    const left = made.lots.length ? (await db.select({ id: S.inventoryLots.id }).from(S.inventoryLots).where(inArray(S.inventoryLots.id, made.lots))).length : 0;
    check("cleanup removed every lot it made", left === 0, String(left));
  }
  console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
