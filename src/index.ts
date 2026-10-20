import { authenticate, describePrincipal, handleAuth } from "./auth";
import { createKey, deleteKey, keyExists, listKeys, verifyKey } from "./keys";
import { llmsTxt, openApiSpec } from "./docs";
import {
  Env, FORMATS, GLOBAL_NS, contentTypeFor, createEndpoint, deleteEndpoint, getEndpoint,
  listEndpoints, userNs, normalizeSlug, updateEndpoint, Result,
} from "./store";

export type { Env };

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

const fromResult = <T>(r: Result<T>) => (r.ok ? json(r.data, r.status) : json({ error: r.error }, r.status));

const USER_SLUG_RE = /^u\/([a-f0-9]{12})\/(.+)$/;

async function handlePublic(req: Request, env: Env, rawSlug: string): Promise<Response> {
  if (req.method === "OPTIONS") {
    // Browsers require sensitive headers such as Authorization to be named explicitly, so echo what they ask for.
    const allow = req.headers.get("Access-Control-Request-Headers") || "*";
    return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Headers": allow } });
  }

  // /api/u/<userId>/<slug> belongs to a user; anything else is the global (legacy) set.
  const m = USER_SLUG_RE.exec(rawSlug);
  const ns = m ? userNs(m[1]) : GLOBAL_NS;
  const slug = m ? m[2] : rawSlug;
  const ep = await getEndpoint(env, ns, slug);
  if (!ep) return json({ error: "Endpoint not found", slug }, 404, CORS);

  if (ep.protection) {
    const ok = m && (await verifyKey(env, m[1], ep.protection, req.headers.get(ep.protection.header)));
    if (!ok) {
      return json({ error: "Unauthorized", hint: `Send a valid key in the '${ep.protection.header}' header` }, 401, CORS);
    }
  }

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

async function handleAdmin(req: Request, env: Env, path: string, origin: string): Promise<Response> {
  const principal = await authenticate(req, env);
  if (!principal) return json({ error: "Unauthorized" }, 401);
  const ns = principal.ns;
  const readBody = () => req.json<any>().catch(() => null);

  if (path === "me" && req.method === "GET") return json(describePrincipal(principal, origin));

  /** Rejects `protection` that points to a key the user doesn't own, or is used from the global set. */
  const checkProtection = async (input: any): Promise<string | null> => {
    if (input?.protection == null) return null;
    if (principal.kind !== "user") return "Protection with API keys is only available for personal tokens.";
    const keyId = input.protection.keyId;
    return typeof keyId === "string" && (await keyExists(env, principal.user.id, keyId)) ? null : "protection.keyId does not match any of your API keys.";
  };

  if (path === "keys" || path.startsWith("keys/")) {
    if (principal.kind !== "user") return json({ error: "API keys are only available for personal tokens." }, 403);
    const uid = principal.user.id;
    if (path === "keys" && req.method === "GET") return json(await listKeys(env, uid));
    if (path === "keys" && req.method === "POST") {
      const input = await readBody();
      if (!input) return json({ error: "Invalid JSON body" }, 400);
      const r = await createKey(env, uid, input);
      return r.ok ? json(r.key, 201) : json({ error: r.error }, r.status);
    }
    if (path.startsWith("keys/") && req.method === "DELETE") {
      const id = path.slice(5);
      const using = (await listEndpoints(env, ns)).filter((e) => e.protection?.keyId === id).map((e) => e.slug);
      if (using.length) return json({ error: "Key is in use by endpoints. Change or remove their protection first.", endpoints: using }, 409);
      return (await deleteKey(env, uid, id)) ? json({ deleted: id }) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path === "endpoints" || path === "endpoints/") {
    if (req.method === "GET") return json(await listEndpoints(env, ns));
    if (req.method === "POST") {
      const input = await readBody();
      const bad = input && (await checkProtection(input));
      if (bad) return json({ error: bad }, 400);
      return input ? fromResult(await createEndpoint(env, ns, input)) : json({ error: "Invalid JSON body" }, 400);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path.startsWith("endpoints/")) {
    const slug = normalizeSlug(path.slice("endpoints/".length));
    if (req.method === "GET") {
      const ep = await getEndpoint(env, ns, slug);
      return ep ? json(ep) : json({ error: "Not found" }, 404);
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      const input = await readBody();
      const bad = input && (await checkProtection(input));
      if (bad) return json({ error: bad }, 400);
      return input ? fromResult(await updateEndpoint(env, ns, slug, input)) : json({ error: "Invalid JSON body" }, 400);
    }
    if (req.method === "DELETE") return fromResult(await deleteEndpoint(env, ns, slug));
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) return await handlePublic(req, env, normalizeSlug(p.slice(5)));
      if (p.startsWith("/_admin/")) return await handleAdmin(req, env, p.slice(8), url.origin);
      if (p.startsWith("/auth/")) return await handleAuth(req, env, p.slice(6));
      if (p === "/llms.txt") {
        return new Response(llmsTxt(url.origin), { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
      }
      if (p === "/openapi.json") return json(openApiSpec(url.origin), 200, CORS);
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
