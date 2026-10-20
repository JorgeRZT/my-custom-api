import { FORMAT_NAMES, METHODS } from "./store";

export function llmsTxt(origin: string): string {
  return `# My Custom API

> Self-hosted static/mock API builder running on Cloudflare Workers. Each "endpoint" is a public URL at ${origin}/api/<slug> that returns a fixed body with a chosen HTTP status code, format (Content-Type), optional extra headers and optional delay. Endpoints are managed through an authenticated REST admin API (documented below and in OpenAPI) or the web dashboard.

## Instructions for LLM agents
- Base URL: ${origin}
- Every admin request MUST include the header \`Authorization: Bearer <ADMIN_TOKEN>\` (ask the user for the token if you don't have it) and \`Content-Type: application/json\` when sending a body.
- Always list endpoints first (GET /_admin/endpoints) before creating, to avoid slug conflicts (409).
- \`body\` is ALWAYS a string. For JSON responses, send the JSON serialized as a string (e.g. \`"body": "{\\"ok\\":true}"\`), not a nested object.
- In admin URLs, encode "/" inside a slug as %2F or just append the segments: /_admin/endpoints/users/list targets slug "users/list".
- After creating or updating, tell the user the public URL: ${origin}/api/<slug>
- Errors return JSON \`{"error": "..."}\` with status 400 (validation), 401 (bad token), 404 (not found), 409 (slug exists).

## Endpoint fields
| field | type | default | notes |
|---|---|---|---|
| slug | string | — (required on create) | Path after /api/, e.g. \`users/list\`. Chars: letters, numbers, - _ . ~ / |
| method | string | ANY | One of ${METHODS.join(", ")}. Other methods get 405. |
| status | integer | 200 | 200–599 |
| format | string | json | One of ${FORMAT_NAMES.join(", ")}. "custom" requires contentType. |
| contentType | string | — | Only used when format is "custom". |
| body | string | "" | Response body. Must be valid JSON when format is "json". |
| headers | object<string,string> | {} | Extra response headers. |
| delayMs | integer | 0 | 0–10000, artificial latency. |
| description | string | — | Free note. |
Read-only: createdAt, updatedAt.

## REST admin API
- GET    /_admin/endpoints — list all endpoints (array)
- POST   /_admin/endpoints — create; returns 201 + endpoint
- GET    /_admin/endpoints/<slug> — get one
- PUT    /_admin/endpoints/<slug> — partial update: only provided fields change; include "slug" to rename
- DELETE /_admin/endpoints/<slug> — delete; returns {"deleted": "<slug>"}

## Examples
\`\`\`bash
# List
curl -H "Authorization: Bearer $ADMIN_TOKEN" ${origin}/_admin/endpoints

# Create
curl -X POST ${origin}/_admin/endpoints \\
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \\
  -d '{"slug":"users","method":"GET","status":200,"format":"json","body":"[{\\"id\\":1,\\"name\\":\\"Ana\\"}]"}'

# Update (only status)
curl -X PUT ${origin}/_admin/endpoints/users \\
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \\
  -d '{"status":503}'

# Delete
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" ${origin}/_admin/endpoints/users

# Call the public endpoint (no auth)
curl ${origin}/api/users
\`\`\`

## Docs
- [OpenAPI 3.1 spec](${origin}/openapi.json): machine-readable admin API, usable for function calling / GPT Actions / tool import.
- [Dashboard](${origin}/): web UI for humans.
`;
}

export function openApiSpec(origin: string) {
  const endpointInput = {
    type: "object",
    properties: {
      slug: { type: "string", example: "users/list", description: "Path after /api/" },
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
      description: `Manage public mock endpoints served at ${origin}/api/<slug>. See ${origin}/llms.txt`,
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
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
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "ADMIN_TOKEN" } },
      schemas: {
        EndpointInput: endpointInput,
        Endpoint: endpoint,
        Error: { type: "object", properties: { error: { type: "string" } } },
      },
    },
  };
}
