// The organisation's rules for PAX Console, and each user's consent.
//
//   GET   the rules in force, whether this user has accepted the data notice, whether they are an admin
//   PUT   (admin) which providers are allowed, custom endpoints, whether changes may be proposed, the notice text
//   POST  the signed-in user accepts the data notice

import { NextRequest } from "next/server";
import { z } from "zod";
import { bad, ok, requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { DEFAULT_CONSENT, isOrgAdminRole } from "@/lib/pax/policy";
import { hasConsented, loadOrgPolicy, recordConsent, saveOrgPolicy } from "@/lib/pax/policy-server";
import { providerById } from "@/lib/pax/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  allowedProviders: z.array(z.string().min(1).max(40)).max(80).nullable(),
  allowCustomEndpoints: z.boolean(),
  writesEnabled: z.boolean(),
  consentText: z.string().max(1500).nullable(),
}).strict();

const actor = (s: unknown) => (s as { user?: { email?: string } } | null)?.user?.email ?? null;

export async function GET() {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const userId = userIdOf(session);
  const [policy, consented] = await Promise.all([loadOrgPolicy(orgId!), hasConsented(userId, orgId!)]);
  return ok({ policy, consentText: policy.consentText ?? DEFAULT_CONSENT, consented, isAdmin: isOrgAdminRole(role) });
}

export async function PUT(req: NextRequest) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("PAX Console cannot be changed by an AI connection.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  if (!isOrgAdminRole(role)) return bad("Only an organisation admin can change these rules.", 403);
  const userId = userIdOf(session);

  const limited = await rateLimit(`pax-policy:${userId}`, 20, 60);
  if (!limited.ok) return bad("Too many changes. Wait a minute.", 429);

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Check the settings and try again.");
  const b = parsed.data;
  const unknown = (b.allowedProviders ?? []).find((id) => !providerById(id));
  if (unknown) return bad(`"${unknown}" is not a provider PAX Console supports.`);
  if (b.allowedProviders && b.allowedProviders.length === 0) return bad("Allow at least one provider, or allow all of them.");

  const next = {
    allowedProviders: b.allowedProviders ? [...new Set(b.allowedProviders)] : null,
    allowCustomEndpoints: b.allowCustomEndpoints,
    writesEnabled: b.writesEnabled,
    consentText: b.consentText?.trim() ? b.consentText.trim() : null,
  };
  await saveOrgPolicy(orgId!, userId, next);
  await logEvent({
    orgId: orgId!, eventType: "pax_policy_saved", actorId: userId, actorName: actor(session),
    meta: { providers: next.allowedProviders ?? "all", customEndpoints: next.allowCustomEndpoints, writes: next.writesEnabled },
  }).catch(() => {});
  return ok({ policy: next });
}

export async function POST(req: NextRequest) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("A person has to accept this.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const userId = userIdOf(session);
  await recordConsent(userId, orgId!);
  await logEvent({ orgId: orgId!, eventType: "pax_consent", actorId: userId, actorName: actor(session), meta: {} }).catch(() => {});
  return ok({ consented: true });
}
