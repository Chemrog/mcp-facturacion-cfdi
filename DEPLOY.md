# Deploy en Coolify — MCP Facturación CFDI

## Repositorio

- **Nombre del repo:** `conectus-mx/mcp-facturacion-cfdi`
- **URL sugerida:** `https://github.com/conectus-mx/mcp-facturacion-cfdi`
- **Rama:** `main`

## Dockerfile

Es **Dockerfile** simple (no docker-compose). **Multi-stage build**: compila TypeScript dentro del contenedor en stage 1, luego solo copia `dist/` al stage 2 de runtime.

- **Puerto expuesto:** 3002 (EXPOSE en Dockerfile)
- **Base image:** node:22-alpine
- **Build:** `npm ci` → `tsc` (stage 1) → `npm ci --omit=dev` (stage 2)

## Variables de entorno (copiar a Coolify)

⚠️ **Importante:** Marcar TODAS las variables como **"Runtime only"** en Coolify. No marcarlas como "Available at Buildtime" porque eso las expone en el Dockerfile y genera warnings de seguridad.

```
PORT=3002
NODE_ENV=production
FACTURAPI_LIVE_KEY=
FACTURAPI_TEST_KEY=sk_test_4Bf5zAX5iUCx3NVZ5jncFtCrz5bCvs9dYb35y4PcQf
FACTURAPI_USER_KEY=sk_user_HgDs2SwDhhzrgUuKp79TRDEcGkbqdKkEbuVGfCTtXQ
NEON_DATABASE_URL=postgresql://neondb_owner:npg_gQLHT8KGr1qA@ep-super-brook-axbv0ara-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
NEON_POOL_URL=postgresql://neondb_owner:npg_gQLHT8KGr1qA@ep-super-brook-axbv0ara-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
ENCRYPTION_KEY=68055f3776b76a1ff1abc63070562bd65f93e1cf24911da743e1da0c4d367e02
INTERNAL_SECRET=conectus-internal-secret-dev
```

## Pasos en Coolify

1. **GitHub** → Subir el repo a GitHub
2. **Coolify** → New Resource → Application
3. **Source** → GitHub App → seleccionar repo `conectus-mx/mcp-facturacion-cfdi`
4. **Branch** → `main`
5. **Build Pack** → `Dockerfile` (lo detecta solo)
6. **Ports** → `3002:3002`
7. **Environment Variables** → copiar todas las de arriba
8. **Domains** → `facturacion.catrender.com`
9. **Deploy**

## Verificar deploy

```bash
# Health check
curl https://facturacion.catrender.com/health
# → {"status":"ok","mcp":"conectus-facturacion-cfdi"}

# MCP tools list (requiere auth)
curl -H "Authorization: Bearer conectus-internal-secret-dev" \
  https://facturacion.catrender.com/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  -H "Content-Type: application/json"
```

## Dominio temporal → producción

Cuando tengas `facturacion.mcp.conectus.mx`:
1. Apunta el DNS en Cloudflare a la IP de Coolify
2. Cambia el dominio en Coolify
3. Actualiza `baseUrl` en el admin de conectus.mx (`/admin/mcps` → editar Facturación CFDI)

## Cambiar de Test a Live (facturas reales)

```bash
# En Coolify → Environment Variables → Editar
FACTURAPI_LIVE_KEY=sk_live_TU_KEY_REAL
```
Reinicia el contenedor. Las facturas ahora se timbrarán al SAT.
