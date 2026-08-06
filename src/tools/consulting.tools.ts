import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";

export const consultingTools: McpServerTool[] = [
  {
    name: "validate_tax_id",
    description: "Valida que un RFC tenga el formato correcto segun el SAT. La validacion contra el SAT se realiza automaticamente al crear un cliente o factura.",
    inputSchema: {
      account_id: z.string().optional(),
      rfc: z.string().describe("RFC a validar (ej: XAXX010101000)"),
    },
    handler: async ({ rfc }) => {
      const valid = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            rfc,
            valid,
            message: valid
              ? "Formato RFC valido. La validacion completa contra el SAT se hace al crear el cliente."
              : "Formato RFC invalido. Debe ser: 4 letras + 6 digitos + 3 caracteres (homoclave).",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "check_billing_service_status",
    description: "Verifica que el servicio de timbrado este operativo.",
    inputSchema: {
      account_id: z.string().optional(),
    },
    handler: async () => {
      try {
        const r = await fetch("https://www.facturapi.io", { signal: AbortSignal.timeout(5000) });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, status: r.ok ? "operational" : "degraded" }, null, 2),
          }],
        };
      } catch {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: false, status: "unreachable", message: "No se pudo contactar el servicio" }, null, 2),
          }],
        };
      }
    },
  },
  {
    name: "lookup_sat_product_code",
    description: `Busca en el catalogo SAT la clave de producto o servicio por nombre.

Claves comunes:
- 80101506 Servicios de consultoria administrativa
- 81111500 Servicios de desarrollo de software
- 43231500 Software de negocios
- 81111800 Servicios de soporte TI
- 84121800 Servicios de marketing
- 80141600 Servicios de ventas`,
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().describe("Palabras clave para buscar (ej: 'software', 'consultoria')"),
    },
    handler: async ({ query }) => {
      const catalog: Record<string, string[]> = {
        software: ["81111500","43231500","43232400"],
        consultoria: ["80101506","80101600","80101601"],
        desarrollo: ["81111500","81111501"],
        marketing: ["84121800","84121801"],
        diseno: ["81111502","82121500"],
        legal: ["80121500","80121501"],
        contabilidad: ["84111500","84111600"],
        capacitacion: ["86132000","86111500"],
        transporte: ["78111800","78141500"],
        medico: ["85111500","85121600"],
        construccion: ["72101500","72121500"],
      };

      const q = String(query).toLowerCase();
      let results: { code: string; match: string }[] = [];
      for (const [key, codes] of Object.entries(catalog)) {
        if (key.includes(q) || codes.some(c => c.includes(q))) {
          for (const c of codes) results.push({ code: c, match: key });
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query,
            results: results.length > 0 ? results : [{ code: "Buscar en SAT", match: "Usa el catalogo completo en facturapi.io/catalogs" }],
            tip: "Para busquedas exactas usa el buscador en el portal del SAT o en tu dashboard.",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "lookup_sat_unit_code",
    description: `Muestra claves de unidad de medida SAT comunes.

Unidades frecuentes:
- H87 Pieza / Elemento (default para productos)
- KGM Kilogramo
- LTR Litro
- HUR Hora
- E48 Unidad de servicio
- MTR Metro
- MTK Metro cuadrado
- PR Pareja / Par`,
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().optional().describe("Unidad a buscar (ej: 'kilogramo', 'litro', 'hora')"),
    },
    handler: async ({ query }) => {
      const units: Record<string, { code: string; name: string }> = {
        pieza: { code: "H87", name: "Elemento/Pieza" },
        elemento: { code: "H87", name: "Elemento/Pieza" },
        kilogramo: { code: "KGM", name: "Kilogramo" },
        litro: { code: "LTR", name: "Litro" },
        hora: { code: "HUR", name: "Hora" },
        servicio: { code: "E48", name: "Unidad de Servicio" },
        metro: { code: "MTR", name: "Metro" },
        mt2: { code: "MTK", name: "Metro Cuadrado" },
        par: { code: "PR", name: "Par" },
        caja: { code: "BX", name: "Caja" },
        juego: { code: "SET", name: "Juego/Set" },
      };

      const q = String(query || "").toLowerCase();
      let results = Object.entries(units);
      if (q) results = results.filter(([k]) => k.includes(q) || units[k].name.toLowerCase().includes(q));

      return {
        content: [{
          type: "text",
          text: JSON.stringify(results.map(([, v]) => v), null, 2),
        }],
      };
    },
  },
  {
    name: "get_current_billing_stats",
    description: "Estadisticas del periodo actual: facturas emitidas, timbres disponibles, total facturado, cancelaciones.",
    inputSchema: {
      account_id: z.string(),
    },
    handler: async ({ account_id }) => {
      try {
        const org = await db.getOrganizationByAccount(account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

        const { rows } = await db.getPool().query(
          `SELECT * FROM billing_activity_log 
           WHERE organization_id = $1 AND created_at >= $2`,
          [org.id, monthStart]
        );

        const invoicesThisMonth = rows.filter((r: any) =>
          r.document_type === "invoice" && r.action_type === "invoice_created"
        ).length;

        const cancelledThisMonth = rows.filter((r: any) =>
          r.action_type === "invoice_cancelled"
        ).length;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              organization: org.organization_name,
              rfc: org.rfc,
              invoices_this_month: invoicesThisMonth,
              receipts_this_month: rows.filter((r: any) => r.document_type === "receipt").length,
              retentions_this_month: rows.filter((r: any) => r.document_type === "retention").length,
              cancelled_this_month: cancelledThisMonth,
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
];
