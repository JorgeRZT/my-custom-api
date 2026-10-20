import { llmsTxt, openApiSpec } from "./docs";
import {
  Env, FORMATS, contentTypeFor, createEndpoint, deleteEndpoint, getEndpoint, isAuthorized,
  listEndpoints, normalizeSlug, updateEndpoint, Result,
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

async function handlePublic(req: Request, env: Env, slug: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const ep = await getEndpoint(env, slug);
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

async function handleAdmin(req: Request, env: Env, path: string): Promise<Response> {
  if (!isAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
  const readBody = () => req.json<any>().catch(() => null);

  if (path === "endpoints" || path === "endpoints/") {
    if (req.method === "GET") return json(await listEndpoints(env));
    if (req.method === "POST") {
      const input = await readBody();
      return input ? fromResult(await createEndpoint(env, input)) : json({ error: "Invalid JSON body" }, 400);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (path.startsWith("endpoints/")) {
    const slug = normalizeSlug(path.slice("endpoints/".length));
    if (req.method === "GET") {
      const ep = await getEndpoint(env, slug);
      return ep ? json(ep) : json({ error: "Not found" }, 404);
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      const input = await readBody();
      return input ? fromResult(await updateEndpoint(env, slug, input)) : json({ error: "Invalid JSON body" }, 400);
    }
    if (req.method === "DELETE") return fromResult(await deleteEndpoint(env, slug));
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
      if (p.startsWith("/_admin/")) return await handleAdmin(req, env, p.slice(8));
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
