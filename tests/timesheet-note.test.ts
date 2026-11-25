import { describe, it, expect } from "vitest";
import { cleanNote } from "@/lib/resources/timesheet-lines-server";

describe("cleanNote (the optional note a person sends to their approver)", () => {
  it("returns null for anything that is not text, or is only whitespace", () => {
    expect(cleanNote(undefined)).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote("   \n\t ")).toBeNull();
  });

  it("trims and collapses whitespace so a note stays on one line", () => {
    expect(cleanNote("  Site visit \n on   Tuesday ")).toBe("Site visit on Tuesday");
  });

  it("keeps at most 255 characters, the width of time_entries.description", () => {
    const out = cleanNote("x".repeat(400));
    expect(out).toHaveLength(255);
  });
});
