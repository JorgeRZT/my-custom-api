# My Custom API

[![CI](https://github.com/JorgeRZT/my-custom-api/actions/workflows/ci.yml/badge.svg)](https://github.com/JorgeRZT/my-custom-api/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/JorgeRZT/my-custom-api?sort=semver)](https://github.com/JorgeRZT/my-custom-api/releases)
[![License: MIT](https://img.shields.io/github/license/JorgeRZT/my-custom-api)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/JorgeRZT/my-custom-api)](https://github.com/JorgeRZT/my-custom-api/commits/main)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fmycustomapi.online&label=mycustomapi.online)](https://mycustomapi.online)

Create public HTTP endpoints in seconds and decide exactly what they return — body, status code, format, headers and latency. Built on Cloudflare Workers + KV, with Google sign-in, a private space per account, optional API keys per endpoint, and first-class documentation for LLMs.

Hosted instance: **https://mycustomapi.online** · [Privacy](public/privacy.html) · [Terms](public/terms.html)

Typical uses: mocking a backend while the real one is built, reproducing error responses (`503`, slow responses, odd headers), serving static JSON/HTML/CSV/XML, contract testing, demos, and letting an AI agent create endpoints for you.

## Features

- **Custom responses** — any status `200–599`, formats JSON / text / HTML / XML / CSV / custom `Content-Type`, extra response headers, artificial latency (0–10 s).
- **Method matching** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` or `ANY`; other methods get `405`. `HEAD` is answered like `GET`.
- **Nested paths** — `users/list`, `v1/orders/42`, …
- **Private space per account** — sign in with Google; every account manages its own endpoints, isolated from everyone else's.
- **API keys per endpoint** — endpoints are open by default; protect any of them with a key sent in a header of your choice (`Authorization: Bearer …`, `X-API-Key: …`).
- **Built for LLMs** — a personal token, `/llms.txt` and an OpenAPI 3.1 spec (`/openapi.json`) let an agent create and manage endpoints on your behalf.
- **Dashboard** — endpoint editor with a live `curl` preview, request tester, key management, light/dark theme.
- **CORS enabled** on public endpoints (including preflight for custom headers).
- **Zero runtime dependencies** — plain TypeScript on the Workers runtime.

## How it works

```
                 ┌───────────────────────────── Cloudflare Worker ─────────────────────────────┐
 Browser ──────▶ │ static assets (public/)   dashboard, privacy, terms                          │
                 │ /auth/*      Google OAuth, sessions, personal token                          │
 Admin client ─▶ │ /_admin/*    Admin API (session cookie or Bearer token)        ──▶  KV       │
 Anyone ───────▶ │ /api/...     public endpoints (optionally API-key protected)   ◀──  ENDPOINTS│
                 │ /llms.txt, /openapi.json                                                     │
                 └──────────────────────────────────────────────────────────────────────────────┘
```

- **Public URLs**: `https://<host>/api/u/<userId>/<path>` for each account. Legacy/global endpoints (managed with the instance-wide `ADMIN_TOKEN`) live at `https://<host>/api/<path>`.
- **Authentication for the Admin API** (`/_admin/*`) is one of:
  - the dashboard's session cookie (after Google sign-in),
  - a **personal token** (`mca_…`) generated in the dashboard under **LLM Access** — manages only that account's endpoints,
  - the instance-wide **`ADMIN_TOKEN`** (optional) — manages the global/legacy set.
- **API keys** (`sk_…`) are different from tokens: a token lets you *manage* endpoints; an API key only guards *calls* to a public endpoint.

## Requirements and dependencies

| What | Why |
|---|---|
| **Node.js ≥ 22** and npm | Wrangler 4 requires it |
| **Cloudflare account** (free plan works) | Workers, KV and static assets |
| **Google Cloud project** | OAuth 2.0 client for sign-in |
| *(optional)* a domain on Cloudflare | Custom domain instead of `*.workers.dev` |

npm packages (all dev-only, nothing is bundled from `node_modules` at runtime):

| Package | Role |
|---|---|
| [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) `^4` | Local dev server and deployment |
| `typescript` `^7` | Type checking (`npm run typecheck`) |
| `@cloudflare/workers-types` | Workers runtime types |

## Quick start (local)

```bash
git clone https://github.com/JorgeRZT/my-custom-api.git
cd my-custom-api
npm install
cp .dev.vars.example .dev.vars   # then edit it, see "Configuration"
npm run dev                      # http://localhost:8787
```

Local KV is simulated by Wrangler and persisted in `.wrangler/`. To try Google sign-in locally, create the OAuth client first (next section) and add `http://localhost:8787/auth/google/callback` as an authorized redirect URI.

## Configuration

Secrets go in `.dev.vars` locally and in `wrangler secret put <NAME>` in production. `PUBLIC_URL` is a plain variable in `wrangler.jsonc`.

| Name | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | for sign-in | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | for sign-in | OAuth 2.0 client secret |
| `ALLOWED_EMAILS` | for sign-in | Who may sign in: comma-separated emails, `*@yourdomain.com` patterns, or `*` for any Google account. **Empty means nobody.** |
| `ADMIN_TOKEN` | no | Enables the instance-wide admin token for the global endpoint set. Leave unset to disable it. |
| `PUBLIC_URL` | no | Canonical origin shown in `llms.txt`, OpenAPI and the public URLs the API reports (default: the request origin). |

### Google OAuth setup

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) configure the **OAuth consent screen** (External) and create an **OAuth client ID** of type *Web application*.
2. Add **authorized redirect URIs**: `https://<your-host>/auth/google/callback` (and the localhost one for development).
3. Scopes used: `openid`, `email`, `profile` — no Google verification is needed for these.
4. If the consent screen is in *Testing*, only listed test users can sign in; publish it to open it up.
5. Put the consent screen's privacy and terms links at `https://<your-host>/privacy` and `/terms`.

## Deploy your own instance

```bash
npx wrangler login
```

Edit `wrangler.jsonc` for your setup:

- `name` — your Worker's name.
- **With your own domain** (zone on Cloudflare): set `routes` to `[{ "pattern": "your.domain", "custom_domain": true }]` and `vars.PUBLIC_URL` to `https://your.domain`.
- **Without a domain**: delete `routes` and `vars.PUBLIC_URL`, and set `"workers_dev": true`. Your URL will be `https://<name>.<account>.workers.dev`.

```bash
npx wrangler deploy                          # creates the Worker and provisions the KV namespace
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
npx wrangler secret put ADMIN_TOKEN          # optional
```

Then add `https://<your-host>/auth/google/callback` to the OAuth client. If your Wrangler version does not auto-provision KV, run `npx wrangler kv namespace create ENDPOINTS` and add the returned `id` to the `kv_namespaces` entry.

Remember to review [`public/privacy.html`](public/privacy.html) and [`public/terms.html`](public/terms.html): they describe the hosted instance and name its operator. Replace them with your own before running a public instance.

## Using it

### Dashboard

Sign in with Google at your host's root. From there you can create/edit/test/delete endpoints, copy their URL or `curl` command, manage **API Keys** and generate your **LLM Access** token. Shortcuts: `N` new endpoint, `/` focus search.

### Admin API

Send `Authorization: Bearer <token>` (personal token or `ADMIN_TOKEN`) and, for bodies, `Content-Type: application/json`.

| Method | Path | Description |
|---|---|---|
| GET | `/_admin/me` | Which endpoint set this token manages and its `publicBase` URL prefix |
| GET | `/_admin/endpoints` | List endpoints |
| POST | `/_admin/endpoints` | Create (`201`) |
| GET | `/_admin/endpoints/<path>` | Read one |
| PUT / PATCH | `/_admin/endpoints/<path>` | Partial update (include `slug` to rename) |
| DELETE | `/_admin/endpoints/<path>` | Delete |
| GET | `/_admin/keys` | List API keys (values are never returned) |
| POST | `/_admin/keys` | Create a key — the value is returned **once** |
| DELETE | `/_admin/keys/<id>` | Delete (`409` while endpoints still use it) |

API-key routes require a personal token (not `ADMIN_TOKEN`). Tokens themselves can only be created/revoked from the dashboard with a Google session.

```bash
TOKEN=mca_...   # from the dashboard → LLM Access
HOST=https://mycustomapi.online

# where will my endpoints live?
curl -H "Authorization: Bearer $TOKEN" $HOST/_admin/me

# create an endpoint
curl -X POST $HOST/_admin/endpoints \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"users","method":"GET","status":200,"format":"json","body":"[{\"id\":1,\"name\":\"Ana\"}]"}'

# call it (no auth), using the publicBase returned by /_admin/me
curl https://mycustomapi.online/api/u/<userId>/users
```

### Endpoint fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `slug` | string | required | Path after the public base. Letters, numbers, `- _ . ~ /`, up to 200 chars |
| `method` | string | `ANY` | `ANY`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `status` | integer | `200` | `200–599` (`204`/`304` send no body) |
| `format` | string | `json` | `json`, `text`, `html`, `xml`, `csv`, `custom` |
| `contentType` | string | — | Required when `format` is `custom` |
| `body` | **string** | `""` | Always a string; must parse as JSON when `format` is `json` |
| `headers` | object | `{}` | Extra response headers (string values) |
| `delayMs` | integer | `0` | `0–10000` |
| `description` | string | — | Free note, up to 500 chars |
| `protection` | object \| null | `null` | `{"keyId":"<id>","header":"Authorization"}`; `null` makes it public |

### Protecting an endpoint with an API key

```bash
# 1. create a key; save "value", it is shown only once
curl -X POST $HOST/_admin/keys -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"clients"}'

# 2. require it on an endpoint, in the X-API-Key header
curl -X POST $HOST/_admin/endpoints -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"private/report","body":"{\"ok\":true}","protection":{"keyId":"<id>","header":"X-API-Key"}}'

# 3. callers must send the key (otherwise 401)
curl -H "X-API-Key: sk_..." https://mycustomapi.online/api/u/<userId>/private/report
```

With the `Authorization` header the key is expected as `Bearer <key>`; with any other header it is the raw value. If a key is deleted while endpoints still reference it, they keep answering `401` — they never silently become public.

### Using it with an LLM

Give the agent the URL `https://<your-host>/llms.txt` and a personal token (dashboard → **LLM Access** also builds a ready-to-paste prompt). `llms.txt` explains the model, the workflow and the pitfalls in plain language; `/openapi.json` serves tool-calling frameworks that import OpenAPI.

## Project structure

```
src/
  index.ts    Worker entry: routing, public endpoint handler, Admin API
  auth.ts     Google OAuth, sessions, users, personal tokens, principal resolution
  keys.ts     API keys (create/list/delete/verify)
  store.ts    Endpoint model, validation and KV persistence
  docs.ts     Generates /llms.txt and /openapi.json
public/       Static assets: dashboard (index.html), privacy, terms, legal.css/js
wrangler.jsonc  Worker config: assets, KV binding, routes, PUBLIC_URL
```

### KV data layout

One KV namespace (`ENDPOINTS`) holds everything:

| Key | Value |
|---|---|
| `ep:<slug>` | Global/legacy endpoint |
| `uep:<userId>:<slug>` | A user's endpoint |
| `user:<userId>` | User record (email, name, picture, token hash/hint) |
| `email:<email>` | → user id |
| `sess:<sessionId>` | → user id (TTL 7 days) |
| `tok:<sha256(token)>` | → user id (personal token lookup) |
| `key:<userId>:<keyId>` | API key record (name, SHA-256 hash, last 4 chars) |

## Security notes

- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, 7-day server-side session. State-changing requests rely on `SameSite=Lax` plus JSON bodies.
- Personal tokens and API keys are stored **hashed** (SHA-256) and shown once; `ADMIN_TOKEN` and API-key comparisons are constant-time.
- Removing an email from `ALLOWED_EMAILS` immediately invalidates that account's sessions and token.
- Public endpoints are, by design, public to anyone with the URL unless protected with a key. Do not store secrets or personal data in them.
- `ALLOWED_EMAILS=*` means open sign-up: anyone with a Google account can create endpoints on your instance.

## Known limitations

- **50 endpoints per account** — creating more returns `403`. The instance-wide global set (`ADMIN_TOKEN`) is not limited.
- **No rate limiting** built in — use Cloudflare rate-limiting/WAF rules in front of a public instance.
- **KV is eventually consistent**: a change can take up to about a minute to be visible in every location.
- **No self-service account deletion** yet (data can be removed per endpoint/key/token; full deletion is manual).
- No automated tests yet; `npm run typecheck` is the only check.
- Sessions and endpoints share one KV namespace, listing endpoints is `O(n)` per request.

## Contributing

Contributions are welcome — bug reports, ideas and pull requests.

1. Fork the repo and create a branch (`feature/short-description`).
2. `npm install`, then `npm run dev` to try your change.
3. Make sure `npm run typecheck` passes.
4. Keep the project dependency-free at runtime and match the surrounding style.
5. If you change behaviour, update this README and `src/docs.ts` (`llms.txt` / OpenAPI) too.
6. Open a pull request describing what and why.

Ideas that would be great to have: account deletion, built-in rate limiting, request logs per endpoint, import/export (OpenAPI/Postman), response templating, automated tests, other sign-in providers.

Never commit secrets: `.dev.vars` is git-ignored; only `.dev.vars.example` is tracked.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Local dev server (`wrangler dev`) |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run cf-typegen` | Regenerate Worker binding types |

## License

[MIT](LICENSE)
