/**
 * Visual preview of the REAL mobile app.
 *
 * Renders the actual React Native screens through react-native-web, driven by
 * Playwright at phone size, against a mock API (harness/mock-api.mjs). Nothing
 * is re-drawn or approximated: if a screen changes, the next run shows the
 * change. That is the whole point — a hand-built mockup silently stops
 * matching the app the moment someone edits a screen.
 *
 *   npm run shots              # capture every screen
 *   npm run shots -- Today     # just the ones whose name matches
 *
 * Output: harness/shots/NN-name.png
 */
import { createServer } from "node:http";
import { readFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { chromium, devices } from "playwright";

const WEB_DIR = process.env.WEB_DIR || "/tmp/mobweb";
const OUT = new URL("./shots/", import.meta.url).pathname;
const WEB_PORT = 4011, MOCK_PORT = 4010;
const filter = process.argv[2]?.toLowerCase();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf" };

/** Static server for the exported web build. SPA fallback to index.html. */
function serveWeb() {
  return new Promise(resolve => {
    const s = createServer(async (req, res) => {
      const p = (req.url || "/").split("?")[0];
      for (const candidate of [join(WEB_DIR, p), join(WEB_DIR, "index.html")]) {
        try {
          const buf = await readFile(candidate);
          res.writeHead(200, { "Content-Type": MIME[extname(candidate)] || "application/octet-stream" });
          return res.end(buf);
        } catch {}
      }
      res.writeHead(404).end();
    });
    s.listen(WEB_PORT, () => resolve(s));
  });
}

const shots = [];
async function shot(page, name) {
  if (filter && !name.toLowerCase().includes(filter)) return;
  await page.waitForTimeout(650);                       // let lists settle
  const n = `${String(shots.length + 1).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: join(OUT, n) });
  shots.push(n);
  console.log(`  ✓ ${n}`);
}

/**
 * Tap by visible text.
 *
 * react-native-web renders Pressable as a bare <div tabindex="0"> with NO
 * role="button", and it does not respond to Playwright's synthetic mouse
 * click — the press handler never fires and the screen silently does nothing.
 * It DOES respond to keyboard activation, so: find the text, walk up to the
 * focusable Pressable, focus it and press Enter. Verified against the login
 * button; a plain .click() on the same element produced no network request at
 * all.
 */
async function tap(page, text, { exact = false } = {}) {
  // Prefer a FOCUSABLE element containing the text. Plain getByText matches
  // prose too — "Sign in" hit the subtitle "Sign in to manage receiving..."
  // before the button, focused nothing, and the run died two steps later
  // looking like a different bug entirely.
  const pressable = page.locator('[tabindex="0"]').filter({ hasText: text }).last();
  if (await pressable.count()) {
    await pressable.waitFor({ state: "visible", timeout: 8000 });
    await pressable.focus();
    await page.keyboard.press("Enter");
  } else {
    const el = page.getByText(text, { exact }).first();
    await el.waitFor({ state: "visible", timeout: 8000 });
    await el.click();
  }
  await page.waitForTimeout(500);
}

async function back(page) { await page.goBack().catch(() => {}); await page.waitForTimeout(450); }

const mock = spawn(process.execPath, [new URL("./mock-api.mjs", import.meta.url).pathname],
  { stdio: "inherit", env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });

const web = await serveWeb();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("console", m => { if (m.type() === "error") console.log(`  [app error] ${m.text().slice(0, 160)}`); });

try {
  await page.goto(`http://localhost:${WEB_PORT}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  // ── Auth ───────────────────────────────────────────────────────────────
  await shot(page, "Login");
  // Type, do not fill(). react-native-web's TextInput only updates React state
  // from real key events; fill() sets the DOM value directly, React never sees
  // onChangeText, and the Sign in button stays disabled(!email || !password)
  // while visibly showing the text you just typed. Cost an hour to spot.
  const inputs = page.locator("input");
  await inputs.nth(0).pressSequentially("aidan@edcengineers.com", { delay: 8 });
  await inputs.nth(1).pressSequentially("demo-password", { delay: 8 });
  await shot(page, "Login filled");
  await tap(page, "Sign in");
  await shot(page, "Org select");
  await tap(page, "EDC Engineering Design Consultants");

  // ── Tabs ───────────────────────────────────────────────────────────────
  await shot(page, "Home");
  await tap(page, "Today");   await shot(page, "Today queue");
  await tap(page, "Alerts");  await shot(page, "Alerts");
  await tap(page, "Profile"); await shot(page, "Profile");
  await tap(page, "Home");

  // ── Receivables ────────────────────────────────────────────────────────
  // Re-enter from the Home tab each time rather than page.goBack(): React
  // Navigation is not URL-routed here, so browser history does not track the
  // native stack and going "back" lands somewhere unrelated.
  // Pushed screens are SIBLINGS of the whole Tabs navigator in RootNavigator,
  // so they cover the tab bar completely — "a tab is always one tap away"
  // (mobile/CLAUDE.md) is not true once you are on a pushed screen. Reloading
  // is the cheap reset: the access token now persists in localStorage, so the
  // app restores the session and lands on Home.
  const fromHome = async (...path) => {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    for (const step of path) await tap(page, step);
  };

  // Home lists DEPARTMENT CARDS ("Overview", "Invoices", …) under section
  // headings ("RECEIVABLES", "OPERATIONS"). Navigate by card title — the
  // headings are plain text and tapping one does nothing.
  for (const [path, name] of [
    [["Overview"], "Receivables overview"],
    [["Invoices"], "Invoice list"],
    [["Escalations"], "Escalations"],
    [["Customers"], "Customers"],
    [["Invoices", "D26004"], "Invoice detail"],
    [["Receiving"], "Receiving"],
    [["Production"], "Production"],
    [["Shipping"], "Shipping"],
  ]) {
    try { await fromHome(...path); await shot(page, name); }
    catch (e) { console.log(`  – skipped ${name}: ${e.message.split("\n")[0].slice(0, 80)}`); }
  }
} catch (e) {
  console.log(`\n  ⚠ stopped early: ${e.message.split("\n")[0]}`);
  try { await page.screenshot({ path: join(OUT, "99-where-it-stopped.png") }); shots.push("99-where-it-stopped.png"); } catch {}
} finally {
  await browser.close();
  web.close();
  mock.kill();
  console.log(`\n${shots.length} screenshot(s) → mobile/harness/shots/`);
  for (const s of await readdir(OUT)) console.log(`  ${s}`);
}
