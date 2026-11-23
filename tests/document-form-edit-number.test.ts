import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Opening a saved document from its own page passes the id as the editId PROP, with no
// ?edit= in the URL. The form's startup fetched the next free number and, seeing no
// ?edit=, wrote it over the stored one, so INV-0005 showed as INV-0006 and saving
// would have renumbered it. The "am I editing?" test must count the prop.
describe("document form keeps a saved document's own number", () => {
  const src = readFileSync(join(__dirname, "..", "components", "new-document-form.tsx"), "utf8");

  it("the number suggestion is skipped when editId is passed as a prop", () => {
    expect(src).toMatch(/const editing = editIdProp \|\|/);
  });

  it("the suggestion is still applied only when not editing", () => {
    expect(src).toMatch(/if \(num\?\.docNumber && !editing\) setDocNumber/);
  });
});
