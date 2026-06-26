// Unified sales pipeline — ONE stage track for the whole journey. A record is a
// "lead" in the early stages and becomes an "opportunity/deal" once it reaches a
// deal stage (where a value is attached). This replaces the separate lead-status
// vs opportunity-stage split. Backed by landing_page_requests.status, reusing the
// existing terminal values (converted = Won, rejected = Lost) so no data migration.

export type PipelineStage = {
  key: string;
  label: string;
  tone: string;            // tailwind colour family
  deal: boolean;           // true once it's an "opportunity" (value relevant)
  terminal?: "won" | "lost";
};

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "new",         label: "New",         tone: "sky",     deal: false },
  { key: "contacted",   label: "Contacted",   tone: "blue",    deal: false },
  { key: "qualified",   label: "Qualified",   tone: "violet",  deal: false },
  { key: "proposal",    label: "Proposal",    tone: "amber",   deal: true },
  { key: "negotiation", label: "Negotiation", tone: "orange",  deal: true },
  { key: "converted",   label: "Won",         tone: "emerald", deal: true, terminal: "won" },
];

// Off the active board (terminal-loss / parked).
export const OFF_PIPELINE: PipelineStage[] = [
  { key: "rejected", label: "Lost",     tone: "rose",  deal: false, terminal: "lost" },
  { key: "archived", label: "Archived", tone: "stone", deal: false },
];

export const ALL_LEAD_STATUSES = [...PIPELINE_STAGES, ...OFF_PIPELINE].map(s => s.key);
export const DEAL_STAGES = PIPELINE_STAGES.filter(s => s.deal).map(s => s.key);

export const isDealStage = (status: string) => DEAL_STAGES.includes(status);
export const stageLabel = (key: string) =>
  [...PIPELINE_STAGES, ...OFF_PIPELINE].find(s => s.key === key)?.label ?? key;
