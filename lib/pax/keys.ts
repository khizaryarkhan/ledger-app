// A user's saved model and key. The key is encrypted at rest (lib/crypto.ts,
// AES-256-GCM) and is never part of anything returned to a browser: the public
// shape carries only its last four characters.

import { db } from "@/db";
import { userAiModels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { last4, type Tier } from "./providers";

export interface PublicModel {
  provider: string;
  model: string;
  baseUrl: string | null;
  keyLast4: string;
  tier: Tier;
}

export interface SecretModel extends PublicModel {
  apiKey: string;
}

const asTier = (t: string): Tier => (t === "full" ? "full" : "read");

export async function getPublicModel(userId: string): Promise<PublicModel | null> {
  const [r] = await db.select().from(userAiModels).where(eq(userAiModels.userId, userId)).limit(1);
  return r ? { provider: r.provider, model: r.model, baseUrl: r.baseUrl, keyLast4: r.keyLast4, tier: asTier(r.tier) } : null;
}

/** Server-only: decrypts the key to call the provider. Never return this to a client. */
export async function getSecretModel(userId: string): Promise<SecretModel | null> {
  const [r] = await db.select().from(userAiModels).where(eq(userAiModels.userId, userId)).limit(1);
  if (!r) return null;
  const apiKey = decryptSecret(r.apiKeyEnc);
  if (!apiKey) return null;
  return { provider: r.provider, model: r.model, baseUrl: r.baseUrl, keyLast4: r.keyLast4, tier: asTier(r.tier), apiKey };
}

export async function saveUserModel(a: {
  userId: string; provider: string; model: string; baseUrl: string | null; tier: Tier; apiKey: string;
}): Promise<PublicModel> {
  const enc = encryptSecret(a.apiKey);
  if (!enc) throw new Error("The key could not be stored.");
  const values = { provider: a.provider, model: a.model, baseUrl: a.baseUrl, apiKeyEnc: enc, keyLast4: last4(a.apiKey), tier: a.tier, updatedAt: new Date() };
  await db.insert(userAiModels).values({ userId: a.userId, ...values })
    .onConflictDoUpdate({ target: userAiModels.userId, set: values });
  return { provider: a.provider, model: a.model, baseUrl: a.baseUrl, keyLast4: values.keyLast4, tier: a.tier };
}

export async function deleteUserModel(userId: string): Promise<void> {
  await db.delete(userAiModels).where(eq(userAiModels.userId, userId));
}
