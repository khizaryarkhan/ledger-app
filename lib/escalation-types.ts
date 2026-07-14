/**
 * Escalation types — the "why" behind moving an invoice to Escalated.
 * The stage stays "Escalated"; the type is metadata shown on the board chip,
 * in the chatbox log, the owner digest email, the owner portal, and exports.
 *
 * To add/remove a type, edit this list only — everything else reads from it.
 */

export type EscalationType = {
  key: string;
  label: string;
  /** Shown on hover (tooltip) and under the picker when selected. */
  description: string;
};

export const ESCALATION_TYPES: EscalationType[] = [
  {
    key: "handed_over",
    label: "Handed Over",
    description: "General handover — a senior team member or director takes over the chase from here.",
  },
  {
    key: "final_account",
    label: "Final Account Agreement",
    description: "Payment is blocked until the final account is agreed with the customer — needs a commercial decision before chasing continues.",
  },
  {
    key: "forward_invoicing",
    label: "Forward Invoicing",
    description: "Ongoing or future work with this customer can be used as commercial leverage — needs the relationship owner, not a chaser.",
  },
  {
    key: "disputed",
    label: "Disputed",
    description: "The customer contests the amount or the work. The dispute must be resolved before normal chasing resumes.",
  },
  {
    key: "retention_release",
    label: "Retention Release",
    description: "Retention money is due — needs a certificate or practical-completion sign-off before it can be released.",
  },
  {
    key: "certification_pending",
    label: "Certification Pending",
    description: "Awaiting a QS/engineer valuation or payment certificate — the invoice can't be paid until it's certified.",
  },
  {
    key: "payment_plan",
    label: "Payment Plan",
    description: "The customer has asked to pay in instalments — the terms need senior approval before agreeing.",
  },
  {
    key: "legal_review",
    label: "Legal Review",
    description: "Considering formal action — a solicitor's letter or proceedings. Needs a senior decision on next steps.",
  },
  {
    key: "insolvency_risk",
    label: "Insolvency Risk",
    description: "The customer is showing signs of financial distress — needs an urgent senior decision to protect the debt.",
  },
  {
    key: "other",
    label: "Other",
    description: "Anything not covered above — explain in the note.",
  },
];

export const ESCALATION_TYPE_LABELS = ESCALATION_TYPES.map(t => t.label);

export function escalationTypeByLabel(label: string | null | undefined): EscalationType | undefined {
  if (!label) return undefined;
  return ESCALATION_TYPES.find(t => t.label === label);
}
