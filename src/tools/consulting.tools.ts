import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as db from "../lib/db.js";
import { searchProductKeys, searchUnitKeys, getAllUnitKeys } from "../lib/catalogs.js";

export const consultingTools: McpServerTool[] = [
  {
    name: "validate_tax_id",
    description: "Valida el formato de un RFC segun las reglas del SAT.",
    inputSchema: {
      account_id: z.string().optional(),
      rfc: z.string().describe("RFC a validar (ej: XAXX010101000)"),
    },
    handler: async ({ rfc }) => {
      const valid = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(rfc));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            rfc, valid,
            message: valid ? "Formato RFC valido." : "Formato RFC invalido. Debe ser: 4 letras + 6 digitos + 3 caracteres.",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "check_billing_service_status",
    description: "Verifica el estado del servicio de timbrado e indica el entorno actual (test/live).",
    inputSchema: { account_id: z.string().optional() },
    handler: async () => {
      const hasLiveKey = !!(process.env.FACTURAPI_LIVE_KEY);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            status: "operational",
            environment: hasLiveKey ? "live" : "test",
            warning: hasLiveKey ? "⚠️ FACTURAS REALES - Se timbraran al SAT" : "🟡 MODO PRUEBAS - Facturas sin validez fiscal",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "lookup_sat_product_code",
    description: `Busca en el catalogo oficial del SAT (c_ClaveProdServ) la clave de producto o servicio.
Soporta busqueda por nombre, palabra clave o codigo. Devuelve codigo, nombre oficial y categoria.`,
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().describe("Texto a buscar (ej: 'software', 'cemento', 'consultoria')"),
    },
    handler: async ({ query }) => {
      try {
        const results = await searchProductKeys(String(query));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              results,
              total: results.length,
              tip: results.length === 0 ? "Prueba con palabras clave mas cortas o genericas." : undefined,
            }, null, 2),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
      }
    },
  },
  {
    name: "lookup_sat_unit_code",
    description: `Busca en el catalogo oficial del SAT (c_ClaveUnidad) la clave de unidad de medida.
Soporta busqueda por nombre, codigo o descripcion.`,
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().optional().describe("Unidad a buscar. Si se omite, devuelve el catalogo completo."),
    },
    handler: async ({ query }) => {
      try {
        const q = query ? String(query) : "";
        const results = q ? await searchUnitKeys(q) : await getAllUnitKeys();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ query: q || "(todas)", results, total: results.length }, null, 2),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
      }
    },
  },
  {
    name: "get_current_billing_stats",
    description: "Estadisticas del periodo actual: facturas emitidas, timbres disponibles, total facturado, cancelaciones.",
    inputSchema: { account_id: z.string() },
    handler: async ({ account_id }) => {
      try {
        const org = await db.getOrganizationByAccount(String(account_id));
        if (!org) throw new Error("No hay organizacion configurada");
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const { rows } = await db.getPool().query(
          `SELECT * FROM billing_activity_log WHERE organization_id = $1 AND created_at >= $2`,
          [org.id, monthStart]
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              organization: org.organization_name,
              rfc: org.rfc,
              invoices_this_month: rows.filter((r: any) => r.document_type === "invoice" && r.action_type === "invoice_created").length,
              cancelled_this_month: rows.filter((r: any) => r.action_type === "invoice_cancelled").length,
              invoice_quota: org.invoice_quota,
              remaining: org.invoice_quota - org.current_month_invoices,
              csd_expires_at: org.csd_expires_at,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_my_account",
    description: `Devuelve informacion de la cuenta conectada actualmente: ID de cuenta, organizacion, RFC, estado de configuracion y entorno.
Usa esta herramienta al inicio de cada sesion para saber en que cuenta y entorno estas trabajando.`,
    inputSchema: {
      account_id: z.string().optional().describe("Si no se proporciona, se intenta resolver del token de autenticacion."),
    },
    handler: async ({ account_id }) => {
      const hasLiveKey = !!(process.env.FACTURAPI_LIVE_KEY);
      if (!account_id) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              environment: hasLiveKey ? "live" : "test",
              warning: hasLiveKey ? "⚠️ FACTURAS REALES" : "🟡 MODO PRUEBAS",
              account_id: null,
              message: "No se proporciono account_id. Para herramientas con estado, usa el account_id de tu cuenta conectus.mx.",
            }, null, 2),
          }],
        };
      }
      try {
        const org = await db.getOrganizationByAccount(String(account_id));
        if (!org) {
          return { content: [{ type: "text", text: JSON.stringify({
            environment: hasLiveKey ? "live" : "test",
            account_id,
            configured: false,
            message: "Cuenta sin organizacion fiscal. Usa onboarding_start para configurarla.",
          }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({
          environment: hasLiveKey ? "live" : "test",
          account_id,
          organization_name: org.organization_name,
          rfc: org.rfc,
          facturapi_organization_id: org.facturapi_organization_id,
          checklist: org.setup_status,
          csd_expires_at: org.csd_expires_at,
        }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];
