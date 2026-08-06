import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";

export const reportsTools: McpServerTool[] = [
  {
    name: "get_monthly_billing_summary",
    description: "Resumen de facturacion del mes actual: monto total, IVA, conteo de facturas emitidas y canceladas.",
    inputSchema: {
      account_id: z.string(),
      month: z.number().int().min(1).max(12).optional().describe("Mes (1-12). Si se omite, mes actual."),
      year: z.number().int().optional().describe("Año. Si se omite, año actual."),
    },
    handler: async ({ account_id, month, year }) => {
      try {
        const org = await db.getOrganizationByAccount(account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const now = new Date();
        const m = month ?? now.getMonth() + 1;
        const y = year ?? now.getFullYear();
        const startDate = new Date(y, m - 1, 1).toISOString();
        const endDate = new Date(y, m, 0).toISOString();

        const result = await facturapi.invoices.list({
          date: { gt: startDate, lt: endDate } as any,
          limit: 100,
        }) as { data?: Array<Record<string, unknown>>; total_results?: number };

        const invoices = result.data ?? [];

        const totalBilled = invoices
          .filter((inv: Record<string, unknown>) => inv.status === "valid")
          .reduce((sum: number, inv: Record<string, unknown>) => sum + (inv.total as number ?? 0), 0);

        const cancelledCount = invoices.filter(
          (inv: Record<string, unknown>) => inv.status === "cancelled"
        ).length;

        const validCount = invoices.filter(
          (inv: Record<string, unknown>) => inv.status === "valid"
        ).length;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              period: { month: m, year: y },
              valid_invoices: validCount,
              cancelled_invoices: cancelledCount,
              total_billed_mxn: Math.round(totalBilled * 100) / 100,
              iva_approx: Math.round(totalBilled * 0.16 * 100) / 100,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_detailed_billing_report",
    description: "Reporte detallado de facturacion con filtros por periodo, cliente y tipo de comprobante.",
    inputSchema: {
      account_id: z.string(),
      date_from: z.string().optional().describe("Fecha inicio (ISO8601)"),
      date_to: z.string().optional().describe("Fecha fin (ISO8601)"),
      customer_id: z.string().optional(),
      type: z.enum(["I","E","P","N","T"]).optional(),
      status: z.enum(["draft","pending","valid","cancelled"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const params: Record<string, string | number | boolean | undefined> = {
          page: input.page,
          limit: input.limit,
        };
        if (input.customer_id) params.customer = input.customer_id;
        if (input.status) params.status = input.status;
        if (input.type) params.type = input.type;

        const result = await facturapi.invoices.list(params) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_customer_invoice_history",
    description: "Historial completo de facturas emitidas a un cliente.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const result = await facturapi.invoices.list({
          customer: input.customer_id,
          page: input.page,
          limit: input.limit,
        }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_date_range_invoices",
    description: "Obtiene facturas emitidas en un rango de fechas especifico.",
    inputSchema: {
      account_id: z.string(),
      date_from: z.string().describe("Fecha inicio (YYYY-MM-DD o ISO8601)"),
      date_to: z.string().describe("Fecha fin (YYYY-MM-DD o ISO8601)"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const result = await facturapi.invoices.list({
          date: { gt: input.date_from, lt: input.date_to } as any,
          page: input.page,
          limit: input.limit,
        }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_pending_payment_invoices",
    description: "Facturas emitidas con metodo de pago PPD (Pago en Parcialidades o Diferido) que estan pendientes de pago.",
    inputSchema: {
      account_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const result = await facturapi.invoices.list({
          payment_method: "PPD",
          status: "valid",
          page: input.page,
          limit: input.limit,
        }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_cancelled_invoices_report",
    description: "Facturas canceladas en un periodo especifico.",
    inputSchema: {
      account_id: z.string(),
      date_from: z.string().optional().describe("Fecha inicio"),
      date_to: z.string().optional().describe("Fecha fin"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        const params: Record<string, string | number | boolean | undefined> = {
          status: "cancelled",
          page: input.page,
          limit: input.limit,
        };
        if (input.date_from && input.date_to) {
          params.date = { gt: input.date_from, lt: input.date_to } as unknown as string | number | boolean | undefined;
        }

        const result = await facturapi.invoices.list(params) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];

export const webhookTools: McpServerTool[] = [
  {
    name: "configure_webhook",
    description: "Configura un webhook para recibir notificaciones de eventos de facturacion (factura creada, cancelada, etc.).",
    inputSchema: {
      account_id: z.string(),
      url: z.string().url().describe("URL donde se enviaran los eventos"),
      events: z.array(z.string()).describe("Eventos a suscribir (ej: ['invoice.created', 'invoice.cancelled'])"),
      description: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.webhooks.create({
          url: input.url,
          events: input.events,
          description: input.description,
        }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, webhook: result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "list_webhooks",
    description: "Lista los webhooks configurados.",
    inputSchema: {
      account_id: z.string(),
    },
    handler: async () => {
      try {
        const result = await facturapi.webhooks.list() as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "update_webhook",
    description: "Modifica un webhook existente.",
    inputSchema: {
      account_id: z.string(),
      webhook_id: z.string(),
      url: z.string().url().optional(),
      events: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    },
    handler: async (input) => {
      try {
        const data: Record<string, unknown> = {};
        if (input.url) data.url = input.url;
        if (input.events) data.events = input.events;
        if (input.enabled !== undefined) data.enabled = input.enabled;

        const result = await facturapi.webhooks.update(input.webhook_id, data) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, webhook: result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "remove_webhook",
    description: "Elimina un webhook.",
    inputSchema: {
      account_id: z.string(),
      webhook_id: z.string(),
    },
    handler: async ({ account_id, webhook_id }) => {
      try {
        await facturapi.webhooks.delete(webhook_id);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Webhook eliminado" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];
