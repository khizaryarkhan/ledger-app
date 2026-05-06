// ============================================================
// REGION CONFIGURATION
// Maps project code prefixes to regions
// Add new regions or prefixes here — applies everywhere
// ============================================================

export const REGIONS = [
  { id: "dublin",   label: "Dublin",   prefixes: ["D"] },
  { id: "cork",     label: "Cork",     prefixes: ["C"] },
  { id: "galway",   label: "Galway",   prefixes: ["G"] },
  { id: "limerick", label: "Limerick", prefixes: ["LK", "MW"] },
  { id: "london",   label: "London",   prefixes: ["L"] },
];

export function getRegion(projectCode: string | null | undefined): string {
  if (!projectCode) return "Unknown";
  const code = projectCode.toUpperCase();
  for (const region of REGIONS) {
    // Sort prefixes longest-first so "LK" matches before "L"
    const sorted = [...region.prefixes].sort((a, b) => b.length - a.length);
    for (const prefix of sorted) {
      if (code.startsWith(prefix)) return region.label;
    }
  }
  return "Other";
}

export function getRegionId(projectCode: string | null | undefined): string {
  if (!projectCode) return "";
  const code = projectCode.toUpperCase();
  for (const region of REGIONS) {
    const sorted = [...region.prefixes].sort((a, b) => b.length - a.length);
    for (const prefix of sorted) {
      if (code.startsWith(prefix)) return region.id;
    }
  }
  return "";
}

// Helper to get region from invoice using projects lookup
// Usage: getInvoiceRegion(invoice, projectsMap)
export function getInvoiceRegion(inv: any, projects: any[]): string {
  if (!inv.projectId) return "Other";
  const proj = projects.find((p: any) => p.id === inv.projectId);
  if (!proj) return "Other";
  return getRegion(proj.code);
}

export function getInvoiceRegionId(inv: any, projects: any[]): string {
  if (!inv.projectId) return "";
  const proj = projects.find((p: any) => p.id === inv.projectId);
  if (!proj) return "";
  return getRegionId(proj.code);
}

// Get region from project — checks code first, then name (for QBO-synced projects)
// QBO projects have code="QBO-PROJ-3436" but name="D25010 - Georges Court Office"
export function getProjectRegion(project: any): string {
  if (!project) return "Other";
  // Try code first (manually created projects)
  const codeRegion = getRegion(project.code);
  if (codeRegion !== "Other") return codeRegion;
  // Fall back to name (QBO synced projects — name starts with project code)
  return getRegion(project.name);
}

export function getProjectRegionId(project: any): string {
  if (!project) return "";
  const codeRegion = getRegionId(project.code);
  if (codeRegion) return codeRegion;
  return getRegionId(project.name);
}

export function getInvoiceRegionFromProjects(inv: any, projects: any[]): string {
  if (!inv.projectId) return "Other";
  const proj = projects.find((p: any) => p.id === inv.projectId);
  return getProjectRegion(proj);
}

export function getInvoiceRegionIdFromProjects(inv: any, projects: any[]): string {
  if (!inv.projectId) return "";
  const proj = projects.find((p: any) => p.id === inv.projectId);
  return getProjectRegionId(proj);
}
