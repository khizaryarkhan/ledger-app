import { requireOrg, ok, bad } from "@/lib/api";
import { getValidGmailToken } from "@/lib/gmail";
import { z } from "zod";

const Schema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  replyTo: z.string().optional(),
});

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const token = await getValidGmailToken(orgId!);
  if (!token) return bad("Gmail not connected for this organisation. An admin can connect it from Settings → Integrations.", 400);

  try {
    const data = Schema.parse(await req.json());

    // Build RFC 2822 email
    const emailLines = [
      `From: ${token.email}`,
      `To: ${data.to}`,
      `Subject: ${data.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      data.body,
    ];
    const raw = Buffer.from(emailLines.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.json();
      return bad(`Gmail send failed: ${err.error?.message || "Unknown error"}`, 500);
    }

    return ok({ sent: true, from: token.email });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to send email", 500);
  }
}
