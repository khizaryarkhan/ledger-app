/**
 * Track & Trace — append-only audit event log.
 * logEvent() is always wrapped in try/catch so logging NEVER breaks primary actions.
 */
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export type EventType =
  // ── Receivables ──────────────────────────────────────────────────────────
  | "email_sent"       // automated reminder email dispatched
  | "email_manual"     // manually composed email sent
  | "note_added"       // internal note added
  | "stage_changed"    // collection stage changed on invoice
  | "payment_recorded" // payment (full or partial) posted
  | "promise_to_pay"   // promise-to-pay date set/updated
  | "dispute_raised"   // dispute reason set
  | "programme_toggled"   // auto-reminder programme on/off
  | "chase_mode_changed"  // customer chase level changed (customer ↔ project)
  | "invoice_synced"   // QBO sync created/updated this invoice
  | "contact_updated"  // contact details changed
  | "user_login"               // a user authenticated
  | "user_deactivated"         // a user's access was removed/deactivated
  | "user_role_changed"        // a user's role was changed
  | "org_role_saved"           // a custom role was created or edited (Settings → Roles)
  | "org_role_deleted"         // a custom role was deleted
  | "user_password_reset"      // an admin reset a user's password (link or manual)
  | "integration_connected"    // QBO/Xero/Gmail/MS connection established
  | "integration_disconnected" // QBO/Xero/Gmail/MS connection removed
  | "data_exported"            // audit trail / report exported
  | "mcp_read"                 // an AI client (MCP) read data as this user
  | "mcp_write"                // an AI client (MCP) created/changed data as this user
  | "mcp_delete"               // an AI client (MCP) deleted data as this user
  | "qbo_api_call"             // a QuickBooks API passthrough call (meta.via: app | mcp)
  | "ai_switches_changed"      // an admin turned AI-connection writes/deletes on or off
  | "pax_model_saved"          // a user connected or changed their PAX Console model (never logs the key)
  | "pax_model_removed"        // a user removed their PAX Console model and key
  | "pax_policy_saved"         // an admin changed which providers / changes PAX Console allows
  | "pax_proposal"             // a PAX Console model proposed a change, or the user rejected one (nothing ran)
  | "pax_consent"            // a user acknowledged that PAX Console sends data to their chosen provider
  // ── Payables / Procurement ───────────────────────────────────────────────
  | "purchase_request_created"
  | "purchase_request_submitted"
  | "purchase_request_approved"
  | "purchase_request_rejected"
  | "purchase_order_created"
  | "purchase_order_submitted"
  | "purchase_order_approved"
  | "purchase_order_rejected"
  | "purchase_order_pushed"
  | "purchase_order_push_failed"
  | "bill_synced"
  | "bill_reviewed"
  | "bill_approved"
  | "bill_rejected"
  | "bill_on_hold"
  | "bill_ready_for_payment"
  | "bill_approval_note_pushed"
  | "supplier_query_created"
  | "supplier_query_resolved"
  | "payment_run_created"
  | "payment_run_submitted"
  | "payment_run_approved"
  | "payment_run_scheduled"
  | "payables_master_data_synced"
  // ── Document history (QBO form-parity, Phase 5) ─────────────────────────
  // Distinct from email_sent/email_manual above — those are the Receivables
  // chase-email timeline, keyed on invoiceId; document_emailed covers any
  // document type via DocumentEmailModal (Bill, Estimate, PO, Payment, …),
  // keyed on docType/docId instead, so the two never get conflated in either
  // timeline.
  | "document_created"
  | "document_edited"
  | "document_reversed"
  | "document_deleted"
  | "document_emailed"
  | "attachment_added"
  | "attachment_removed";

export interface LogEventArgs {
  orgId: string;
  eventType: EventType;
  customerId?: string | null;
  projectId?: string | null;
  invoiceId?: string | null;
  // Document history (Phase 5) — the same "ledger" | "trade" + journal_
  // entries.id/trade_documents.id discriminator Print/Download, Email/Send
  // and Attachments already use. Independent of customerId/projectId/
  // invoiceId above: a Bill or Payment has a docId but no invoiceId at all.
  docType?: "ledger" | "trade" | null;
  docId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  meta?: Record<string, unknown>;
}

export async function logEvent(args: LogEventArgs): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      orgId:      args.orgId,
      eventType:  args.eventType,
      customerId: args.customerId  ?? null,
      projectId:  args.projectId  ?? null,
      invoiceId:  args.invoiceId  ?? null,
      docType:    args.docType    ?? null,
      docId:      args.docId      ?? null,
      actorId:    args.actorId    ?? null,
      actorName:  args.actorName  ?? null,
      meta:       (args.meta      ?? {}) as any,
      occurredAt: new Date(),
    });
  } catch (e) {
    // Logging must never break the primary action
    console.error("[audit] logEvent failed:", e);
  }
}
