// Zero-dependency mock of the mobile API, for the visual preview harness.
//
// The app is pointed here with EXPO_PUBLIC_API_BASE_URL, so the REAL screens
// and the REAL api client run — only the server is fake. That matters: a
// hand-drawn mockup drifts from the app the moment someone edits a screen,
// which is exactly the failure this harness exists to prevent.
import { createServer } from "node:http";
import * as F from "./fixtures.mjs";

const PORT = Number(process.env.MOCK_PORT || 4010);

const ROUTES = [
  [/^\/api\/mobile\/auth\/login$/,                 () => ({ preAuthToken: "pre_demo", orgs: F.ORGS, user: F.USER })],
  [/^\/api\/mobile\/auth\/select-org$/,            () => ({ accessToken: "acc_demo", refreshToken: "ref_demo", role: "company_admin", orgId: F.ORGS[0].id, user: F.USER })],
  [/^\/api\/mobile\/auth\/refresh$/,               () => ({ accessToken: "acc_demo", refreshToken: "ref_demo" })],
  [/^\/api\/mobile\/me$/,                          () => ({ user: F.USER, org: F.ORGS[0], role: "company_admin" })],
  [/^\/api\/mobile\/receivables\/summary/,         () => F.SUMMARY],
  [/^\/api\/mobile\/receivables\/today/,           () => F.TODAY],
  [/^\/api\/mobile\/notifications/,                () => F.ALERTS],
  [/^\/api\/mobile\/receivables\/invoices\/[^/]+\/note$/, () => ({ ok: true })],
  [/^\/api\/mobile\/receivables\/invoices\/[^/]+$/,() => F.DETAIL],
  [/^\/api\/mobile\/receivables\/invoices/,        () => ({ invoices: F.INVOICES, total: F.INVOICES.length })],
  [/^\/api\/mobile\/receivables\/escalations/,     () => F.ESCALATIONS],
  [/^\/api\/mobile\/receivables\/customers/,       () => ({ customers: F.CUSTOMERS })],
  [/^\/api\/invoices\/[^/]+\/response$/,           () => ({ ok: true })],
  [/^\/api\/invoices\/[^/]+$/,                     () => F.DETAIL.invoice],
  [/^\/api\/inventory\/po-open/,                   () => ({ pos: F.OPEN_POS })],
  [/^\/api\/inventory\/so-open/,                   () => ({ sos: F.OPEN_SOS })],
  [/^\/api\/inventory\/items/,                     () => ({ items: F.ITEMS })],
  [/^\/api\/inventory\/boms\/[^/]+$/,              () => F.BOM_DETAIL],
  [/^\/api\/inventory\/boms/,                      () => ({ boms: F.BOMS })],
  [/^\/api\/inventory\/receiving/,                 () => ({ ok: true, receipts: [] })],
  [/^\/api\/inventory\/shipping/,                  () => ({ ok: true, shipments: [] })],
  [/^\/api\/inventory\/production/,                () => ({ ok: true, runs: [] })],
];

createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) {
    // Loud, not silent: an unmocked endpoint should show up as a visible error
    // in the screenshot rather than an empty screen that looks intentional.
    console.log(`  [mock] 404 ${req.method} ${path}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `No fixture for ${path} — add one in harness/mock-api.mjs` }));
    return;
  }
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(hit[1](path, body)));
  });
}).listen(PORT, () => console.log(`  [mock] listening on http://localhost:${PORT}`));
