// Turns a user's saved provider + key into a chat client, and turns a provider's
// failure into a sentence a person can act on — without ever echoing their key.

import OpenAI from "openai";
import { providerById, resolveEndpoint } from "./providers";
import { safeFetch } from "./safe-fetch";
import type { ChatClient } from "./agent";

// One call must leave room for several steps inside the route's 120s, and a
// retry would double it — a failed call is reported, not repeated.
const CALL_TIMEOUT_MS = 45_000;

export async function makeClient(m: { provider: string; baseUrl: string | null; apiKey: string }): Promise<ChatClient> {
  const p = providerById(m.provider);
  if (!p) throw new Error("That provider is not supported.");
  const ep = resolveEndpoint(p, m.baseUrl);
  if (ep.ok === false) throw new Error(ep.error);
  return new OpenAI({
    apiKey: m.apiKey,
    baseURL: ep.url,
    timeout: CALL_TIMEOUT_MS,
    maxRetries: 0,
    // An address the USER typed gets a fetch that refuses redirects and checks the
    // resolved address at connect time. A provider's own address is ours to name.
    ...(p.baseUrl ? {} : { fetch: safeFetch }),
  }) as unknown as ChatClient;
}

/** One tiny request, to prove the key, the model name and the address all work before anything is saved. */
export async function testConnection(client: ChatClient, model: string): Promise<void> {
  await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with the single word OK." }] });
}

export function describeProviderError(e: unknown, secrets: string[] = []): string {
  const err = e as { status?: number; name?: string; message?: string } | null;
  if (err?.message === "Cancelled.") return "Cancelled.";
  if (err?.name === "AbortError" || err?.name === "TimeoutError" || /timed? ?out/i.test(err?.message ?? "")) {
    return "The model took too long to answer. Try again, or pick a faster model.";
  }
  switch (err?.status) {
    case 401: case 403: return "The provider rejected this key. Check that it is correct and has access to this model.";
    case 404: return "The provider does not know this model or address. Check the model name.";
    case 429: return "The provider is limiting this key, or the account has no credit left.";
    case 400: break;
    default: if (typeof err?.status === "number" && err.status >= 500) return "The provider is having trouble right now. Try again in a moment.";
  }
  let msg = String(err?.message ?? "The model could not be reached.");
  for (const s of secrets) if (s) msg = msg.split(s).join("[key]");
  return msg.replace(/\s+/g, " ").trim().slice(0, 200) || "The model could not be reached.";
}
