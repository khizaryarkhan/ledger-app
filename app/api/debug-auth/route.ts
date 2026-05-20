import { NextResponse } from "next/server";

// Diagnostic endpoint removed — was publicly accessible and leaked env/user info.
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
