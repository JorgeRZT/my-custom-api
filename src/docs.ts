import { FORMAT_NAMES, METHODS } from "./store";

export function llmsTxt(origin: string): string {
  return `# My Custom API

> Mock/static API builder on Cloudflare Workers. You create "endpoints": public URLs that return a fixed body with a chosen HTTP status, format (Content-Type), extra headers and optional delay. Endpoints are managed through a REST admin API authenticated with a Bearer token. Base URL: ${origin}

## How it works (read this first)
- **Accounts**: people sign in to the web dashboard (${origin}/) with Google only. Each Google account has its own private set of endpoints; nobody can see or change another account's endpoints.
- **Tokens**: the admin API is called with \`Authorization: Bearer <TOKEN>\`. A human gets their personal token (starts with \`mca_\`) in the dashboard: sign in with Google, click "Mi token", then "Generar token". It is shown only once. You cannot create tokens yourself, so if you have no token, ask the user for it.
- **A token only manages its own set**: a personal token manages that account's endpoints. The instance-wide \`ADMIN_TOKEN\` (if the user has it) manages a separate "global" set (legacy). Use whichever token you were given; the API is identical.
- **Public URLs**: every endpoint is served, without authentication and with CORS \`*\`, at \`<publicBase><slug>\`. \`publicBase\` depends on the token (see below), so never build public URLs by hand: read it from \`GET /_admin/me\`.

| Token | Manages | publicBase |
|---|---|---|
| Personal token (\`mca_…\`) | that account's endpoints | ${origin}/api/u/<userId>/ |
| ADMIN_TOKEN | global/legacy endpoints | ${origin}/api/ |

## Recommended workflow for an agent
1. \`GET ${origin}/_admin/me\` → returns \`{"scope","email","publicBase"}\`. A 401 means the token is wrong, revoked, or the user's access was removed: ask the user for a new one.
2. \`GET ${origin}/_admin/endpoints\` → see what exists, to avoid slug conflicts (409).
3. Create (POST) or change (PUT) endpoints.
4. Tell the user the final URL: \`<publicBase><slug>\`, and optionally verify it with a plain GET (no auth).

## Rules and gotchas
- Send \`Content-Type: application/json\` whenever you send a body.
- \`body\` is ALWAYS a string. For JSON responses send the JSON serialized as a string (e.g. \`"body": "{\\"ok\\":true}"\`), not a nested object. With format "json" the string must parse as JSON.
- PUT is a partial update: only the fields you send change. Include \`slug\` in the body to rename.
- Slugs may contain "/" (e.g. \`users/list\`). In admin URLs just append the segments: \`/_admin/endpoints/users/list\`.
- Public endpoints answer only to their configured \`method\` (others get 405); \`ANY\` accepts all methods.
- Errors are JSON \`{"error":"..."}\` with status 400 (validation), 401 (missing/invalid token), 404 (not found), 409 (slug exists).
- Tokens can only be created, regenerated or revoked from the dashboard by a signed-in human, never through this API.

## Endpoint fields
| field | type | default | notes |
|---|---|---|---|
| slug | string | — (required on create) | Path after the public base, e.g. \`users/list\`. Chars: letters, numbers, - _ . ~ / (max 200) |
| method | string | ANY | One of ${METHODS.join(", ")} |
| status | integer | 200 | 200–599 |
| format | string | json | One of ${FORMAT_NAMES.join(", ")}. "custom" requires contentType |
| contentType | string | — | Only when format is "custom" |
| body | string | "" | Response body |
| headers | object<string,string> | {} | Extra response headers |
| delayMs | integer | 0 | 0–10000, artificial latency |
| description | string | — | Free note (max 500 chars) |
Read-only: createdAt, updatedAt.

## Admin API (all require \`Authorization: Bearer <TOKEN>\`)
- GET    /_admin/me — scope of this token and its \`publicBase\`
- GET    /_admin/endpoints — list endpoints (array)
- POST   /_admin/endpoints — create; 201 + endpoint
- GET    /_admin/endpoints/<slug> — get one
- PUT    /_admin/endpoints/<slug> — partial update (also PATCH)
- DELETE /_admin/endpoints/<slug> — delete; returns {"deleted":"<slug>"}

## Examples
\`\`\`bash
TOKEN=mca_...   # the user's personal token

# Who am I / where will my endpoints be served?
curl -H "Authorization: Bearer $TOKEN" ${origin}/_admin/me

# List
curl -H "Authorization: Bearer $TOKEN" ${origin}/_admin/endpoints

# Create a JSON endpoint
curl -X POST ${origin}/_admin/endpoints \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"slug":"users","method":"GET","status":200,"format":"json","body":"[{\\"id\\":1,\\"name\\":\\"Ana\\"}]"}'

# Create an error response with a delay
curl -X POST ${origin}/_admin/endpoints \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"slug":"flaky","status":503,"body":"{\\"error\\":\\"unavailable\\"}","delayMs":1500}'

# Update only the status
curl -X PUT ${origin}/_admin/endpoints/users \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"status":503}'

# Delete
curl -X DELETE -H "Authorization: Bearer $TOKEN" ${origin}/_admin/endpoints/users

# Call a public endpoint (no auth): <publicBase><slug>
curl <publicBase>users
\`\`\`

## More
- [OpenAPI 3.1 spec](${origin}/openapi.json): machine-readable admin API, usable for function calling / GPT Actions / tool import (auth: Bearer token).
- [Dashboard](${origin}/): web UI for humans (Google sign-in, personal token, endpoint editor).
`;
}

export function openApiSpec(origin: string) {
  const endpointInput = {
    type: "object",
    properties: {
      slug: { type: "string", example: "users/list", description: "Path after the public base returned by GET /_admin/me" },
      method: { type: "string", enum: METHODS, default: "ANY" },
      status: { type: "integer", minimum: 200, maximum: 599, default: 200 },
      format: { type: "string", enum: FORMAT_NAMES, default: "json" },
      contentType: { type: "string", description: "Required when format is 'custom'" },
      body: { type: "string", description: "Raw response body. Valid JSON if format is 'json'." },
      headers: { type: "object", additionalProperties: { type: "string" } },
      delayMs: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      description: { type: "string" },
    },
  };
  const endpoint = {
    allOf: [
      { $ref: "#/components/schemas/EndpointInput" },
      { type: "object", properties: { createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
    ],
  };
  const slugParam = {
    name: "slug", in: "path", required: true, schema: { type: "string" },
    description: "Endpoint slug. URL-encode '/' as %2F or pass it as path segments.",
  };
  const err = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  const one = { description: "Endpoint", content: { "application/json": { schema: { $ref: "#/components/schemas/Endpoint" } } } };
  const body = (required: string[]) => ({
    required: true,
    content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/EndpointInput" }, { required }] } } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "My Custom API — Admin",
      version: "1.0.0",
      description: `Manage public mock endpoints. Each token only sees its own set (user tokens: ${origin}/api/u/<userId>/<slug>; ADMIN_TOKEN: ${origin}/api/<slug>). See ${origin}/llms.txt`,
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/_admin/me": {
        get: {
          operationId: "whoAmI", summary: "Endpoint set managed by this token and its public URL prefix",
          responses: { 200: { description: "Scope", content: { "application/json": { schema: { type: "object", properties: { scope: { type: "string", enum: ["global", "user"] }, email: { type: "string" }, publicBase: { type: "string" } } } } } }, 401: err },
        },
      },
      "/_admin/endpoints": {
        get: {
          operationId: "listEndpoints", summary: "List all endpoints",
          responses: { 200: { description: "List", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Endpoint" } } } } }, 401: err },
        },
        post: {
          operationId: "createEndpoint", summary: "Create an endpoint",
          requestBody: body(["slug", "body"]),
          responses: { 201: one, 400: err, 401: err, 409: err },
        },
      },
      "/_admin/endpoints/{slug}": {
        parameters: [slugParam],
        get: { operationId: "getEndpoint", summary: "Get one endpoint", responses: { 200: one, 401: err, 404: err } },
        put: {
          operationId: "updateEndpoint", summary: "Partially update an endpoint (send slug to rename)",
          requestBody: body([]),
          responses: { 200: one, 400: err, 401: err, 404: err, 409: err },
        },
        delete: {
          operationId: "deleteEndpoint", summary: "Delete an endpoint",
          responses: { 200: { description: "Deleted", content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "string" } } } } } }, 401: err, 404: err },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "ADMIN_TOKEN or a personal user token (mca_…)" } },
      schemas: {
        EndpointInput: endpointInput,
        Endpoint: endpoint,
        Error: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  };
}
