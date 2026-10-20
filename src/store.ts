export interface Env {
  ENDPOINTS: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated emails or "*@domain.com" patterns allowed to sign in with Google. */
  ALLOWED_EMAILS: string;
}

export const FORMATS = {
  json: "application/json; charset=utf-8",
  text: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
} as const;

export const FORMAT_NAMES = [...Object.keys(FORMATS), "custom"] as const;
export type Format = keyof typeof FORMATS | "custom";
export const METHODS = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export interface Endpoint {
  slug: string;
  method: Method;
  status: number;
  format: Format;
  contentType?: string;
  body: string;
  headers: Record<string, string>;
  delayMs: number;
  description?: string;
  /** Optional: callers must send the chosen API key in `header`. Absent = public. */
  protection?: { keyId: string; header: string };
  createdAt: string;
  updatedAt: string;
}

/** Result of a store operation: either data with an HTTP-like status, or an error. */
export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** KV key prefix an endpoint set lives under. Global = legacy set managed by ADMIN_TOKEN. */
export const GLOBAL_NS = "ep:";
export const userNs = (uid: string) => `uep:${uid}:`;
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._~\-/]{0,199}$/;

export function normalizeSlug(raw: string): string {
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* keep raw */ }
  return s.trim().replace(/^\/+|\/+$/g, "");
}

export function contentTypeFor(ep: Endpoint): string {
  if (ep.format === "custom") return ep.contentType || "application/octet-stream";
  return FORMATS[ep.format];
}

function validate(input: any, slug: string, existing?: Endpoint | null): Endpoint | string {
  if (!SLUG_RE.test(slug) || slug.includes("//")) {
    return "Invalid slug. Use letters, numbers, '-', '_', '.', '~' and '/' (max 200 chars).";
  }
  const method = String(input.method ?? "ANY").toUpperCase() as Method;
  if (!METHODS.includes(method)) return `Invalid method. Allowed: ${METHODS.join(", ")}`;

  const status = Number(input.status ?? 200);
  if (!Number.isInteger(status) || status < 200 || status > 599) return "Status must be an integer between 200 and 599.";

  const format = String(input.format ?? "json") as Format;
  if (!(FORMAT_NAMES as readonly string[]).includes(format)) return `Invalid format. Allowed: ${FORMAT_NAMES.join(", ")}`;
  if (format === "custom" && !input.contentType) return "contentType is required when format is 'custom'.";

  const body = typeof input.body === "string" ? input.body : JSON.stringify(input.body ?? "");
  if (format === "json" && body.trim() !== "") {
    try { JSON.parse(body); } catch { return "Body is not valid JSON."; }
  }

  const headers = input.headers ?? {};
  if (typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== "string")) {
    return "headers must be an object of string values.";
  }

  const delayMs = Number(input.delayMs ?? 0);
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10000) return "delayMs must be between 0 and 10000.";

  let protection: Endpoint["protection"];
  if (input.protection != null) {
    const { keyId, header = "Authorization" } = input.protection;
    if (typeof keyId !== "string" || !/^[a-f0-9]{8}$/.test(keyId)) return "protection.keyId must be the id of one of your API keys.";
    if (typeof header !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(header)) return "protection.header must be a valid header name (letters, numbers, '-').";
    protection = { keyId, header };
  }

  const now = new Date().toISOString();
  return {
    slug,
    method,
    status,
    format,
    contentType: format === "custom" ? String(input.contentType) : undefined,
    body,
    headers,
    delayMs,
    description: input.description ? String(input.description).slice(0, 500) : undefined,
    protection,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function getEndpoint(env: Env, ns: string, slug: string): Promise<Endpoint | null> {
  return env.ENDPOINTS.get<Endpoint>(ns + normalizeSlug(slug), "json");
}

export async function listEndpoints(env: Env, ns: string): Promise<Endpoint[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ENDPOINTS.list({ prefix: ns, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const items = await Promise.all(keys.map((k) => env.ENDPOINTS.get<Endpoint>(k, "json")));
  return items.filter((x): x is Endpoint => !!x).sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function createEndpoint(env: Env, ns: string, input: any): Promise<Result<Endpoint>> {
  if (!input || typeof input !== "object") return { ok: false, status: 400, error: "Invalid input" };
  const slug = normalizeSlug(String(input.slug ?? ""));
  if (await env.ENDPOINTS.get(ns + slug)) return { ok: false, status: 409, error: `Slug '${slug}' already exists` };
  const ep = validate(input, slug);
  if (typeof ep === "string") return { ok: false, status: 400, error: ep };
  await env.ENDPOINTS.put(ns + slug, JSON.stringify(ep));
  return { ok: true, status: 201, data: ep };
}

/** Partial update: fields not provided keep their current value. Supports renaming via `slug`. */
export async function updateEndpoint(env: Env, ns: string, rawSlug: string, input: any): Promise<Result<Endpoint>> {
  if (!input || typeof input !== "object") return { ok: false, status: 400, error: "Invalid input" };
  const slug = normalizeSlug(rawSlug);
  const existing = await getEndpoint(env, ns, slug);
  if (!existing) return { ok: false, status: 404, error: `Endpoint '${slug}' not found` };
  const newSlug = input.slug !== undefined ? normalizeSlug(String(input.slug)) : slug;
  if (newSlug !== slug && (await env.ENDPOINTS.get(ns + newSlug))) {
    return { ok: false, status: 409, error: `Slug '${newSlug}' already exists` };
  }
  const ep = validate({ ...existing, ...input }, newSlug, existing);
  if (typeof ep === "string") return { ok: false, status: 400, error: ep };
  await env.ENDPOINTS.put(ns + newSlug, JSON.stringify(ep));
  if (newSlug !== slug) await env.ENDPOINTS.delete(ns + slug);
  return { ok: true, status: 200, data: ep };
}

export async function deleteEndpoint(env: Env, ns: string, rawSlug: string): Promise<Result<{ deleted: string }>> {
  const slug = normalizeSlug(rawSlug);
  if (!(await getEndpoint(env, ns, slug))) return { ok: false, status: 404, error: `Endpoint '${slug}' not found` };
  await env.ENDPOINTS.delete(ns + slug);
  return { ok: true, status: 200, data: { deleted: slug } };
}
