// A user's own model and key for PAX Console.
//
//   GET     what is saved — never the key, only its last four characters
//   PUT     connect or change the model (tests the key first, then saves it)
//   DELETE  remove the model and key
//
// Per USER, not per organisation: the key and its cost belong to the person.

import { NextRequest } from "next/server";
import { z } from "zod";
import { bad, ok, requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { providerById, resolveEndpoint, tierFor } from "@/lib/pax/providers";
import { deleteUserModel, getPublicModel, getSecretModel, saveUserModel } from "@/lib/pax/keys";
import { describeProviderError, makeClient, testConnection } from "@/lib/pax/client";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { providerRefusal } from "@/lib/pax/policy";
import { loadOrgPolicy } from "@/lib/pax/policy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:/@+-]+$/, "That model name has characters a model id cannot contain."),
  baseUrl: z.string().max(300).nullish(),
  apiKey: z.string().trim().min(8, "That key looks too short.").max(400).optional(),
});

export async function GET() {
  const { error, session } = await requireOrg();
  if (error) return error;
  return ok({ model: await getPublicModel(userIdOf(session)) });
}

export async function PUT(req: NextRequest) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("PAX Console cannot be changed by an AI connection.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const userId = userIdOf(session);

  const limited = await rateLimit(`pax-save:${userId}`, 10, 60);
  if (!limited.ok) return bad("Too many attempts. Wait a minute and try again.", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const b = parsed.data;

  const provider = providerById(b.provider);
  if (!provider) return bad("That provider is not supported.");
  const ep = resolveEndpoint(provider, b.baseUrl);
  if (ep.ok === false) return bad(ep.error);
  // The organisation's rules (Your model → admin controls) bind what a user may connect.
  const refusal = providerRefusal(await loadOrgPolicy(orgId!), provider.id, !provider.baseUrl);
  if (refusal) return bad(refusal, 403);

  // The address is stored only when the user supplied it; a provider's own address is ours.
  const baseUrl = provider.baseUrl ? null : ep.url;

  let apiKey = b.apiKey;
  if (!apiKey) {
    const existing = await getSecretModel(userId);
    if (!existing) return bad("Paste your API key.");
    // A saved key is only ever sent to the place it was saved for. Pointing it
    // somewhere else needs the key typed again, so a hijacked session cannot
    // aim it at a host of its own choosing.
    if (existing.provider !== provider.id || (existing.baseUrl ?? null) !== baseUrl) {
      return bad("Paste your API key again to change the provider or the address.");
    }
    apiKey = existing.apiKey;
  }
  try {
    await testConnection(await makeClient({ provider: provider.id, baseUrl, apiKey }), b.model);
  } catch (e) {
    return bad(describeProviderError(e, [apiKey]), 400);
  }

  const saved = await saveUserModel({ userId, provider: provider.id, model: b.model, baseUrl, tier: tierFor(provider.id, b.model), apiKey });
  await logEvent({
    orgId: orgId!, eventType: "pax_model_saved", actorId: userId, actorName: (session?.user as { email?: string } | undefined)?.email ?? null,
    meta: { provider: saved.provider, model: saved.model, tier: saved.tier },
  }).catch(() => {});
  return ok({ model: saved });
}

export async function DELETE(req: NextRequest) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("PAX Console cannot be changed by an AI connection.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const userId = userIdOf(session);
  await deleteUserModel(userId);
  await logEvent({
    orgId: orgId!, eventType: "pax_model_removed", actorId: userId, actorName: (session?.user as { email?: string } | undefined)?.email ?? null, meta: {},
  }).catch(() => {});
  return ok({ model: null });
}
