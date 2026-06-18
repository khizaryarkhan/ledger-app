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

  // Resolve all bill IDs — batch tokens use billIds[], single-bill tokens use billId
  const billIds: string[] = (tokenRow.billIds && (tokenRow.billIds as string[]).length > 0)
    ? (tokenRow.billIds as string[])
    : (tokenRow.billId ? [tokenRow.billId] : []);

  if (billIds.length === 0) return Response.json({ error: "No bills found for this token" }, { status: 400 });

  // Insert a comment linked to each bill in the batch so it appears in every bill's thread
  const inserted = await Promise.all(
    billIds.map(billId =>
      db.insert(apBillComments).values({
        orgId: tokenRow.orgId,
        billId,
        body: text,
        authorName,
        channel: "approver",
      }).returning()
    )
  );

  // Return the first comment for optimistic UI update (prevents duplicates in the chat view)
  return Response.json(inserted[0][0]);
}
