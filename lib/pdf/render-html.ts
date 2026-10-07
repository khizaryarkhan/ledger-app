/**
 * The one choke point for turning rendered document HTML into a PDF buffer.
 * Headless Chromium via puppeteer-core — @sparticuz/chromium's bundled
 * binary in production (Vercel/Lambda's Amazon-Linux runtime), or whatever
 * Chrome/Edge is already installed locally during `npm run dev` (that binary
 * is Linux-only and will not launch on a developer's Windows/macOS machine).
 *
 * See tests/architecture.test.ts's "the one PDF engine" guard: nothing else
 * in this codebase may import puppeteer-core or @sparticuz/chromium directly
 * — every native document goes through renderHtmlToPdf.
 *
 * Version pinning: @sparticuz/chromium is pinned to 147.0.0, not latest —
 * 149.0.0+ requires Node >=22.17, and this app targets Node 20 (package.json
 * engines, @types/node pin). puppeteer-core is pinned to ^24.40.0 to match
 * 147.0.0's own tested devDependency pairing. Bump all three together if the
 * Node runtime is ever upgraded, not just one.
 */
import type { Browser } from "puppeteer-core";

const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;

const LOCAL_BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

async function resolveLocalExecutablePath(): Promise<string> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const { existsSync } = await import("node:fs");
  const found = LOCAL_BROWSER_CANDIDATES.find(existsSync);
  if (!found) {
    throw new Error(
      "renderHtmlToPdf: no local Chrome/Edge found for dev PDF rendering. Set " +
      "PUPPETEER_EXECUTABLE_PATH to your browser's executable path, or verify this " +
      "route against a Vercel preview deployment instead — @sparticuz/chromium's " +
      "bundled binary only runs on Vercel/Lambda's Linux runtime, never locally on " +
      "Windows/macOS.",
    );
  }
  return found;
}

let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    }) as unknown as Browser;
  }
  return puppeteer.launch({
    executablePath: await resolveLocalExecutablePath(),
    headless: true,
  }) as unknown as Browser;
}

/** Warm instances are reused across invocations in the same serverless
 *  container — a cold Chromium launch costs ~1-2s, not worth paying twice. */
async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.isConnected()) return existing;
    browserPromise = null;
  }
  browserPromise = launchBrowser();
  return browserPromise;
}

/**
 * Render one document's HTML to a PDF buffer. Honors the page's own `@page`
 * CSS rule (size/margin) exactly as a browser's Print dialog would —
 * components/print-document.tsx's `@media print` block is the single source
 * of truth for paper size and margins, not a second copy of those numbers
 * here.
 *
 * `footerTemplate` (optional) turns on Puppeteer's repeating per-page footer
 * (e.g. a page-number / generated-timestamp strip for a multi-page document
 * like a statement) — see lib/statement-pdf.ts for an example. Leaving it
 * unset keeps the default single-document behavior unchanged.
 */
export async function renderHtmlToPdf(
  html: string,
  options?: { headerTemplate?: string; footerTemplate?: string },
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // "load" fires once every resource (including a logo <img>) has finished
    // loading or failed — "networkidle0"/"networkidle2" were dropped from
    // puppeteer-core's own waitUntil types in this version.
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMediaType("print");
    const displayHeaderFooter = !!(options?.headerTemplate || options?.footerTemplate);
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter,
      headerTemplate: options?.headerTemplate ?? "<span></span>",
      footerTemplate: options?.footerTemplate ?? "<span></span>",
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
