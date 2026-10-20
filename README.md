# My Custom API

Crea tus propias URLs de API públicas en Cloudflare Workers y define qué devuelven (contenido, status code y formato) desde un dashboard.

- **Dashboard**: `https://<tu-worker>.workers.dev/` (protegido con `ADMIN_TOKEN`)
- **APIs públicas**: `https://<tu-worker>.workers.dev/api/<ruta>` (abiertas, con CORS `*`)

## Funcionalidades
- Rutas anidadas (`/api/users/list`), método (`ANY`, `GET`, `POST`, …), status code 200–599
- Formatos: JSON, texto, HTML, XML, CSV o `Content-Type` personalizado
- Cabeceras extra, retardo simulado (0–10 s), descripción
- Copiar URL, probar respuesta, editar y borrar desde el dashboard
- Almacenamiento en Cloudflare KV
- Documentación para LLMs: `/llms.txt` (instrucciones en lenguaje natural) y `/openapi.json` (OpenAPI 3.1)

## Uso con un LLM
Pasa al LLM la URL `https://<tu-worker>/llms.txt` y tu `ADMIN_TOKEN`. Con esa información puede listar, crear, editar y borrar endpoints usando la Admin API.
Para herramientas que importan OpenAPI (GPT Actions, function calling, etc.) usa `https://<tu-worker>/openapi.json` con autenticación Bearer.

## Desarrollo local
```bash
npm install
cp .dev.vars.example .dev.vars   # define ADMIN_TOKEN
npm run dev                      # http://localhost:8787
```

## Despliegue en Cloudflare
```bash
npx wrangler login
npx wrangler deploy                      # crea el Worker y el KV automáticamente
npx wrangler secret put ADMIN_TOKEN      # define el token del dashboard
```
> Si tu versión de Wrangler no auto-crea el KV: `npx wrangler kv namespace create ENDPOINTS` y añade el `id` en `wrangler.jsonc`.

## Admin API (Bearer `ADMIN_TOKEN`)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/_admin/endpoints` | Listar |
| POST | `/_admin/endpoints` | Crear |
| GET/PUT/DELETE | `/_admin/endpoints/<ruta>` | Ver / actualizar (parcial) / borrar |

Ejemplo:
```bash
curl -X POST https://<worker>/_admin/endpoints \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"hello","method":"GET","status":200,"format":"json","body":"{\"msg\":\"hi\"}"}'
```
