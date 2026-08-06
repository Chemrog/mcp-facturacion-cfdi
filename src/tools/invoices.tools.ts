import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";
import { customerSchema, lineItemSchema } from "../lib/validation.js";

function getOrgFacturApiId(org: db.DbOrganization): string {
  if (!org.facturapi_organization_id) throw new Error("Organizacion no sincronizada con FacturAPI");
  return org.facturapi_organization_id;
}

async function ensureOrg(accountId: string): Promise<db.DbOrganization> {
  const org = await db.getOrganizationByAccount(accountId);
  if (!org) throw new Error("No hay organizacion configurada. Usa onboarding_start primero.");
  return org;
}

export const invoiceTools: McpServerTool[] = [
  // ============================================================
  // 25. create_invoice
  // ============================================================
  {
    name: "create_invoice",
    description: `Crea y timbra una factura electronica (CFDI 4.0) inmediatamente.

TIPOS DE FACTURA SOPORTADOS:
- "I" = Ingreso (factura de venta) - DEFAULT
- "E" = Egreso (nota de credito)
- "P" = Pago (complemento de pago)
- "N" = Nomina (recibo de nomina)
- "T" = Traslado (traslado de mercancia)

DATOS IMPORTANTES:
- customer: Puedes pasar el ID de un cliente existente O crear uno nuevo pasando sus datos completos
- items: Array de conceptos. Cada uno requiere quantity y product (ID de producto existente O datos del producto)
- payment_form: Clave SAT de forma de pago (2 digitos, ej: '01'=Efectivo, '03'=Transferencia, '04'=Tarjeta)
- payment_method: 'PUE' (pago en una sola exhibicion) o 'PPD' (pago en parcialidades)
- use: Clave de uso CFDI (default: 'G01' = Adquisicion de mercancias)

La factura se timbra y envia al SAT. Recibiras el UUID, XML, PDF y URL de verificacion.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      type: z.enum(["I","E","P","N","T"]).default("I").describe("Tipo de comprobante"),
      customer_id: z.string().optional().describe("ID del cliente existente. Usa este O customer_data"),
      customer_data: z.object({
        legal_name: z.string(),
        tax_id: z.string(),
        tax_system: z.string().length(3),
        address: z.object({
          zip: z.string(),
          country: z.string().default("MEX"),
          street: z.string().optional(),
          exterior: z.string().optional(),
          interior: z.string().optional(),
          neighborhood: z.string().optional(),
          city: z.string().optional(),
          municipality: z.string().optional(),
          state: z.string().optional(),
        }),
        email: z.string().email().optional(),
        phone: z.string().optional(),
      }).optional().describe("Datos del nuevo cliente. Usa este O customer_id"),
      items: z.array(z.object({
        quantity: z.number().min(1),
        discount: z.number().min(0).default(0),
        product_id: z.string().optional().describe("ID del producto en catalogo"),
        product_data: z.object({
          description: z.string(),
          product_key: z.string(),
          price: z.number().min(0),
          unit_key: z.string().default("H87"),
          unit_name: z.string().default("Elemento"),
          tax_included: z.boolean().default(true),
          taxability: z.enum(["01","02","03","04","05","06","07","08"]).default("02"),
        }).optional().describe("Datos del producto. Usa este O product_id"),
      })).describe("Conceptos de la factura"),
      payment_form: z.string().describe("Forma de pago SAT (ej: '01'=Efectivo, '03'=Transferencia, '04'=Tarjeta)"),
      payment_method: z.enum(["PUE","PPD"]).default("PUE"),
      use: z.string().default("G01").describe("Uso CFDI (default: 'G01'=Adquisicion mercancias)"),
      currency: z.string().default("MXN"),
      exchange: z.number().default(1),
      series: z.string().optional().describe("Serie para control interno (max 25 caracteres)"),
      folio_number: z.number().int().optional().describe("Numero de folio (si se omite, es autoincremental)"),
      external_id: z.string().optional().describe("ID externo para referencia en tus sistemas"),
      conditions: z.string().optional().describe("Condiciones de pago (texto libre)"),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const facturApiId = getOrgFacturApiId(org);

        const customer = input.customer_id
          ? { id: input.customer_id }
          : input.customer_data ?? null;

        if (!customer) throw new Error("Debes proporcionar customer_id o customer_data");

        const payload: Record<string, unknown> = {
          type: input.type,
          customer,
          items: input.items.map((item: any) => ({
            quantity: item.quantity,
            discount: item.discount,
            product: item.product_id
              ? { id: item.product_id }
              : item.product_data,
          })),
          payment_form: input.payment_form,
          payment_method: input.payment_method,
          use: input.use,
          currency: input.currency,
          exchange: input.exchange,
        };

        if (input.series) payload.series = input.series;
        if (input.folio_number) payload.folio_number = input.folio_number;
        if (input.external_id) payload.external_id = input.external_id;
        if (input.conditions) payload.conditions = input.conditions;

        const invoice = await facturapi.invoices.create(payload) as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id: input.account_id,
          action_type: "invoice_created",
          document_type: "invoice",
          facturapi_invoice_id: invoice.id as string,
          cfdi_uuid: invoice.uuid as string,
          customer_name: (customer as Record<string, unknown>).legal_name as string,
          total: invoice.total as number,
          status: "valid",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "✅ Factura creada y timbrada exitosamente",
              invoice,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al crear factura",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 26. create_draft_invoice
  // ============================================================
  {
    name: "create_draft_invoice",
    description: `Guarda una factura como borrador SIN timbrarla ni enviarla al SAT.
Util para preparar facturas que requieren revision antes de emitirse.
Los borradores aceptan datos incompletos. Para timbrarlo despues, usa stamp_draft_invoice.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      type: z.enum(["I","E","P","N","T"]).default("I"),
      customer_id: z.string().optional(),
      customer_data: z.object({
        legal_name: z.string(),
        tax_id: z.string(),
        tax_system: z.string().length(3),
        address: z.object({
          zip: z.string(),
          country: z.string().default("MEX"),
        }),
      }).optional(),
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
      payment_form: z.string().optional(),
      payment_method: z.enum(["PUE","PPD"]).optional(),
      use: z.string().optional(),
      currency: z.string().default("MXN"),
      series: z.string().optional(),
      external_id: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const facturApiId = getOrgFacturApiId(org);

        const payload: Record<string, unknown> = {
          type: input.type,
          status: "draft",
          currency: input.currency,
        };

        if (input.customer_id) {
          payload.customer = { id: input.customer_id };
        } else if (input.customer_data) {
          payload.customer = input.customer_data;
        }

        payload.items = input.items.map((item: any) => ({
          quantity: item.quantity,
          discount: item.discount ?? 0,
          product: item.product_id ? { id: item.product_id } : item.product_data,
        }));

        if (input.payment_form) payload.payment_form = input.payment_form;
        if (input.payment_method) payload.payment_method = input.payment_method;
        if (input.use) payload.use = input.use;
        if (input.series) payload.series = input.series;
        if (input.external_id) payload.external_id = input.external_id;

        const invoice = await facturapi.invoices.create(payload) as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id: input.account_id,
          action_type: "draft_created",
          document_type: "invoice",
          facturapi_invoice_id: invoice.id as string,
          status: "draft",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "✅ Borrador de factura creado. No se ha timbrado ni enviado al SAT.",
              invoice,
              next_step: "Para timbrar este borrador, usa stamp_draft_invoice con el ID de la factura.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al crear borrador",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 27. list_invoices
  // ============================================================
  {
    name: "list_invoices",
    description: `Lista facturas emitidas con filtros avanzados.
Puedes buscar por: texto, cliente, status, tipo, rango de fechas, y paginar resultados.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      query: z.string().optional().describe("Busqueda por texto (descripcion, RFC, nombre, UUID, folio, total)"),
      customer_id: z.string().optional().describe("Filtrar por ID de cliente"),
      status: z.enum(["draft","pending","valid","cancelled"]).optional().describe("Filtrar por estado"),
      type: z.enum(["I","E","P","N","T"]).optional().describe("Filtrar por tipo de comprobante"),
      date_from: z.string().optional().describe("Fecha inicial (ISO8601)"),
      date_to: z.string().optional().describe("Fecha final (ISO8601)"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const facturApiId = getOrgFacturApiId(org);

        const params: Record<string, string | number | boolean | undefined> = {
          page: input.page,
          limit: input.limit,
        };
        if (input.query) params.q = input.query;
        if (input.customer_id) params.customer = input.customer_id;
        if (input.status) params.status = input.status;
        if (input.type) params.type = input.type;

        const result = await facturapi.invoices.list(params) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al listar facturas",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 28. get_invoice_details
  // ============================================================
  {
    name: "get_invoice_details",
    description: `Obtiene TODOS los detalles de una factura especifica: datos del emisor, receptor, 
conceptos, impuestos, UUID, folio fiscal, cadena original, sellos digitales, URL de verificacion SAT,
estado de cancelacion, y metodos de pago.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      invoice_id: z.string().describe("ID de la factura en conectus.mx"),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        const org = await ensureOrg(account_id);
        const invoice = await facturapi.invoices.get(invoice_id) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify(invoice, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al obtener factura",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 29. edit_draft_invoice
  // ============================================================
  {
    name: "edit_draft_invoice",
    description: "Edita un borrador de factura existente. Solo se pueden editar facturas en estado 'draft'.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
      customer_id: z.string().optional(),
      items: z.array(z.object({
        quantity: z.number().min(1),
        discount: z.number().min(0).default(0),
        product_id: z.string().optional(),
        product_data: z.object({
          description: z.string(),
          product_key: z.string(),
          price: z.number().min(0),
        }).optional(),
      })).optional(),
      payment_form: z.string().optional(),
      payment_method: z.enum(["PUE","PPD"]).optional(),
      use: z.string().optional(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);

        const payload: Record<string, unknown> = {};
        if (input.customer_id) payload.customer = { id: input.customer_id };
        if (input.items) {
          payload.items = input.items.map((item: any) => ({
            quantity: item.quantity,
            discount: item.discount ?? 0,
            product: item.product_id ? { id: item.product_id } : item.product_data,
          }));
        }
        if (input.payment_form) payload.payment_form = input.payment_form;
        if (input.payment_method) payload.payment_method = input.payment_method;
        if (input.use) payload.use = input.use;

        const invoice = await facturapi.invoices.update(input.invoice_id, payload) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Borrador actualizado", invoice }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al editar borrador",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 30. stamp_draft_invoice
  // ============================================================
  {
    name: "stamp_draft_invoice",
    description: `Timbra un borrador de factura y lo envia al SAT.
La factura debe estar en estado 'draft'. Una vez timbrada, obtiene validez fiscal y se genera el UUID.`,
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string().describe("ID del borrador a timbrar"),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        const org = await ensureOrg(account_id);
        const invoice = await facturapi.invoices.stampDraft(invoice_id) as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id,
          action_type: "invoice_stamped",
          document_type: "invoice",
          facturapi_invoice_id: invoice.id as string,
          cfdi_uuid: invoice.uuid as string,
          total: invoice.total as number,
          status: "valid",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "✅ Borrador timbrado exitosamente. La factura ya tiene validez fiscal.",
              invoice,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al timbrar borrador",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 31. cancel_invoice
  // ============================================================
  {
    name: "cancel_invoice",
    description: `Solicita la cancelacion de una factura ante el SAT.
IMPORTANTE: La cancelacion debe ser aceptada por el receptor. 
La factura debe tener menos de 30 dias de emitida para cancelacion directa.`,
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string().describe("ID de la factura a cancelar"),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        const org = await ensureOrg(account_id);
        const result = await facturapi.invoices.cancel(invoice_id) as Record<string, unknown>;

        await db.recordBillingActivity({
          organization_id: org.id,
          account_id,
          action_type: "invoice_cancelled",
          document_type: "invoice",
          facturapi_invoice_id: invoice_id,
          status: "cancelled",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "✅ Solicitud de cancelacion enviada",
              result,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al cancelar factura",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 32. duplicate_invoice_as_draft
  // ============================================================
  {
    name: "duplicate_invoice_as_draft",
    description: "Crea una copia de una factura existente como nuevo borrador. Util para facturas recurrentes.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string().describe("ID de la factura a duplicar"),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const newDraft = await facturapi.invoices.copyToDraft(invoice_id) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Factura duplicada como borrador",
              draft: newDraft,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al duplicar factura",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 33. download_invoice_xml
  // ============================================================
  {
    name: "download_invoice_xml",
    description: "Descarga el archivo XML de la factura. El XML es el comprobante fiscal digital valido ante el SAT.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const buffer = await facturapi.invoices.download(invoice_id, "xml");

        return {
          content: [{
            type: "text",
            text: `XML de factura ${invoice_id} descargado (${buffer.length} bytes). El contenido XML se ha generado.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al descargar XML",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 34. download_invoice_pdf
  // ============================================================
  {
    name: "download_invoice_pdf",
    description: "Descarga la representacion impresa (PDF) de la factura.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const buffer = await facturapi.invoices.download(invoice_id, "pdf");

        return {
          content: [{
            type: "text",
            text: `PDF de factura ${invoice_id} generado (${buffer.length} bytes).`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al descargar PDF",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 35. download_invoice_bundle
  // ============================================================
  {
    name: "download_invoice_bundle",
    description: "Descarga un ZIP con el XML y PDF de la factura.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const buffer = await facturapi.invoices.download(invoice_id, "zip");

        return {
          content: [{
            type: "text",
            text: `ZIP de factura ${invoice_id} generado (${buffer.length} bytes). Contiene XML + PDF.`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al descargar ZIP",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 36. download_cancellation_proof
  // ============================================================
  {
    name: "download_cancellation_proof",
    description: "Descarga el acuse de cancelacion del SAT (PDF) que prueba que la factura fue cancelada.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const buffer = await facturapi.invoices.downloadCancellationReceipt(invoice_id);

        return {
          content: [{
            type: "text",
            text: `Acuse de cancelacion de factura ${invoice_id} generado (${buffer.length} bytes).`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al descargar acuse",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 37. email_invoice_to_customer
  // ============================================================
  {
    name: "email_invoice_to_customer",
    description: "Envia la factura por correo electronico al cliente. Se adjuntan XML y PDF.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
      email: z.string().email().optional().describe("Email del cliente. Si no se proporciona, se usa el del cliente registrado."),
      subject: z.string().optional().describe("Asunto del correo (opcional)"),
      message: z.string().optional().describe("Mensaje adicional en el cuerpo del correo"),
    },
    handler: async ({ account_id, invoice_id, email, subject, message }) => {
      try {
        await ensureOrg(account_id);

        const payload: Record<string, unknown> = {};
        if (email) payload.email = email;
        if (subject) payload.subject = subject;
        if (message) payload.message = message;

        await facturapi.invoices.sendByEmail(invoice_id, payload);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: `Factura enviada por email correctamente` }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al enviar email",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 38. preview_invoice_pdf
  // ============================================================
  {
    name: "preview_invoice_pdf",
    description: "Genera una vista previa del PDF de una factura sin necesidad de timbrarla. Util para ver como quedara la factura antes de emitirla.",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
    },
    handler: async ({ account_id, invoice_id }) => {
      try {
        await ensureOrg(account_id);
        const preview = await facturapi.invoices.previewPdf({ invoice_id }) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Vista previa generada", preview }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al generar preview",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 39. mark_invoice_as_paid
  // ============================================================
  {
    name: "mark_invoice_as_paid",
    description: "Actualiza el estado de la factura (ej: marcarla como pagada).",
    inputSchema: {
      account_id: z.string(),
      invoice_id: z.string(),
      status: z.string().describe("Nuevo estado (ej: 'paid')"),
    },
    handler: async ({ account_id, invoice_id, status }) => {
      try {
        await ensureOrg(account_id);
        const result = await facturapi.invoices.updateStatus(invoice_id, { status }) as Record<string, unknown>;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: `Factura actualizada a: ${status}`, result }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Error al actualizar estado",
            }, null, 2),
          }],
        };
      }
    },
  },
];
