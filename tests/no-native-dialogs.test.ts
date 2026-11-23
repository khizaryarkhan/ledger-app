import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// A native confirm()/alert() is a browser popup: it looks foreign, some embedded
// browsers refuse it, it freezes automation, and the message a person most needs
// to read (why a delete was refused) lived in it. 88 of them were converted to
// lib/dialogs (askConfirm / tell), rendered by one <DialogHost /> as the shared
// centred Modal. This stops new ones appearing.
const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// Comments may mention the old calls; only real code counts.
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const NATIVE = /(^|[^A-Za-z0-9_.$])(confirm|alert)\(|window\.(confirm|alert)\(/;

describe("no native confirm()/alert()", () => {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];

  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no component or page calls the browser's confirm/alert", () => {
    const offenders = files
      .filter((f) => NATIVE.test(code(readFileSync(f, "utf8"))))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the dialog host is mounted once in the root layout", () => {
    const layout = readFileSync(join(ROOT, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("<DialogHost />");
  });

  it("a dialog with no host answers 'no', never 'yes'", () => {
    const lib = readFileSync(join(ROOT, "lib", "dialogs.ts"), "utf8");
    expect(lib).toMatch(/typeof window === "undefined"\) return Promise\.resolve\(false\)/);
  });
});
