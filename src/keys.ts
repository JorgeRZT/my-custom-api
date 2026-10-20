import { randomToken, safeEqual, sha256 } from "./auth";
import type { Env } from "./store";

/** A user-defined secret that can protect individual endpoints. Only its hash is stored. */
export interface ApiKey {
  id: string;
  name: string;
  hash: string;
  hint: string;
  createdAt: string;
}

export type PublicKey = Omit<ApiKey, "hash">;

const MAX_KEYS = 20;
const keyPrefix = (uid: string) => `key:${uid}:`;
const strip = ({ hash, ...rest }: ApiKey): PublicKey => rest;

export async function listKeys(env: Env, uid: string): Promise<PublicKey[]> {
  const page = await env.ENDPOINTS.list({ prefix: keyPrefix(uid) });
  const keys = await Promise.all(page.keys.map((k) => env.ENDPOINTS.get<ApiKey>(k.name, "json")));
  return keys.filter((k): k is ApiKey => !!k).map(strip).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function keyExists(env: Env, uid: string, id: string): Promise<boolean> {
  return !!(await env.ENDPOINTS.get(keyPrefix(uid) + id));
}

/** `value` is optional: when omitted a random key is generated. The plain value is returned once. */
export async function createKey(env: Env, uid: string, input: any): Promise<{ ok: true; key: PublicKey & { value: string } } | { ok: false; status: number; error: string }> {
  const name = String(input?.name ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, status: 400, error: "name is required." };
  let value = input?.value;
  if (value !== undefined) {
    if (typeof value !== "string" || !/^[\x21-\x7e]{8,200}$/.test(value)) {
      return { ok: false, status: 400, error: "value must be 8-200 printable characters without spaces (omit it to generate one)." };
    }
  } else {
    value = "sk_" + randomToken(24);
  }
  if ((await listKeys(env, uid)).length >= MAX_KEYS) return { ok: false, status: 409, error: `Maximum of ${MAX_KEYS} keys reached.` };
  const key: ApiKey = { id: randomToken(4), name, hash: await sha256(value), hint: value.slice(-4), createdAt: new Date().toISOString() };
  await env.ENDPOINTS.put(keyPrefix(uid) + key.id, JSON.stringify(key));
  return { ok: true, key: { ...strip(key), value } };
}

export async function deleteKey(env: Env, uid: string, id: string): Promise<boolean> {
  if (!(await keyExists(env, uid, id))) return false;
  await env.ENDPOINTS.delete(keyPrefix(uid) + id);
  return true;
}

/** Checks the value a caller sent in the protected header. Fails closed if the key no longer exists. */
export async function verifyKey(env: Env, uid: string, protection: { keyId: string; header: string }, presented: string | null): Promise<boolean> {
  if (!presented) return false;
  const value = protection.header.toLowerCase() === "authorization" ? presented.replace(/^Bearer\s+/i, "") : presented;
  const key = await env.ENDPOINTS.get<ApiKey>(keyPrefix(uid) + protection.keyId, "json");
  return !!key && safeEqual(await sha256(value), key.hash);
}
