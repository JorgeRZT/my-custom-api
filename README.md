# My Custom API

Crea tus propias URLs de API públicas en Cloudflare Workers y define qué devuelven (contenido, status code y formato) desde un dashboard.

- **Dashboard**: `https://<tu-worker>.workers.dev/` (protegido con `ADMIN_TOKEN`)
- **APIs públicas**: `https://<tu-worker>.workers.dev/api/<ruta>` o, por usuario, `/api/u/<id>/<ruta>` (abiertas, con CORS `*`)

## Funcionalidades
- Rutas anidadas (`/api/users/list`), método (`ANY`, `GET`, `POST`, …), status code 200–599
- Formatos: JSON, texto, HTML, XML, CSV o `Content-Type` personalizado
- Cabeceras extra, retardo simulado (0–10 s), descripción
- Copiar URL, probar respuesta, editar y borrar desde el dashboard
- Almacenamiento en Cloudflare KV
- Documentación para LLMs: `/llms.txt` (instrucciones en lenguaje natural) y `/openapi.json` (OpenAPI 3.1)

## Login con Google (varias cuentas)
El dashboard permite entrar con Google además del `ADMIN_TOKEN` (que sigue valiendo para la Admin API y los LLM).

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crea un **OAuth client ID** de tipo *Web application*.
2. Añade como *Authorized redirect URI*: `https://<tu-worker>.workers.dev/auth/google/callback` (y `http://localhost:8787/auth/google/callback` para local).
3. Define las variables:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `ALLOWED_EMAILS`: cuentas autorizadas separadas por comas; admite `*@dominio.com`. Si está vacía, nadie puede entrar con Google.

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS
```
### APIs y token por usuario
- Cada cuenta de Google tiene **su propio conjunto de APIs**, públicas en `https://<worker>/api/u/<tu-id>/<ruta>`. El dashboard muestra la URL correcta y nadie ve ni toca las APIs de otra cuenta.
- En el dashboard, **🔑 Mi token** genera un token personal (`mca_…`). Se muestra una sola vez, se guarda hasheado y se puede regenerar o revocar. Se usa como `Authorization: Bearer mca_…` en la Admin API y solo da acceso a tus APIs. Los tokens solo se gestionan desde una sesión de Google, nunca con otro token.
- `GET /_admin/me` devuelve el conjunto que gestiona el token y su `publicBase`.
- El `ADMIN_TOKEN` global sigue existiendo y gestiona las APIs antiguas en `/api/<ruta>`.
- `ALLOWED_EMAILS` admite también `*` para permitir cualquier cuenta de Google.

Las sesiones duran 7 días, se guardan en KV y quitar un email de `ALLOWED_EMAILS` las invalida.

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
