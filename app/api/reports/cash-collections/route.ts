/**
 * Cash Collections report.
 *
 * GET /api/reports/cash-collections?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Money actually received from customers in the period. Independent of QBO —
 * pulled from our payments table. Returns:
 *   - Daily totals (for the period chart)
 *   - Per-customer totals
 *   - Per-rep totals (by customer.repId)
 *   - Per-region totals (by customer.regionId)
 *   - Per-payment-method totals
 *   - Grand total
 *
 * Notes:
 *   - Payments are summed by their TxnDate, not deposit date.
 *   - Refund Receipts (money paid OUT to customers) are subtracted so the
 *     net is true cash inflow.
 */

import { db } from "@/db";
import { payments, refundReceipts, customers, reps, regions } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, gte, lte } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return bad("from=YYYY-MM-DD required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))            return bad("to must be YYYY-MM-DD");

  const [pmts, refs, custs, repRows, regionRows] = await Promise.all([
    db.select({
      id: payments.id,
      customerId: payments.customerId,
      txnDate: payments.txnDate,
      totalAmount: payments.totalAmount,
      paymentMethod: payments.paymentMethod,
      paymentRef: payments.paymentRef,
      depositAccountName: payments.depositAccountName,
      currency: payments.currency,
    }).from(payments).where(and(
      eq(payments.orgId, orgId!),
      gte(payments.txnDate, from),
      lte(payments.txnDate, to),
    )),
    db.select({
      id: refundReceipts.id,
      customerId: refundReceipts.customerId,
      txnDate: refundReceipts.txnDate,
      totalAmount: refundReceipts.totalAmount,
      paymentMethod: refundReceipts.paymentMethod,
      currency: refundReceipts.currency,
    }).from(refundReceipts).where(and(
      eq(refundReceipts.orgId, orgId!),
      gte(refundReceipts.txnDate, from),
      lte(refundReceipts.txnDate, to),
    )),
    db.select({
      id: customers.id, name: customers.name, code: customers.code,
      repId: customers.repId, regionId: customers.regionId, currency: customers.currency,
    }).from(customers).where(eq(customers.orgId, orgId!)),
    db.select({ id: reps.id, name: reps.name }).from(reps).where(eq(reps.orgId, orgId!)),
    db.select({ id: regions.id, name: regions.name }).from(regions).where(eq(regions.orgId, orgId!)),
  ]);

  const custById = new Map(custs.map(c => [c.id, c]));
  const repNameById = new Map(repRows.map(r => [r.id, r.name]));
  const regionNameById = new Map(regionRows.map(r => [r.id, r.name]));

  // Per-day totals
  const byDay = new Map<string, { inflow: number; outflow: number; net: number }>();
  // Per customer
  const byCustomer = new Map<string, { customerId: string; name: string; code: string; received: number; refunded: number; net: number; currency: string }>();
  // Per rep
  const byRep = new Map<string, { repId: string; name: string; received: number; refunded: number; net: number }>();
  // Per region
  const byRegion = new Map<string, { regionId: string; name: string; received: number; refunded: number; net: number }>();
  // Per payment method
  const byMethod = new Map<string, { method: string; received: number; refunded: number; net: number; count: number }>();

  const upDay = (date: string, kind: "inflow" | "outflow", amt: number) => {
    const d = byDay.get(date) ?? { inflow: 0, outflow: 0, net: 0 };
    d[kind] += amt;
    d.net = d.inflow - d.outflow;
    byDay.set(date, d);
  };
  const upMethod = (label: string, kind: "received" | "refunded", amt: number) => {
    const k = byMethod.get(label) ?? { method: label, received: 0, refunded: 0, net: 0, count: 0 };
    k[kind] += amt;
    k.net = k.received - k.refunded;
    k.count += 1;
    byMethod.set(label, k);
  };
  const upCust = (custId: string | null, kind: "received" | "refunded", amt: number, currency: string) => {
    const c = custId ? custById.get(custId) : null;
    if (!c) return;
    const k = byCustomer.get(c.id) ?? {
      customerId: c.id, name: c.name, code: c.code, received: 0, refunded: 0, net: 0, currency,
    };
    k[kind] += amt;
    k.net = k.received - k.refunded;
    byCustomer.set(c.id, k);

    if (c.repId) {
      const repK = byRep.get(c.repId) ?? { repId: c.repId, name: repNameById.get(c.repId) ?? "Unknown", received: 0, refunded: 0, net: 0 };
      repK[kind] += amt;
      repK.net = repK.received - repK.refunded;
      byRep.set(c.repId, repK);
    }
    if (c.regionId) {
      const regK = byRegion.get(c.regionId) ?? { regionId: c.regionId, name: regionNameById.get(c.regionId) ?? "Unknown", received: 0, refunded: 0, net: 0 };
      regK[kind] += amt;
      regK.net = regK.received - regK.refunded;
      byRegion.set(c.regionId, regK);
    }
  };

  for (const p of pmts) {
    upDay(p.txnDate, "inflow", p.totalAmount);
    upMethod(p.paymentMethod || "Unknown", "received", p.totalAmount);
    upCust(p.customerId, "received", p.totalAmount, p.currency || "EUR");
  }
  for (const r of refs) {
    upDay(r.txnDate, "outflow", r.totalAmount);
    upMethod(r.paymentMethod || "Refund", "refunded", r.totalAmount);
    upCust(r.customerId, "refunded", r.totalAmount, r.currency || "EUR");
  }

  const daysSorted = [...byDay.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([date, v]) => ({ date, ...v }));

  const totals = {
    received: pmts.reduce((s, p) => s + p.totalAmount, 0),
    refunded: refs.reduce((s, r) => s + r.totalAmount, 0),
    net: 0,
    paymentCount: pmts.length,
    refundCount:  refs.length,
  };
  totals.net = totals.received - totals.refunded;

  return ok({
    period: { from, to },
    totals,
    byDay:      daysSorted,
    byCustomer: [...byCustomer.values()].sort((a, b) => b.net - a.net),
    byRep:      [...byRep.values()].sort((a, b) => b.net - a.net),
    byRegion:   [...byRegion.values()].sort((a, b) => b.net - a.net),
    byMethod:   [...byMethod.values()].sort((a, b) => b.net - a.net),
  });
}
