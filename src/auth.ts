import { GLOBAL_NS, userNs, type Env } from "./store";

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL = 60 * 60 * 24 * 7;
const SESSION_PREFIX = "sess:";
const USER_PREFIX = "user:"; // user:<id> -> User
const EMAIL_PREFIX = "email:"; // email:<email> -> id
const TOKEN_PREFIX = "tok:"; // tok:<sha256 of token> -> id
const TOKEN_TAG = "mca_";

export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  tokenHash?: string;
  tokenHint?: string;
  createdAt: string;
}

/** Who is calling the admin API, and which endpoint set they manage. */
export type Principal = { kind: "global"; ns: string } | { kind: "user"; ns: string; user: User };

const publicUser = ({ id, email, name, picture }: User) => ({ id, email, name, picture });

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

/** ALLOWED_EMAILS is a comma-separated list of emails, "*@domain.com" patterns or "*" (anyone). Empty = nobody. */
export function isEmailAllowed(env: Env, email: string): boolean {
  const e = email.toLowerCase();
  return (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => rule === "*" || (rule.startsWith("*@") ? e.endsWith(rule.slice(1)) : rule === e));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadUser(env: Env, id: string): Promise<User | null> {
  const user = await env.ENDPOINTS.get<User>(USER_PREFIX + id, "json");
  // Re-check the allowlist so removing an account revokes its sessions and token.
  return user && isEmailAllowed(env, user.email) ? user : null;
}

export async function getSession(req: Request, env: Env): Promise<User | null> {
  const sid = getCookie(req, SESSION_COOKIE);
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const id = await env.ENDPOINTS.get(SESSION_PREFIX + sid);
  return id ? loadUser(env, id) : null;
}

/** Bearer ADMIN_TOKEN -> global set; Bearer user token or session cookie -> that user's set. */
export async function authenticate(req: Request, env: Env): Promise<Principal | null> {
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    if (env.ADMIN_TOKEN && safeEqual(token, env.ADMIN_TOKEN)) return { kind: "global", ns: GLOBAL_NS };
    if (!token.startsWith(TOKEN_TAG)) return null;
    const id = await env.ENDPOINTS.get(TOKEN_PREFIX + (await sha256(token)));
    const user = id ? await loadUser(env, id) : null;
    return user ? { kind: "user", ns: userNs(user.id), user } : null;
  }
  const user = await getSession(req, env);
  return user ? { kind: "user", ns: userNs(user.id), user } : null;
}

export function describePrincipal(p: Principal, origin: string) {
  return p.kind === "global"
    ? { scope: "global", publicBase: `${origin}/api/` }
    : { scope: "user", email: p.user.email, publicBase: `${origin}/api/u/${p.user.id}/` };
}

async function findOrCreateUser(env: Env, info: { email: string; name?: string; picture?: string }): Promise<User> {
  const email = info.email.toLowerCase();
  const existingId = await env.ENDPOINTS.get(EMAIL_PREFIX + email);
  const existing = existingId ? await env.ENDPOINTS.get<User>(USER_PREFIX + existingId, "json") : null;
  const user: User = existing
    ? { ...existing, name: info.name, picture: info.picture }
    : { id: randomToken(6), email, name: info.name, picture: info.picture, createdAt: new Date().toISOString() };
  await env.ENDPOINTS.put(USER_PREFIX + user.id, JSON.stringify(user));
  if (!existing) await env.ENDPOINTS.put(EMAIL_PREFIX + email, user.id);
  return user;
}

async function issueToken(env: Env, user: User): Promise<string> {
  const token = TOKEN_TAG + randomToken(24);
  const hash = await sha256(token);
  if (user.tokenHash) await env.ENDPOINTS.delete(TOKEN_PREFIX + user.tokenHash);
  await env.ENDPOINTS.put(TOKEN_PREFIX + hash, user.id);
  await env.ENDPOINTS.put(USER_PREFIX + user.id, JSON.stringify({ ...user, tokenHash: hash, tokenHint: token.slice(-4) }));
  return token;
}

async function revokeToken(env: Env, user: User): Promise<void> {
  if (!user.tokenHash) return;
  await env.ENDPOINTS.delete(TOKEN_PREFIX + user.tokenHash);
  const { tokenHash, tokenHint, ...rest } = user;
  await env.ENDPOINTS.put(USER_PREFIX + user.id, JSON.stringify(rest));
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
    return user ? json({ user: publicUser(user) }) : json({ error: "Not signed in", googleEnabled: googleEnabled(env) }, 401);
  }

  // Personal API token management: session only, so a token can't mint or revoke tokens.
  if (path === "token") {
    const user = await getSession(req, env);
    if (!user) return json({ error: "Not signed in" }, 401);
    if (req.method === "GET") return json({ hasToken: !!user.tokenHash, hint: user.tokenHint });
    if (req.method === "POST") return json({ token: await issueToken(env, user) }, 201);
    if (req.method === "DELETE") { await revokeToken(env, user); return json({ ok: true }); }
    return json({ error: "Method not allowed" }, 405);
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

    const user = await findOrCreateUser(env, { email: info.email, name: info.name, picture: info.picture });
    const sid = randomToken(32);
    await env.ENDPOINTS.put(SESSION_PREFIX + sid, user.id, { expirationTtl: SESSION_TTL });
    return redirect("/", [clearState, cookie(SESSION_COOKIE, sid, SESSION_TTL, secure)]);
  }

  return json({ error: "Not found" }, 404);
}
