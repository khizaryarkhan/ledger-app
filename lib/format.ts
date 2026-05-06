export const fmt = {
  money: (n: number | null | undefined, ccy = "EUR") => {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
  },
  date: (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  shortDate: (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short" }) : "—",
  relative: (d: string | Date | null | undefined) => {
    if (!d) return "—";
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 0) return `in ${Math.abs(days)}d`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  },
};

export const daysOverdue = (dueDate: string | null | undefined) => {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
};

export const getDueStatus = (inv: any) => {
  if (inv.paymentStatus === "Paid") return "Paid";
  if (inv.paymentStatus === "Written Off") return "Written Off";
  const d = daysOverdue(inv.dueDate);
  if (d > 0) return "Overdue";
  if (d === 0) return "Due Today";
  if (d >= -7) return "Due Soon";
  return "Not Due";
};

export const getAgingBucket = (inv: any) => {
  const d = daysOverdue(inv.dueDate);
  if (d <= 0) return "Current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
};

export const today = () => new Date().toISOString().slice(0, 10);
export const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const emailTemplates = [
  { id: "tpl1", name: "Friendly reminder (before due)", subject: "Upcoming invoice: {invoiceNumber}", body: "Hi {contactName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is due on {dueDate}.\n\nPlease let me know if you have any questions.\n\nKind regards,\n{senderName}" },
  { id: "tpl2", name: "Due today", subject: "Invoice {invoiceNumber} due today", body: "Hi {contactName},\n\nA quick note that invoice {invoiceNumber} for {amount} is due today. Please confirm payment when processed.\n\nMany thanks,\n{senderName}" },
  { id: "tpl3", name: "First overdue notice", subject: "Past due: invoice {invoiceNumber}", body: "Hi {contactName},\n\nInvoice {invoiceNumber} ({amount}) is now {daysOverdue} days past due. Could you confirm when we can expect payment?\n\nThanks,\n{senderName}" },
  { id: "tpl4", name: "Second overdue notice", subject: "Second reminder: invoice {invoiceNumber}", body: "Dear {contactName},\n\nDespite our previous reminder, invoice {invoiceNumber} ({amount}) remains unpaid and is now {daysOverdue} days overdue.\n\nPlease arrange payment without further delay.\n\nRegards,\n{senderName}" },
  { id: "tpl5", name: "Final notice", subject: "Final notice: invoice {invoiceNumber}", body: "Dear {contactName},\n\nThis is a final notice regarding invoice {invoiceNumber} for {amount}, which is now {daysOverdue} days overdue.\n\nWithout payment within 7 days this matter will be escalated to our credit control team.\n\nRegards,\n{senderName}" },
  { id: "tpl6", name: "Payment received - thank you", subject: "Payment received - thank you", body: "Hi {contactName},\n\nThank you — we have received your payment for invoice {invoiceNumber}. Your account is now up to date.\n\nBest regards,\n{senderName}" },
  { id: "tpl7", name: "Promise to pay confirmation", subject: "Confirming payment plan: {invoiceNumber}", body: "Hi {contactName},\n\nThanks for confirming. To recap, we expect payment of {amount} for invoice {invoiceNumber} by the agreed date.\n\nKind regards,\n{senderName}" },
];
