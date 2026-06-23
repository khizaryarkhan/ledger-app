// Shared opportunity (deal) pipeline config — used by the API for validation and
// by the admin UI for rendering. Keep this the single source of truth for stages.

export type OppStage = {
  key: string;
  label: string;
  confidence: number;        // default confidence when a deal lands in this stage
  tone: string;              // tailwind colour family used in the UI
  terminal?: "won" | "lost"; // terminal columns set status accordingly
};

export const OPP_STAGES: OppStage[] = [
  { key: "discovery",   label: "Discovery",        confidence: 20,  tone: "sky" },
  { key: "demo",        label: "Demo",             confidence: 40,  tone: "blue" },
  { key: "proposal",    label: "Proposal / Quote", confidence: 60,  tone: "violet" },
  { key: "negotiation", label: "Negotiation",      confidence: 80,  tone: "amber" },
  { key: "won",         label: "Won",              confidence: 100, tone: "emerald", terminal: "won" },
  { key: "lost",        label: "Lost",             confidence: 0,   tone: "rose",    terminal: "lost" },
];

export const OPP_STAGE_KEYS = OPP_STAGES.map(s => s.key);

export function stageStatus(stage: string): "open" | "won" | "lost" {
  const s = OPP_STAGES.find(x => x.key === stage);
  return s?.terminal ?? "open";
}

export function defaultConfidence(stage: string): number {
  return OPP_STAGES.find(x => x.key === stage)?.confidence ?? 50;
}
