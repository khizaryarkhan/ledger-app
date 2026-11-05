// The model providers a PAX Console user can connect, and the rules for the one
// thing a user supplies that we then call from the server: an endpoint address.
//
// Pure (no db, no network) so it is client-safe — the settings screen imports it
// for the drop-down — and so the money-adjacent rules can be proven in tests.
//
// Nearly every provider speaks the OpenAI chat-completions API, so one adapter
// (the `openai` SDK with a baseURL) reaches all of them. Where a provider's
// address is not certain it is left for the user to enter (`needsBaseUrl`),
// never guessed: a wrong address would send a user's key somewhere else.

export type ProviderGroup =
  | "Major labs" | "China-based labs" | "Open-model hosts" | "Gateways" | "Cloud platforms" | "Your own computer or server";

export interface Provider {
  id: string;
  label: string;
  group: ProviderGroup;
  /** Fixed address, or null when the user supplies one. */
  baseUrl: string | null;
  needsBaseUrl: boolean;
  /** False = listed so people can see it is planned, but cannot be saved yet. */
  ready: boolean;
  note?: string;
  /** Suggestions only — the model field accepts any id, because models change monthly. */
  models: readonly string[];
}

const fixed = (id: string, label: string, group: ProviderGroup, baseUrl: string, models: readonly string[]): Provider =>
  ({ id, label, group, baseUrl, needsBaseUrl: false, ready: true, models });
const ownUrl = (id: string, label: string, group: ProviderGroup, models: readonly string[] = []): Provider =>
  ({ id, label, group, baseUrl: null, needsBaseUrl: true, ready: true, models });
const later = (id: string, label: string, group: ProviderGroup, note: string): Provider =>
  ({ id, label, group, baseUrl: null, needsBaseUrl: false, ready: false, note, models: [] });

export const PROVIDERS: readonly Provider[] = [
  fixed("anthropic", "Anthropic", "Major labs", "https://api.anthropic.com/v1", ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]),
  fixed("openai", "OpenAI", "Major labs", "https://api.openai.com/v1", ["gpt-4.1", "gpt-4o-mini"]),
  fixed("google", "Google (Gemini)", "Major labs", "https://generativelanguage.googleapis.com/v1beta/openai", ["gemini-2.5-pro", "gemini-2.5-flash"]),
  fixed("xai", "xAI (Grok)", "Major labs", "https://api.x.ai/v1", ["grok-4", "grok-3-mini"]),
  fixed("mistral", "Mistral", "Major labs", "https://api.mistral.ai/v1", ["mistral-large-latest", "mistral-small-latest"]),
  fixed("cohere", "Cohere", "Major labs", "https://api.cohere.ai/compatibility/v1", ["command-a-03-2025"]),
  fixed("perplexity", "Perplexity", "Major labs", "https://api.perplexity.ai", ["sonar-pro"]),
  ownUrl("ai21", "AI21", "Major labs"),

  fixed("deepseek", "DeepSeek", "China-based labs", "https://api.deepseek.com/v1", ["deepseek-chat", "deepseek-reasoner"]),
  fixed("moonshot", "Moonshot (Kimi)", "China-based labs", "https://api.moonshot.ai/v1", ["kimi-k2-0905-preview"]),
  fixed("alibaba", "Alibaba (Qwen)", "China-based labs", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", ["qwen-plus", "qwen-max"]),
  fixed("zhipu", "Zhipu (GLM)", "China-based labs", "https://open.bigmodel.cn/api/paas/v4", ["glm-4.6"]),
  fixed("minimax", "MiniMax", "China-based labs", "https://api.minimax.io/v1", ["MiniMax-M2"]),
  fixed("bytedance", "ByteDance (Doubao)", "China-based labs", "https://ark.cn-beijing.volces.com/api/v3", []),
  fixed("baidu", "Baidu (ERNIE)", "China-based labs", "https://qianfan.baidubce.com/v2", []),
  fixed("tencent", "Tencent (Hunyuan)", "China-based labs", "https://api.hunyuan.cloud.tencent.com/v1", []),
  ownUrl("01ai", "01.AI (Yi)", "China-based labs"),

  fixed("meta-llama", "Meta Llama", "Open-model hosts", "https://api.llama.com/compat/v1", ["Llama-3.3-70B-Instruct"]),
  fixed("groq", "Groq", "Open-model hosts", "https://api.groq.com/openai/v1", ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]),
  fixed("together", "Together AI", "Open-model hosts", "https://api.together.xyz/v1", ["meta-llama/Llama-3.3-70B-Instruct-Turbo"]),
  fixed("fireworks", "Fireworks", "Open-model hosts", "https://api.fireworks.ai/inference/v1", ["accounts/fireworks/models/llama-v3p3-70b-instruct"]),
  fixed("cerebras", "Cerebras", "Open-model hosts", "https://api.cerebras.ai/v1", ["llama-3.3-70b"]),
  fixed("sambanova", "SambaNova", "Open-model hosts", "https://api.sambanova.ai/v1", []),
  fixed("huggingface", "Hugging Face", "Open-model hosts", "https://router.huggingface.co/v1", []),
  fixed("nebius", "Nebius", "Open-model hosts", "https://api.studio.nebius.com/v1", []),
  fixed("nvidia", "NVIDIA NIM", "Open-model hosts", "https://integrate.api.nvidia.com/v1", []),
  fixed("deepinfra", "DeepInfra", "Open-model hosts", "https://api.deepinfra.com/v1/openai", []),
  later("replicate", "Replicate", "Open-model hosts", "Needs its own connector — planned."),

  fixed("openrouter", "OpenRouter", "Gateways", "https://openrouter.ai/api/v1", ["openai/gpt-4.1", "deepseek/deepseek-chat"]),
  fixed("vercel-gateway", "Vercel AI Gateway", "Gateways", "https://ai-gateway.vercel.sh/v1", []),
  ownUrl("litellm", "LiteLLM", "Gateways"),

  // Azure's current "v1" API is OpenAI-compatible at https://<resource>.openai.azure.com/openai/v1 and the
  // model field is your DEPLOYMENT name. Save-and-test calls it before anything is stored.
  ownUrl("azure", "Azure OpenAI", "Cloud platforms"),
  later("bedrock", "Amazon Bedrock", "Cloud platforms", "Signs requests with AWS credentials — planned."),
  later("vertex", "Google Vertex AI", "Cloud platforms", "Signs requests with Google credentials — planned."),
  // Model Serving is OpenAI-compatible at https://<workspace>/serving-endpoints with a personal access token.
  ownUrl("databricks", "Databricks", "Cloud platforms"),
  later("watsonx", "IBM watsonx", "Cloud platforms", "Planned."),

  later("ollama", "Ollama", "Your own computer or server", "Runs on your own computer, so it is called from your browser — planned."),
  later("lmstudio", "LM Studio", "Your own computer or server", "Runs on your own computer, so it is called from your browser — planned."),
  later("llamacpp", "llama.cpp server", "Your own computer or server", "Runs on your own computer, so it is called from your browser — planned."),
  ownUrl("vllm", "vLLM", "Your own computer or server"),
  ownUrl("custom", "Custom endpoint", "Your own computer or server"),
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
export const providerById = (id: unknown): Provider | null => (typeof id === "string" ? BY_ID.get(id) ?? null : null);

// ── Addresses ───────────────────────────────────────────────────────────────

/** True for an address that must never be called on a user's behalf: loopback, private, link-local, metadata. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (v.includes(":")) {
    const g = parseIpv6(v);
    if (!g) return true; // an address we cannot read is not one we call
    if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and the old IPv4-compatible range
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(v4of(g[6], g[7])); // IPv4-mapped, in dotted OR hex form
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4of(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return isPrivateAddress(v4of(g[1], g[2])); // 6to4 carries an IPv4 address
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo and documentation ranges
    // An allowlist, not a denylist: only global unicast (2000::/3) is ever called.
    return !(g[0] >= 0x2000 && g[0] <= 0x3fff);
  }
  return false;
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not a well-formed one. */
function parseIpv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] | null = null;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = `${s.slice(0, dotted.index)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (parts.length !== 8 || !parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  const groups = parts.map((p) => parseInt(p, 16));
  if (tail) { groups[6] = tail[0]; groups[7] = tail[1]; }
  return groups;
}

const v4of = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

export type Endpoint = { ok: true; url: string } | { ok: false; error: string };

const PRIVATE_MSG = "That address points at a private or local machine, which the server cannot reach safely.";

/**
 * A user-supplied endpoint is called from OUR server with the user's key, so it
 * must be a public https address. This is the syntactic half; callers also run
 * `assertPublicHost` (lib/pax/ssrf.ts) to catch a public-looking name that
 * resolves to a private address.
 */
export function validateEndpoint(raw: unknown): Endpoint {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Enter the endpoint address." };
  const text = raw.trim();
  if (text.length > 300) return { ok: false, error: "That address is too long." };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, error: "That is not a valid address. It should look like https://your-server/v1" }; }
  if (u.protocol !== "https:") return { ok: false, error: "The endpoint must start with https://" };
  if (u.username || u.password) return { ok: false, error: "Do not put a username or password in the address." };
  // https's own port is dropped by URL; anything left is a non-standard port, which is how internal services are probed.
  if (u.port) return { ok: false, error: "Only the standard https port is allowed in the address." };
  const host = u.hostname.toLowerCase();
  if (!host || host.startsWith("[")) return { ok: false, error: PRIVATE_MSG };
  if (host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) return { ok: false, error: PRIVATE_MSG };
  if (isPrivateAddress(host)) return { ok: false, error: PRIVATE_MSG };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}

export function resolveEndpoint(p: Provider, userBaseUrl: unknown): Endpoint {
  if (!p.ready) return { ok: false, error: `${p.label} is not available yet.` };
  if (p.baseUrl) return { ok: true, url: p.baseUrl }; // a user value is ignored: the address is ours to name
  return validateEndpoint(userBaseUrl);
}

// ── Tier ────────────────────────────────────────────────────────────────────

/** Models whose tool calling has not been shown to be reliable stay read-only. */
const UNTESTED_PROVIDERS = new Set(["custom", "vllm", "litellm", "llamacpp", "ollama", "lmstudio"]);
const SMALL_WORDS = /(^|[^a-z0-9])(mini|nano|lite|small|tiny|instant|phi|gemma)([^a-z0-9]|$)/i;
const REASONERS = /(^|[^a-z0-9])(r1|reasoner|o1|o3)([^a-z0-9]|$)/i;

export type Tier = "full" | "read";

/**
 * "full" means a model may later be offered tools that change data; "read"
 * means never. Conservative on purpose: a wrong change to someone's books costs
 * far more than a missed convenience. Phase 1 only reads, so this is stored now
 * and not yet acted on.
 */
export function tierFor(providerId: string, model: string): Tier {
  if (UNTESTED_PROVIDERS.has(providerId)) return "read";
  if (SMALL_WORDS.test(model) || REASONERS.test(model)) return "read";
  const size = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?:[^a-z]|$)/i.exec(model);
  if (size && Number(size[1]) <= 14) return "read";
  return "full";
}

export const last4 = (key: string): string => key.replace(/[^A-Za-z0-9]/g, "").slice(-4) || "????";
