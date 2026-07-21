/**
 * POST /api/org/logo — upload the organisation's logo.
 *
 * Admins only. Stores the file in Vercel Blob and returns its public URL,
 * which the client then saves to organisations.logo_url via the normal
 * org-settings PATCH. Mirrors the guide-upload pattern.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — logos should be small

export async function POST(req: NextRequest) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Logo upload isn't configured. Create a Blob store in Vercel and add BLOB_READ_WRITE_TOKEN, then redeploy." },
      { status: 503 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return bad("Expected a multipart form with a 'file' field.");
  }

  if (!file) return bad("No file provided.");
  if (!file.type.startsWith("image/")) return bad("Only image files are allowed (PNG, JPG, or SVG).");
  if (file.size > MAX_BYTES) return bad("Logo must be 4 MB or smaller.");

  try {
    const ext = (file.name.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "png";
    const blob = await put(`org-logos/${orgId}.${ext}`, file, {
      access: "public",
      addRandomSuffix: true, // avoids CDN caching an old logo at the same path
      contentType: file.type,
    });
    return ok({ url: blob.url });
  } catch (e: any) {
    return bad(`Upload failed: ${e?.message ?? "unknown error"}`, 500);
  }
}
