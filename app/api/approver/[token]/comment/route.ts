import { db } from "@/db";
import { apApprovalTokens, apBillComments } from "@/db/schema";
import { eq } from "drizzle-orm";

// POST /api/approver/[token]/comment  — approver adds a comment from the portal
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const [tokenRow] = await db.select().from(apApprovalTokens)
    .where(eq(apApprovalTokens.token, params.token))
    .limit(1);
  if (!tokenRow) return Response.json({ error: "Invalid link" }, { status: 410 });
  if (tokenRow.expiresAt < new Date()) return Response.json({ error: "Link expired" }, { status: 410 });

  const body = await req.json().catch(() => ({}));
  const text = (body.body ?? "").toString().trim().slice(0, 2000);
  if (!text) return Response.json({ error: "Comment body required" }, { status: 400 });

  const authorName = tokenRow.approverName ?? tokenRow.approverEmail;

  const [comment] = await db.insert(apBillComments).values({
    orgId: tokenRow.orgId,
    billId: tokenRow.billId,
    body: text,
    authorName,
    channel: "approver",
  }).returning();

  return Response.json(comment);
}
