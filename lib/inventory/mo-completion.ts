/**
 * Completing a manufacturing order — possibly in several runs.
 *
 * Each completion is ONE posted entry, and the only entry an MO ever makes
 * (nothing posts while it is scheduled or in progress):
 *
 *   Cr each component's stock account   (exactly the lots consumed, at lot cost)
 *   Dr Work in progress                  (materials)
 *   Dr Work in progress / Cr Labour absorbed, Cr Overhead absorbed
 *                                        (hours × the work centres' rates)
 *   Dr the output's stock account / Cr Work in progress   (good output)
 *   Dr Scrap & yield loss / Cr Work in progress           (loss beyond the BOM's yield)
 *
 * Work in progress nets to zero on every run. The order accounts come from the
 * OUTPUT item's group (orderRoleAccount), as the spec says order accounts should.
 *
 * Lots consumed must come out of the order's allocations. A run may consume
 * part of them (a partial completion); a FINAL run releases whatever is left,
 * which is how unused material goes back to stock — with no entry, because it
 * never left.
 *
 * The maths is in mo-costing.ts (pure, tested). This file validates, plans
 * read-only, then writes — neon-http has no transactions.
 */

import { db } from "@/db";
import {
  manufacturingOrders, moOutputs, moMaterials, moOperations, lotAllocations,
  productionRuns, productionConsumptions, productionOutputs,
} from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { loadItemCostInfo, planIssue, commitIssue, commitReceipt, type IssuePlan } from "@/lib/inventory/valuation";
import { orderRoleAccount } from "@/lib/accounting/account-roles-server";
import { resolveLocationId } from "@/lib/inventory/locations";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";
import { round2, roundQty, QTY_EPSILON } from "@/lib/inventory/round";
import { costCompletion, splitPackaging, proportionalHours, type CompletionCost } from "@/lib/inventory/mo-costing";

const err = (m: string): never => { throw new LedgerValidationError(m); };
/**
 * Output key. A BOM with no output packs (the Quick-Build shape) produces the
 * item's BASE unit, stored as a null SKU; "" is its key everywhere here, and
 * null again when it is written.
 */
const K = (skuId: string | null | undefined) => skuId ?? "";
const skuOf = (k: string) => (k === "" ? null : k);
const num = (v: any) => Number(v ?? 0);

export type CompletionInput = {
  date?: string;                                            // YYYY-MM-DD; default today
  outputs?: { skuId: string; goodPacks: number }[];         // default: every pack's remainder
  rejectedBase?: number;                                    // base UoM; default 0
  consume?: { itemId: string; lotId: string; qty: number }[]; // default: see below
  hours?: { operationId: string; hours: number }[];         // default: planned × this run's share
  final?: boolean;                                          // default: true when every pack is done
  outputLocationId?: string | null;
  notes?: string | null;
};

type Planned = Awaited<ReturnType<typeof planCompletion>>;

/**
 * Validate and cost a completion without writing anything. The preview the
 * completion drawer shows is exactly this, so what the user confirms is what
 * posts.
 */
export async function planCompletion(orgId: string, moId: string, input: CompletionInput) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status !== "InProgress") err("Start the order (In Progress) and allocate its lots before completing it.");
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid completion date is required.");

  const outRows = await db.select().from(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, moId)));
  if (!outRows.length) err("This MO has no output packs.");
  const [mats, ops, allocs] = await Promise.all([
    db.select().from(moMaterials).where(and(eq(moMaterials.orgId, orgId), eq(moMaterials.moId, moId))),
    db.select().from(moOperations).where(and(eq(moOperations.orgId, orgId), eq(moOperations.moId, moId))),
    db.select().from(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId))),
  ]);

  // ── Output of this run ────────────────────────────────────────────────
  const remaining = new Map(outRows.map(o => [K(o.skuId), roundQty(Math.max(0, num(o.qty) - num(o.completedQty)))]));
  const unitContent = new Map(outRows.map(o => [K(o.skuId), o.unitContent != null ? num(o.unitContent) : (o.skuId ? 0 : 1)]));
  const outputs = (input.outputs ?? outRows.map(o => ({ skuId: K(o.skuId), goodPacks: remaining.get(K(o.skuId)) ?? 0 })))
    .map(o => ({ skuId: K(o.skuId as any), goodPacks: roundQty(Math.max(0, Number(o.goodPacks) || 0)) }));
  for (const o of outputs) if (!remaining.has(o.skuId)) err("One of the output packs is not part of this order.");
  if (outputs.some(o => !(unitContent.get(o.skuId)! > 0))) err("An output pack has no base content — set it on the BOM's output pack.");
  const rejectedBase = roundQty(Math.max(0, Number(input.rejectedBase) || 0));
  const goodBase = roundQty(outputs.reduce((s, o) => s + o.goodPacks * unitContent.get(o.skuId)!, 0));
  if (goodBase + rejectedBase <= 0) err("Enter what this run produced — good packs, or a rejected quantity.");
  const plannedBase = roundQty(outRows.reduce((s, o) => s + num(o.qty) * num(o.unitContent), 0));
  const doneAfter = outRows.every(o => roundQty(num(o.completedQty) + (outputs.find(x => x.skuId === K(o.skuId))?.goodPacks ?? 0)) + QTY_EPSILON >= num(o.qty));
  const final = input.final ?? doneAfter;

  // ── Consumption: out of this order's allocations only ─────────────────
  const allocByLot = new Map(allocs.map(a => [a.lotId, a]));
  // A partial run's default consumption is its share of what is LEFT to make
  // — the allocations shrink as earlier runs consume them.
  const remainingBase = roundQty(outRows.reduce((sm, o) => sm + Math.max(0, num(o.qty) - num(o.completedQty)) * num(o.unitContent), 0));
  const share = remainingBase > 0 ? Math.min(1, (goodBase + rejectedBase) / remainingBase) : 1;
  const consume = (input.consume ?? allocs.map(a => ({
    itemId: a.itemId, lotId: a.lotId,
    // A final run uses everything allocated; a partial run its share of the plan.
    qty: final ? num(a.qty) : roundQty(num(a.qty) * share),
  }))).map(c => ({ itemId: String(c.itemId), lotId: String(c.lotId), qty: roundQty(Math.max(0, Number(c.qty) || 0)) })).filter(c => c.qty > 0);
  const seen = new Set<string>();
  for (const c of consume) {
    const a = allocByLot.get(c.lotId);
    if (!a || a.itemId !== c.itemId) err("Only lots allocated to this order can be consumed by it. Allocate the lot first.");
    if (seen.has(c.lotId)) err("The same lot is listed twice.");
    seen.add(c.lotId);
    if (roundQty(c.qty - num(a!.qty)) > QTY_EPSILON) err(`More is being consumed from a lot than is allocated to this order (${num(a!.qty)}).`);
  }

  const byItem = new Map<string, { lotId: string; qty: number }[]>();
  for (const c of consume) (byItem.get(c.itemId) ?? byItem.set(c.itemId, []).get(c.itemId)!).push({ lotId: c.lotId, qty: c.qty });
  const itemMap = await loadItemCostInfo(orgId, [...byItem.keys(), mo!.outputItemId]);
  const output = itemMap.get(mo!.outputItemId);
  if (!output) err("The output item no longer exists.");

  const plans: { itemId: string; plan: IssuePlan; credit: number; assetAcct: string; name: string }[] = [];
  for (const [itemId, picks] of byItem) {
    const it = itemMap.get(itemId);
    if (!it || !it.tracked) continue;
    const plan = await planIssue(orgId, it, roundQty(picks.reduce((sm, x) => sm + x.qty, 0)), { exactPicks: picks, forMoId: moId });
    if (plan.shortfallQty > 0) err(`${it.name}: the allocated lots no longer hold ${plan.shortfallQty} of what is being consumed — it was issued elsewhere. Re-allocate before completing.`);
    plans.push({ itemId, plan, credit: round2(plan.totalCost), assetAcct: it.assetAccountId!, name: it.name });
  }

  // ── Cost: ingredients common, packaging per pack ──────────────────────
  const matsByItem = new Map<string, typeof mats>();
  for (const m of mats) (matsByItem.get(m.itemId) ?? matsByItem.set(m.itemId, []).get(m.itemId)!).push(m);
  let ingredientCost = 0;
  const packagingCostBySku: Record<string, number> = {};
  for (const p of plans) {
    const rows = matsByItem.get(p.itemId) ?? [];
    const packRows = rows.filter(r => r.kind === "packaging" && r.forSkuId);
    const ingQty = rows.filter(r => r.kind === "ingredient").reduce((s, r) => s + num(r.plannedQty), 0);
    const packQty = packRows.reduce((s, r) => s + num(r.plannedQty), 0);
    // An item that is both ingredient and packaging is split by planned use.
    const packShare = ingQty + packQty > 0 ? packQty / (ingQty + packQty) : 0;
    const packCost = round2(p.credit * packShare);
    ingredientCost = round2(ingredientCost + p.credit - packCost);
    if (packCost > 0) {
      const split = splitPackaging(packCost, Object.fromEntries(packRows.map(r => [r.forSkuId!, num(r.plannedQty)])));
      for (const [sku, v] of Object.entries(split)) packagingCostBySku[K(sku)] = round2((packagingCostBySku[K(sku)] ?? 0) + v);
    }
  }

  const runBase = goodBase + rejectedBase;
  const hoursIn = new Map((input.hours ?? []).map(h => [String(h.operationId), roundQty(Math.max(0, Number(h.hours) || 0))]));
  const operations = ops.map(o => {
    const hours = hoursIn.has(o.id) ? hoursIn.get(o.id)! : proportionalHours(num(o.plannedHours), runBase, plannedBase);
    return { id: o.id, name: o.name, hours, labour: round2(hours * num(o.labourRate)), overhead: round2(hours * num(o.overheadRate)) };
  });
  const labourCost = round2(operations.reduce((s, o) => s + o.labour, 0));
  const overheadCost = round2(operations.reduce((s, o) => s + o.overhead, 0));

  const cost: CompletionCost = costCompletion({
    ingredientCost, packagingCostBySku, labourCost, overheadCost,
    outputs: outputs.map(o => ({ skuId: o.skuId, goodPacks: o.goodPacks, unitContent: unitContent.get(o.skuId)! })),
    rejectedBase, expYieldPct: mo!.expYield != null ? num(mo!.expYield) : null,
  });
  if (goodBase > 0 && cost.total <= 0) err("Nothing with a cost is being consumed or charged — allocate the lots this run used.");

  return { mo: mo!, date, final, outputs, rejectedBase, consume, plans, operations, labourCost, overheadCost, ingredientCost, packagingCostBySku, cost, output: output!, itemMap };
}

/** Preview for the completion drawer: the numbers, no writes. */
export async function previewCompletion(orgId: string, moId: string, input: CompletionInput) {
  const p = await planCompletion(orgId, moId, input);
  return {
    final: p.final,
    materials: round2(p.plans.reduce((s, x) => s + x.credit, 0)),
    labour: p.labourCost, overhead: p.overheadCost,
    scrap: p.cost.scrapCost, total: p.cost.total,
    goodBase: p.cost.goodBase, normalLossBase: p.cost.normalLossBase, abnormalBase: p.cost.abnormalBase,
    outputs: p.cost.outputs,
    operations: p.operations,
    consume: p.consume,
  };
}

/** Post one completion. Returns the run, or a pending approval. */
export async function completeMoRun(orgId: string, moId: string, input: CompletionInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const p: Planned = await planCompletion(orgId, moId, input);
  const { mo, cost, output } = p;

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "production_build", cost.total)) {
    const pending = await stagePendingApproval(orgId, "mo_completion", { moId, ...input }, cost.total, actorId);
    return { pending: true, id: pending.id, amount: cost.total };
  }

  const outputLocationId = await resolveLocationId(orgId, input.outputLocationId ?? null, { label: "Output location" });
  const wip = await orderRoleAccount(orgId, output, "WIP_OPEN_ORDERS");
  const materials = round2(p.plans.reduce((s, x) => s + x.credit, 0));

  const lines: PostLine[] = [];
  for (const x of p.plans) if (x.credit > 0) lines.push({ accountId: x.assetAcct, credit: x.credit, description: `Consumed — ${x.name}` });
  if (materials > 0) lines.push({ accountId: wip, debit: materials, description: `Materials into ${mo.moNo ?? "order"}` });
  if (p.labourCost > 0) {
    lines.push({ accountId: wip, debit: p.labourCost, description: `Labour — ${mo.moNo ?? "order"}` });
    lines.push({ accountId: await orderRoleAccount(orgId, output, "LABOUR_ABSORBED"), credit: p.labourCost, description: `Labour absorbed — ${mo.moNo ?? "order"}` });
  }
  if (p.overheadCost > 0) {
    lines.push({ accountId: wip, debit: p.overheadCost, description: `Overhead — ${mo.moNo ?? "order"}` });
    lines.push({ accountId: await orderRoleAccount(orgId, output, "OVERHEAD_ABSORBED"), credit: p.overheadCost, description: `Overhead absorbed — ${mo.moNo ?? "order"}` });
  }
  const toOutput = round2(cost.outputs.reduce((s, o) => s + o.amount, 0));
  if (toOutput > 0) {
    lines.push({ accountId: output.assetAccountId!, debit: toOutput, description: `Produced — ${output.name}` });
    lines.push({ accountId: wip, credit: toOutput, description: `Output reported — ${mo.moNo ?? "order"}` });
  }
  if (cost.scrapCost > 0) {
    lines.push({ accountId: await orderRoleAccount(orgId, output, "SCRAP_LOSS"), debit: cost.scrapCost, description: `Loss beyond expected yield — ${mo.moNo ?? "order"}` });
    lines.push({ accountId: wip, credit: cost.scrapCost, description: `Scrap written off — ${mo.moNo ?? "order"}` });
  }
  if (lines.length < 2) err("Nothing to post — this run consumed and produced nothing with a cost.");

  const entry = await postJournalEntry({
    orgId, entryDate: p.date, memo: input.notes?.trim() || `Completion — ${mo.moNo ?? "MO"} · ${output.name}`,
    series: "Production", sourceType: "Production", createdBy: actorId, reference: mo.moNo ?? null, lines,
  });
  const runNo = entry.docNumber || `BUILD-${p.date.replace(/-/g, "")}`;

  const [run] = await db.insert(productionRuns).values({
    orgId, bomId: mo.bomId, runNo, outputItemId: mo.outputItemId, moId,
    qtyToProduce: cost.goodBase.toString(), goodQty: cost.goodBase.toString(), rejectedQty: p.rejectedBase.toString(),
    totalInputCost: cost.total.toString(), labourCost: p.labourCost.toString(), overheadCost: p.overheadCost.toString(), scrapCost: cost.scrapCost.toString(),
    status: "Completed", entryId: entry.id, producedDate: p.date, notes: input.notes?.trim() || null, createdBy: actorId,
    outputLocationId,
  } as any).returning({ id: productionRuns.id });

  // Stock side. Failures here are loud, not swallowed: the entry has posted,
  // and a silently missing lot is the GL-vs-stock drift the reconciliation
  // exists to catch (GAP_REPORT §C, GRN-0035).
  for (const x of p.plans) {
    await commitIssue(orgId, { itemId: x.itemId, plan: x.plan, movementType: "issue_production", refType: "ProductionRun", refId: entry.id, entryId: entry.id, date: p.date, createdBy: actorId, note: `${mo.moNo ?? "MO"} · ${runNo}` });
    for (const pick of x.plan.picks) if (pick.lotId) {
      await db.insert(productionConsumptions).values({ orgId, runId: run.id, itemId: x.itemId, lotId: pick.lotId, qty: pick.qty.toString(), unitCost: pick.unitCost.toString(), totalCost: round2(pick.qty * pick.unitCost).toString() } as any);
    }
  }
  for (const o of cost.outputs) {
    const lotId = await commitReceipt(orgId, {
      itemId: mo.outputItemId, skuId: skuOf(o.skuId), qty: o.baseQty, unitCost: o.unitCost, productType: output.productType,
      sourceType: "production", receivedDate: p.date, locationId: outputLocationId,
      refType: "ProductionRun", refId: entry.id, entryId: entry.id, createdBy: actorId, note: `${mo.moNo ?? "MO"} · ${runNo}`,
    });
    await db.insert(productionOutputs).values({ orgId, runId: run.id, itemId: mo.outputItemId, skuId: skuOf(o.skuId), qtyPacks: o.packs.toString(), qtyBase: o.baseQty.toString(), unitCost: o.unitCost.toString(), amount: o.amount.toString(), lotId } as any);
  }

  // Order side: what was consumed leaves the allocation; what was made is done.
  for (const c of p.consume) {
    await db.update(lotAllocations).set({ qty: sql`${lotAllocations.qty} - ${c.qty.toString()}`, updatedAt: new Date() })
      .where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), eq(lotAllocations.lotId, c.lotId)));
  }
  await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), sql`${lotAllocations.qty} <= ${QTY_EPSILON}`));
  for (const o of p.outputs) if (o.goodPacks > 0) {
    await db.update(moOutputs).set({ completedQty: sql`${moOutputs.completedQty} + ${o.goodPacks.toString()}` })
      .where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, moId), o.skuId ? eq(moOutputs.skuId, o.skuId) : isNull(moOutputs.skuId)));
  }
  if (p.final) {
    // Whatever is still allocated was not used: it goes back to stock. No
    // entry — it never left its lot or its account.
    await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId)));
    await db.update(manufacturingOrders).set({ status: "Completed", productionRunId: run.id, updatedAt: new Date() })
      .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId)));
  } else {
    await db.update(manufacturingOrders).set({ productionRunId: run.id, updatedAt: new Date() })
      .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId)));
  }

  return { id: run.id, runNo, entryId: entry.id, final: p.final, total: cost.total, scrap: cost.scrapCost, status: p.final ? "Completed" : "InProgress" };
}
