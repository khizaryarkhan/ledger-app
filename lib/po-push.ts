/**
 * Push an approved Purchase Order out to the connected accounting system
 * (QuickBooks Online or Xero) by creating a real PurchaseOrder there and
 * storing the returned external id back on our record.
 *
 * Used by POST /api/payables/purchase-orders/[id]/push.
 */
import { db } from "@/db";
import { purchaseOrders, purchaseOrderLines, apSuppliers } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const XERO_API = "https://api.xero.com/api.xro/2.0";

export interface PoPushResult {
  ok: boolean;
  provider: "qbo" | "xero" | null;
  externalId?: string;
  externalDocNumber?: string;
  error?: string;
}

async function loadPo(orgId: string, poId: string) {
  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, orgId)))
    .limit(1);
  if (!po) throw new Error("Purchase order not found");

  const lines = await db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.purchaseOrderId, poId), eq(purchaseOrderLines.orgId, orgId)))
    .orderBy(asc(purchaseOrderLines.lineNumber));

  let supplier: typeof apSuppliers.$inferSelect | undefined;
  if (po.supplierId) {
    [supplier] = await db
      .select()
      .from(apSuppliers)
      .where(and(eq(apSuppliers.id, po.supplierId), eq(apSuppliers.orgId, orgId)))
      .limit(1);
  }
  return { po, lines, supplier };
}

// ─── QBO ──────────────────────────────────────────────────────────────────────

async function pushToQbo(orgId: string, poId: string): Promise<PoPushResult> {
  const { po, lines, supplier } = await loadPo(orgId, poId);
  if (!supplier?.qboId) {
    throw new Error("Supplier is not linked to a QuickBooks vendor — sync suppliers first");
  }
  if (lines.length === 0) throw new Error("Purchase order has no line items");

  const token = await getOrgQboToken(orgId);
  if (!token) throw new Error("QuickBooks not connected");

  const Line = lines.map((l) => {
    const amount = l.lineTotal || l.quantity * l.unitPrice || 0;
    if (l.itemId) {
      return {
        DetailType: "ItemBasedExpenseLineDetail",
        Amount: amount,
        Description: l.description ?? undefined,
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: l.itemId },
          Qty: l.quantity,
          UnitPrice: l.unitPrice,
        },
      };
    }
    return {
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: amount,
      Description: l.description ?? undefined,
      AccountBasedExpenseLineDetail: l.accountId ? { AccountRef: { value: l.accountId } } : {},
    };
  });

  const body: any = {
    VendorRef: { value: supplier.qboId },
    Line,
  };
  if (po.currency) body.CurrencyRef = { value: po.currency };
  if (po.notes) body.Memo = po.notes;

  const res = await fetch(`${QBO_API}/${token.realmId}/purchaseorder?minorversion=65`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`QBO ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  const created = json?.PurchaseOrder;
  return {
    ok: true,
    provider: "qbo",
    externalId: created?.Id,
    externalDocNumber: created?.DocNumber,
  };
}

// ─── Xero ───────────────────────────────────────────────────────────────────

async function pushToXero(orgId: string, poId: string): Promise<PoPushResult> {
  const { po, lines, supplier } = await loadPo(orgId, poId);
  if (!supplier?.xeroId) {
    throw new Error("Supplier is not linked to a Xero contact — sync suppliers first");
  }
  if (lines.length === 0) throw new Error("Purchase order has no line items");

  const token = await getOrgXeroToken(orgId);
  if (!token) throw new Error("Xero not connected");

  const LineItems = lines.map((l) => ({
    Description: l.description ?? "Item",
    Quantity: l.quantity,
    UnitAmount: l.unitPrice,
    ...(l.accountId ? { AccountCode: l.accountId } : {}),
    ...(l.itemId ? { ItemCode: l.itemId } : {}),
    ...(l.taxRateId ? { TaxType: l.taxRateId } : {}),
  }));

  const body = {
    PurchaseOrders: [
      {
        Contact: { ContactID: supplier.xeroId },
        ...(po.poDate ? { Date: po.poDate } : {}),
        ...(po.expectedDeliveryDate ? { DeliveryDate: po.expectedDeliveryDate } : {}),
        LineItems,
        Status: "AUTHORISED",
        ...(po.poNumber ? { Reference: po.poNumber } : {}),
      },
    ],
  };

  const res = await fetch(`${XERO_API}/PurchaseOrders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Xero-Tenant-Id": token.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Xero ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json = await res.json();
  const created = (json?.PurchaseOrders ?? [])[0];
  return {
    ok: true,
    provider: "xero",
    externalId: created?.PurchaseOrderID,
    externalDocNumber: created?.PurchaseOrderNumber,
  };
}

/**
 * Push a PO to whichever accounting system the org has connected (QBO preferred,
 * then Xero), persist the external id/status, and return the result.
 */
export async function pushPurchaseOrder(orgId: string, poId: string): Promise<PoPushResult> {
  const qbo = await getOrgQboToken(orgId).catch(() => null);
  const xero = qbo ? null : await getOrgXeroToken(orgId).catch(() => null);

  if (!qbo && !xero) {
    await db
      .update(purchaseOrders)
      .set({ pushStatus: "failed", lastPushError: "No accounting system connected", updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, orgId)));
    return { ok: false, provider: null, error: "No accounting system connected" };
  }

  try {
    const result = qbo ? await pushToQbo(orgId, poId) : await pushToXero(orgId, poId);
    await db
      .update(purchaseOrders)
      .set({
        pushStatus: "success",
        pushedAt: new Date(),
        status: "Pushed to Accounting",
        lastPushError: null,
        externalDocNumber: result.externalDocNumber ?? null,
        ...(result.provider === "qbo" ? { qboId: result.externalId ?? null } : {}),
        ...(result.provider === "xero" ? { xeroId: result.externalId ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, orgId)));
    return result;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await db
      .update(purchaseOrders)
      .set({ pushStatus: "failed", lastPushError: msg, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, orgId)));
    return { ok: false, provider: qbo ? "qbo" : "xero", error: msg };
  }
}
