import { requirePlatformAdmin } from "@/lib/billing";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// Upload a screenshot for the guide editor. Platform admin only.
// Stores the file in Vercel Blob and returns its public URL.
export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Image upload isn't configured yet. Create a Blob store in Vercel and add the BLOB_READ_WRITE_TOKEN env var, then redeploy." },
      { status: 503 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Expected a multipart form with a 'file' field." }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image files are allowed." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be 8 MB or smaller." }, { status: 400 });

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "screenshot.png";
    const blob = await put(`guide/${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: `Upload failed: ${(e as any)?.message ?? "unknown error"}` }, { status: 500 });
  }
}
