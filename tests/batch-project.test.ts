/**
 * QBO has no separate "Project" API object — a Project IS a Customer record
 * with Job:true and a ParentRef (see CLAUDE.md's "Projects & custom fields"
 * section). buildProject models that: a parent Customer is required to
 * CREATE one (QBO itself refuses a parentless Job), but not re-required on
 * an update, since shapeModifyPayload's sparse patch leaves an omitted field
 * untouched rather than clearing it.
 */
import { describe, it, expect } from "vitest";
import { buildProject } from "@/lib/batch/builders";
import type { RefResolver } from "@/lib/batch/ref-resolver";

function fakeResolver(resolved: Record<string, { value: string; name: string } | null>): RefResolver {
  return {
    tryResolve: async (_kind: string, rawName: string | null | undefined) =>
      rawName ? (resolved[rawName] ?? null) : null,
  } as unknown as RefResolver;
}

const row = (overrides: Record<string, any>) => ({ key: "k", rows: [overrides] });

describe("buildProject", () => {
  it("requires a Project Name", async () => {
    const refs = fakeResolver({});
    await expect(buildProject(row({ Customer: "Acme" }), refs)).rejects.toThrow(/Project Name/);
  });

  it("requires a parent Customer to create a new project", async () => {
    const refs = fakeResolver({});
    await expect(buildProject(row({ "Project Name": "Kitchen Remodel" }), refs)).rejects.toThrow(/parent/i);
  });

  it("builds Job:true with the resolved ParentRef on create", async () => {
    const refs = fakeResolver({ Acme: { value: "42", name: "Acme" } });
    const { payload } = await buildProject(row({ "Project Name": "Kitchen Remodel", Customer: "Acme" }), refs);
    expect(payload.Job).toBe(true);
    expect(payload.ParentRef).toEqual({ value: "42" });
    expect(payload.DisplayName).toBe("Kitchen Remodel");
  });

  it("does not require a parent when updating an existing project (Id present)", async () => {
    const refs = fakeResolver({});
    const { payload } = await buildProject(
      row({ Id: "99", "Project Name": "Kitchen Remodel (renamed)" }),
      refs,
    );
    expect(payload.Id).toBe("99");
    expect(payload.DisplayName).toBe("Kitchen Remodel (renamed)");
  });

  it("carries custom field edits through as __customFieldEdits, stripped later by shapeModifyPayload", async () => {
    const refs = fakeResolver({ Acme: { value: "42", name: "Acme" } });
    const { payload } = await buildProject(
      row({ "Project Name": "Kitchen Remodel", Customer: "Acme", "Custom Field Value (1)": "Gold" }),
      refs,
    );
    expect((payload as any).__customFieldEdits).toEqual({ 0: "Gold" });
  });
});
