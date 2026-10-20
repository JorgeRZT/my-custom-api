export interface Env {
  ENDPOINTS: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
}

const FORMATS = {
  json: "application/json; charset=utf-8",
  text: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
} as const;

type Format = keyof typeof FORMATS | "custom";
const METHODS = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

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
  createdAt: string;
  updatedAt: string;
}

const KEY_PREFIX = "ep:";
const SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._~\-/]{0,199}$/;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": FORMATS.json, ...extra },
  });
}

function normalizeSlug(raw: string): string {
  return decodeURIComponent(raw).replace(/^\/+|\/+$/g, "");
}

function contentTypeFor(ep: Endpoint): string {
  if (ep.format === "custom") return ep.contentType || "application/octet-stream";
  return FORMATS[ep.format];
}

// ---------- Public API ----------

async function handlePublic(req: Request, env: Env, slug: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const ep = await env.ENDPOINTS.get<Endpoint>(KEY_PREFIX + slug, "json");
  if (!ep) return json({ error: "Endpoint not found", slug }, 404, CORS);

  const method = req.method === "HEAD" ? "GET" : req.method;
  if (ep.method !== "ANY" && ep.method !== method) {
    return json({ error: "Method not allowed", allowed: ep.method }, 405, { ...CORS, Allow: ep.method });
  }

  if (ep.delayMs > 0) await new Promise((r) => setTimeout(r, Math.min(ep.delayMs, 10000)));

  const noBody = req.method === "HEAD" || ep.status === 204 || ep.status === 304;
  return new Response(noBody ? null : ep.body, {
    status: ep.status,
    headers: { ...CORS, "Content-Type": contentTypeFor(ep), ...ep.headers },
  });
}

// ---------- Admin API ----------

function isAuthorized(req: Request, env: Env): boolean {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.ADMIN_TOKEN || !token || token.length !== env.ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

function validate(input: any, slug: string, existing?: Endpoint | null): Endpoint | string {
  if (!SLUG_RE.test(slug) || slug.includes("//")) {
    return "Invalid slug. Use letters, numbers, '-', '_', '.', '~' and '/' (max 200 chars).";
  }
  const method = (input.method ?? "ANY").toUpperCase();
  if (!METHODS.includes(method)) return `Invalid method. Allowed: ${METHODS.join(", ")}`;

  const status = Number(input.status ?? 200);
  if (!Number.isInteger(status) || status < 200 || status > 599) return "Status must be an integer between 200 and 599.";

  const format = (input.format ?? "json") as Format;
  if (!(format in FORMATS) && format !== "custom") return "Invalid format.";
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function listAll(env: Env): Promise<Endpoint[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ENDPOINTS.list({ prefix: KEY_PREFIX, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const items = await Promise.all(keys.map((k) => env.ENDPOINTS.get<Endpoint>(k, "json")));
  return items.filter((x): x is Endpoint => !!x).sort((a, b) => a.slug.localeCompare(b.slug));
}

async function handleAdmin(req: Request, env: Env, path: string): Promise<Response> {
  if (!isAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);

  if (path === "endpoints" || path === "endpoints/") {
    if (req.method === "GET") return json(await listAll(env));
    if (req.method === "POST") {
      const input = await req.json<any>().catch(() => null);
      if (!input) return json({ error: "Invalid JSON body" }, 400);
      const slug = normalizeSlug(String(input.slug ?? ""));
      if (await env.ENDPOINTS.get(KEY_PREFIX + slug)) return json({ error: "Slug already exists" }, 409);
      const ep = validate(input, slug);
      if (typeof ep === "string") return json({ error: ep }, 400);
      await env.ENDPOINTS.put(KEY_PREFIX + slug, JSON.stringify(ep));
      return json(ep, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path.startsWith("endpoints/")) {
    const slug = normalizeSlug(path.slice("endpoints/".length));
    const key = KEY_PREFIX + slug;
    const existing = await env.ENDPOINTS.get<Endpoint>(key, "json");
    if (!existing) return json({ error: "Not found" }, 404);

    if (req.method === "GET") return json(existing);
    if (req.method === "DELETE") {
      await env.ENDPOINTS.delete(key);
      return new Response(null, { status: 204 });
    }
    if (req.method === "PUT") {
      const input = await req.json<any>().catch(() => null);
      if (!input) return json({ error: "Invalid JSON body" }, 400);
      const newSlug = input.slug !== undefined ? normalizeSlug(String(input.slug)) : slug;
      if (newSlug !== slug && (await env.ENDPOINTS.get(KEY_PREFIX + newSlug))) {
        return json({ error: "Slug already exists" }, 409);
      }
      const ep = validate(input, newSlug, existing);
      if (typeof ep === "string") return json({ error: ep }, 400);
      await env.ENDPOINTS.put(KEY_PREFIX + newSlug, JSON.stringify(ep));
      if (newSlug !== slug) await env.ENDPOINTS.delete(key);
      return json(ep);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handlePublic(req, env, normalizeSlug(url.pathname.slice(5)));
      }
      if (url.pathname.startsWith("/_admin/")) {
        return await handleAdmin(req, env, url.pathname.slice(8));
      }
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
