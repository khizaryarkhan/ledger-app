import { db } from "@/db";
import { orgEmailSettings } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  ccEmail:   z.string().email().optional().or(z.literal("")),
  ccEnabled: z.boolean(),
});

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [row] = await db
    .select({ ccEmail: orgEmailSettings.ccEmail, ccEnabled: orgEmailSettings.ccEnabled })
    .from(orgEmailSettings)
    .where(eq(orgEmailSettings.orgId, orgId!))
    .limit(1);

  return ok({ ccEmail: row?.ccEmail ?? "", ccEnabled: row?.ccEnabled ?? false });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  try {
    const data = Schema.parse(await req.json());
    const ccEmail   = data.ccEmail || null;
    const ccEnabled = data.ccEnabled;

    const [existing] = await db
      .select({ id: orgEmailSettings.id })
      .from(orgEmailSettings)
      .where(eq(orgEmailSettings.orgId, orgId!))
      .limit(1);

    if (existing) {
      await db
        .update(orgEmailSettings)
        .set({ ccEmail, ccEnabled, updatedAt: new Date() })
        .where(eq(orgEmailSettings.orgId, orgId!));
    } else {
      await db.insert(orgEmailSettings).values({ orgId: orgId!, ccEmail, ccEnabled });
    }

    return ok({ saved: true });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to save email defaults", 500);
  }
}
