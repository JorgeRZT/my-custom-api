import type { Env } from "./store";

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL = 60 * 60 * 24 * 7;
const SESSION_PREFIX = "sess:";

export interface SessionUser {
  email: string;
  name?: string;
  picture?: string;
}

export const googleEnabled = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** ALLOWED_EMAILS is a comma-separated list of emails or "*@domain.com" patterns. Empty = nobody. */
export function isEmailAllowed(env: Env, email: string): boolean {
  const e = email.toLowerCase();
  return (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => (rule.startsWith("*@") ? e.endsWith(rule.slice(1)) : rule === e));
}

export async function getSession(req: Request, env: Env): Promise<SessionUser | null> {
  const id = getCookie(req, SESSION_COOKIE);
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const user = await env.ENDPOINTS.get<SessionUser>(SESSION_PREFIX + id, "json");
  // Re-check the allowlist so removing an account revokes its existing sessions.
  return user && isEmailAllowed(env, user.email) ? user : null;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

const fail = (code: string) => redirect(`/?login_error=${code}`);

export async function handleAuth(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

  if (path === "me" && req.method === "GET") {
    const user = await getSession(req, env);
    return user ? json({ user }) : json({ error: "Not signed in", googleEnabled: googleEnabled(env) }, 401);
  }

  if (path === "logout" && req.method === "POST") {
    const id = getCookie(req, SESSION_COOKIE);
    if (id && /^[a-f0-9]{64}$/.test(id)) await env.ENDPOINTS.delete(SESSION_PREFIX + id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie(SESSION_COOKIE, "", 0, secure) },
    });
  }

  if (!googleEnabled(env)) return json({ error: "Google login is not configured" }, 501);
  const redirectUri = url.origin + "/auth/google/callback";

  if (path === "google" && req.method === "GET") {
    const state = randomToken(16);
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account", // lets the user pick between several Google accounts
    });
    return redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params, [cookie(STATE_COOKIE, state, 600, secure)]);
  }

  if (path === "google/callback" && req.method === "GET") {
    const clearState = cookie(STATE_COOKIE, "", 0, secure);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error")) return redirect("/?login_error=denied", [clearState]);
    if (!code || !state || state !== getCookie(req, STATE_COOKIE)) return redirect("/?login_error=state", [clearState]);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return redirect("/?login_error=token", [clearState]);
    const { access_token } = await tokenRes.json<{ access_token: string }>();

    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + access_token },
    });
    if (!infoRes.ok) return redirect("/?login_error=userinfo", [clearState]);
    const info = await infoRes.json<{ email?: string; email_verified?: boolean; name?: string; picture?: string }>();

    if (!info.email || !info.email_verified) return redirect("/?login_error=unverified", [clearState]);
    if (!isEmailAllowed(env, info.email)) return redirect("/?login_error=forbidden", [clearState]);

    const id = randomToken(32);
    const user: SessionUser = { email: info.email.toLowerCase(), name: info.name, picture: info.picture };
    await env.ENDPOINTS.put(SESSION_PREFIX + id, JSON.stringify(user), { expirationTtl: SESSION_TTL });
    return redirect("/", [clearState, cookie(SESSION_COOKIE, id, SESSION_TTL, secure)]);
  }

  return json({ error: "Not found" }, 404);
}
