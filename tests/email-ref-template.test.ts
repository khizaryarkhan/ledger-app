import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fillTemplate } from "@/lib/email-template";

const ROOT = join(__dirname, "..");

describe("bulk send modal never bakes a literal ref into the default subject", () => {
  it("uses the {ref} placeholder, resolved server-side, not a client-generated value", () => {
    const src = readFileSync(join(ROOT, "components/send-invoices-modal.tsx"), "utf8");

    // Regression for: the default subject used to be built as
    // `Open Invoices — Ref ${baseRef}` with baseRef = genEmailRef() called in
    // the browser. The server (lib/bulk-send.ts) then generated its OWN,
    // different ref and stored it as the communication's refNumber — so the
    // "Last Email Ref" column never matched the ref actually printed in the
    // email the customer received, and every recipient of a multi-customer
    // send saw the SAME baked-in ref in their subject regardless of which
    // customer's refNumber was recorded for them.
    expect(src).not.toMatch(/useState\(genEmailRef\)/);
    expect(src).not.toMatch(/Ref \$\{baseRef\}/);
    expect(src).toMatch(/Open Invoices — Ref \{ref\}/);
  });

  it("fillTemplate resolves {ref} the same way the server does when sending", () => {
    // lib/bulk-send.ts's sendGroupEmail() generates one ref per group and
    // fills the user-composed subject with it via fillTemplate — the same
    // substitution exercised here. If the default subject stopped containing
    // a {ref} token, the sent email would carry no reference at all.
    const subject = fillTemplate("Open Invoices — Ref {ref}", { ref: "AR-261006-GOMK" });
    expect(subject).toBe("Open Invoices — Ref AR-261006-GOMK");
  });
});
