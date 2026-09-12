/**
 * Shared branded AR email template — the single source of truth for the look
 * of every outbound invoice email (AI chat send, board bulk send, batch send).
 * Pure function (no db/network) so it's safe to import on client or server.
 */

export type ArEmailRow = {
  invoiceNumber: string;
  customerName?: string | null;
  projectName?: string | null;
  invoiceDate: string;
  dueDate: string;
  balance: number;
  currency?: string;
  daysOverdue: number;
  /** QBO's own online-invoice "Review and pay" link, when available (QBO
   *  Online Invoicing/Payments must be enabled on the org). Null for Xero,
   *  native invoices, or when QBO doesn't generate one — the row just
   *  renders without a pay link, same as before this existed. */
  payUrl?: string | null;
};

function money(n: number, ccy = "EUR") {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
}

/** Minimal attribute escape so a stray quote in a URL can't break out of href="". */
function escapeAttr(v: string) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const DEFAULT_INTRO =
  "Hi,\n\nPlease find attached the statement of open invoices along with the invoice copies for your reference.\nKindly share the tentative payment dates at your earliest convenience.\nFeel free to reach out for any queries.";

export function renderInvoiceEmail(opts: {
  subject: string;
  dateStr: string;
  rows: ArEmailRow[];
  total: number;
  currency?: string;
  portalUrl?: string | null;
  intro?: string;
}): string {
  const introHtml = (opts.intro ?? DEFAULT_INTRO).replace(/\n/g, "<br>");

  // Currency for the total: use the explicit option, else fall back to the
  // currency of the invoices themselves (NOT a hard-coded EUR default) so the
  // total symbol always matches the line items (e.g. PKR, GBP, USD).
  const totalCurrency = opts.currency || opts.rows[0]?.currency || "EUR";

  const portalButton = opts.portalUrl
    ? `<div style="margin:24px 0;text-align:center;">
         <a href="${opts.portalUrl}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
           View &amp; Respond to Your Invoices &rarr;
         </a>
         <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">Set a payment date or raise a query in seconds.</p>
       </div>`
    : "";

  // Only render the Pay column when at least one invoice actually has a link
  // (QBO-only, and only when QBO issues one) — otherwise every Xero/native
  // org would get a permanently empty column.
  const anyPay = opts.rows.some(i => !!i.payUrl);

  /**
   * Email-client-safe button: inline-styled <a>, no classes, no flexbox.
   * `mso-padding-alt` + `<!--[if mso]>` spacers are what give Outlook (Word
   * rendering engine, which ignores padding on <a> and border-radius) a
   * button that still looks like a button rather than bare text.
   */
  const payButton = (url: string) => `
    <a href="${escapeAttr(url)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;line-height:1;padding:9px 14px;border-radius:6px;mso-padding-alt:0;white-space:nowrap;">
      <!--[if mso]><i style="letter-spacing:14px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
      <span style="mso-text-raise:6px;">Pay now</span>
      <!--[if mso]><i style="letter-spacing:14px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
    </a>`;

  const rowsHtml = opts.rows.map(i => {
    const style = i.daysOverdue > 0 ? "color:#dc2626;font-weight:600;" : "color:#374151;";
    const label = i.daysOverdue > 0 ? `${i.daysOverdue}d overdue` : `Due ${i.dueDate}`;
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;color:#374151;">#${i.invoiceNumber}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">
          ${i.customerName ?? "—"}${i.projectName ? `<br><span style="font-size:11px;color:#6b7280;">${i.projectName}</span>` : ""}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${i.invoiceDate}</td>
        <td style="padding:10px 12px;font-size:13px;${style}">${label}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;text-align:right;">${money(i.balance, i.currency)}</td>
        ${anyPay ? `<td style="padding:10px 12px;text-align:right;">${i.payUrl ? payButton(i.payUrl) : ""}</td>` : ""}
      </tr>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">
      <div style="background:#1c1917;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${opts.subject}</h1>
        <p style="color:#a8a29e;margin:6px 0 0;font-size:13px;">As of ${opts.dateStr}</p>
      </div>
      <div style="padding:24px 32px;">
        <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.7;">${introHtml}</p>
        ${portalButton}
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Invoice</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Customer / Project</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Date</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Due</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:right;">Balance</th>
              ${anyPay ? `<th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:right;">Pay</th>` : ""}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr style="background:#f9fafb;">
              <td colspan="4" style="padding:12px;font-size:13px;font-weight:700;color:#111827;">Total Outstanding</td>
              <td style="padding:12px;font-size:15px;font-weight:700;color:#111827;text-align:right;">${money(opts.total, totalCurrency)}</td>
              ${anyPay ? `<td style="padding:12px;"></td>` : ""}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

/**
 * Append a pay button to a free-text email body — unless the link is already
 * there.
 *
 * Only the composer needs this: the branded senders above draw their own
 * per-row buttons. The guard compares against an UNESCAPED copy of the body
 * because those senders write the href through an HTML-attribute escape
 * (& → &amp;); a raw-string match silently missed them and every invoice sent
 * that way went out with TWO pay buttons — reported by a customer.
 *
 * Pure and I/O-free so the dedup rule is unit-tested (tests/ar-email.test.ts).
 */
export function appendPayButton(body: string, payUrl: string | null | undefined, invoiceNumber: string): string {
  if (!payUrl) return body;
  if (body.replace(/&amp;/g, "&").includes(payUrl)) return body;
  return body + `
            <div style="margin:24px 0 8px;">
              <a href="${escapeAttr(payUrl)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;line-height:1;padding:11px 18px;border-radius:6px;mso-padding-alt:0;">
                <!--[if mso]><i style="letter-spacing:18px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
                <span style="mso-text-raise:7px;">Pay invoice ${invoiceNumber} online</span>
                <!--[if mso]><i style="letter-spacing:18px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
              </a>
              <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">Secure payment page hosted by QuickBooks.</p>
            </div>`;
}
