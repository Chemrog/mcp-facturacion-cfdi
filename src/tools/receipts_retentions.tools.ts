import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";

async function ensureOrg(accountId: string): Promise<db.DbOrganization> {
  const org = await db.getOrganizationByAccount(accountId);
  if (!org) throw new Error("No hay organizacion configurada. Usa onboarding_start primero.");
  if (!org.facturapi_organization_id) throw new Error("Organizacion no sincronizada. Completa el onboarding.");
  return org;
}

export const receiptTools: McpServerTool[] = [
  {
    name: "create_receipt",
    description: `Crea un recibo de compra digital (e-receipt).
Los recibos son comprobantes de venta simplificados que no requieren datos fiscales del cliente.
Pueden convertirse en factura (CFDI) posteriormente.`,
    inputSchema: {
      account_id: z.string(),
      items: z.array(z.object({
        quantity: z.number().min(1),
        discount: z.number().min(0).default(0),
        product_id: z.string().optional(),
        product_data: z.object({
          description: z.string(),
          product_key: z.string(),
          price: z.number().min(0),
        }).optional(),
      })),
      payment_form: z.string().describe("Forma de pago SAT (ej: '01'=Efectivo, '03'=Transferencia)"),
      currency: z.string().default("MXN"),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const receipt = await facturapi.receipts.create({
          items: input.items.map((item: any) => ({
            quantity: item.quantity,
            discount: item.discount ?? 0,
            product: item.product_id ? { id: item.product_id } : item.product_data,
          })),
          payment_form: input.payment_form,
          currency: input.currency,
        }, "live") as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id: input.account_id,
          action_type: "receipt_created",
          document_type: "receipt",
          facturapi_invoice_id: receipt.id as string,
          total: receipt.total as number,
          status: "valid",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Recibo creado", receipt }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "list_receipts",
    description: "Lista recibos emitidos con paginacion.",
    inputSchema: {
      account_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const result = await facturapi.receipts.list({ page: input.page, limit: input.limit }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_receipt_details",
    description: "Obtiene detalles completos de un recibo.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const receipt = await facturapi.receipts.get(input.receipt_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "link_customer_to_receipt",
    description: "Asigna o cambia el cliente asociado a un recibo.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
      customer_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const result = await facturapi.receipts.assignCustomer(input.receipt_id, input.customer_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "cancel_receipt",
    description: "Cancela un recibo.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.receipts.cancel(input.receipt_id);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Recibo cancelado" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "download_receipt_pdf",
    description: "Descarga el PDF de un recibo.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const buffer = await facturapi.receipts.downloadPdf(input.receipt_id);
        return { content: [{ type: "text", text: `PDF de recibo ${input.receipt_id} generado (${buffer.length} bytes)` }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "email_receipt_to_customer",
    description: "Envia recibo por correo electronico al cliente.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
      email: z.string().email(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.receipts.sendByEmail(input.receipt_id, { email: input.email });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Recibo enviado por email" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "convert_receipt_to_invoice",
    description: "Convierte un recibo individual en factura CFDI. El recibo debe tener un cliente asignado.",
    inputSchema: {
      account_id: z.string(),
      receipt_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const invoice = await facturapi.receipts.invoice(input.receipt_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Recibo facturado", invoice }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "convert_multiple_receipts_to_invoice",
    description: "Agrupa multiples recibos en una sola factura CFDI.",
    inputSchema: {
      account_id: z.string(),
      receipt_ids: z.array(z.string()).min(1).max(100),
      payment_form: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const invoice = await facturapi.receipts.invoiceMultiple({
          receipts: input.receipt_ids,
          payment_form: input.payment_form,
        }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, invoice }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "create_periodic_global_invoice",
    description: `Crea una factura global por todos los recibos no facturados en un periodo.
Util para emitir una sola factura que cubra todas las ventas al publico en general de un mes.`,
    inputSchema: {
      account_id: z.string(),
      periodicity: z.string().default("monthly").describe("Periodicidad: 'monthly', 'biweekly', 'weekly'"),
      months: z.string().describe("Mes(es) a facturar (ej: '01', '12', '01,02,03')"),
      year: z.number().int().describe("Año (ej: 2026)"),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const invoice = await facturapi.receipts.createGlobalInvoice({
          periodicity: input.periodicity,
          months: input.months,
          year: input.year,
        }) as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id: input.account_id,
          action_type: "global_invoice_created",
          document_type: "invoice",
          facturapi_invoice_id: invoice.id as string,
          status: "valid",
        });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Factura global creada", invoice }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];

export const retentionTools: McpServerTool[] = [
  {
    name: "create_tax_retention",
    description: "Crea un comprobante de retencion de impuestos (IVA, ISR).",
    inputSchema: {
      account_id: z.string(),
      type: z.string().describe("Tipo de retencion"),
      customer_id: z.string(),
      items: z.array(z.object({
        tax_type: z.string().describe("Tipo de impuesto: 'IVA', 'ISR'"),
        tax_rate: z.number().min(0).max(1),
        base: z.number().min(0),
        tax_amount: z.number().min(0),
        description: z.string().optional(),
      })),
      date: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const retention = await facturapi.retentions.create({
          type: input.type,
          customer: { id: input.customer_id },
          items: input.items,
          date: input.date,
        }, "live") as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id: input.account_id,
          action_type: "retention_created",
          document_type: "retention",
          status: "valid",
        });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, retention }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "list_retentions",
    description: "Lista retenciones emitidas.",
    inputSchema: {
      account_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const result = await facturapi.retentions.list({ page: input.page, limit: input.limit }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_retention_details",
    description: "Obtiene detalle completo de una retencion.",
    inputSchema: {
      account_id: z.string(),
      retention_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const retention = await facturapi.retentions.get(input.retention_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(retention, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "cancel_retention",
    description: "Cancela una retencion.",
    inputSchema: {
      account_id: z.string(),
      retention_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.retentions.cancel(input.retention_id);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Retencion cancelada" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "download_retention_document",
    description: "Descarga XML/PDF de una retencion.",
    inputSchema: {
      account_id: z.string(),
      retention_id: z.string(),
      format: z.enum(["xml","pdf","zip"]).default("zip"),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const buffer = await facturapi.retentions.download(input.retention_id, input.format);
        return { content: [{ type: "text", text: `Documento de retencion ${input.retention_id} descargado (${buffer.length} bytes)` }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "email_retention_to_customer",
    description: "Envia retencion por correo electronico.",
    inputSchema: {
      account_id: z.string(),
      retention_id: z.string(),
      email: z.string().email(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.retentions.sendByEmail(input.retention_id, { email: input.email });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Retencion enviada por email" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];
