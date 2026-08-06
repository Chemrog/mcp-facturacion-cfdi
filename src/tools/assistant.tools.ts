import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as db from "../lib/db.js";
import {
  suggestTaxRegime,
  suggestCfdiUsage,
  calculateTaxBreakdown,
  getPaymentForms,
  getCfdiUses,
  getTaxSystems,
} from "../lib/catalogs.js";

export const assistantTools: McpServerTool[] = [
  {
    name: "suggest_tax_regime",
    description: `Sugiere el regimen fiscal del SAT apropiado segun el tipo de persona y actividad.

TIPOS:
- persona_fisica: Persona con actividad empresarial, profesional, arrendamiento, plataformas, etc.
- persona_moral: Empresa, sociedad, asociacion, etc.

Actividades opcionales: 'arrendamiento', 'plataformas', 'agricultura', 'salarios'`,
    inputSchema: {
      account_id: z.string().optional(),
      person_type: z.enum(["persona_fisica", "persona_moral"]).describe("Tipo de persona"),
      activity: z.string().optional().describe("Actividad especifica (opcional)"),
    },
    handler: async ({ person_type, activity }) => {
      const suggestions = suggestTaxRegime(person_type, activity);
      const allRegimes = getTaxSystems();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            person_type,
            activity,
            suggestions,
            all_options: allRegimes,
            note: "Verifica con tu contador cual es el regimen correcto para tu situacion fiscal.",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "suggest_cfdi_usage",
    description: "Sugiere la clave de Uso CFDI apropiada segun el tipo de operacion (venta, gasto, nomina, devolucion).",
    inputSchema: {
      account_id: z.string().optional(),
      operation: z.enum(["venta", "gasto", "nomina", "devolucion", "exportacion"]).describe("Tipo de operacion"),
    },
    handler: async ({ operation }) => {
      const suggestions = suggestCfdiUsage(operation);
      const allUses = getCfdiUses();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            operation,
            suggestions,
            all_options: allUses,
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "suggest_payment_method",
    description: "Explica los metodos de pago: PUE (Pago en Una sola Exhibicion) vs PPD (Pago en Parcialidades o Diferido).",
    inputSchema: {
      account_id: z.string().optional(),
    },
    handler: async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            methods: [
              {
                code: "PUE",
                name: "Pago en Una sola Exhibicion",
                when: "El pago se recibe en un solo momento y por el total de la factura.",
                example: "Venta de contado, pago con tarjeta en tienda, transferencia unica.",
              },
              {
                code: "PPD",
                name: "Pago en Parcialidades o Diferido",
                when: "El pago se recibe en varias exhibiciones o en una fecha posterior a la emision.",
                example: "Ventas a credito, pagos a plazos, suscripciones con cobro mensual.",
                important: "Requiere emitir un Complemento de Pago cuando se reciba el pago.",
              },
            ],
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "suggest_payment_type",
    description: "Muestra el catalogo completo de formas de pago del SAT con sus claves.",
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().optional().describe("Filtrar por nombre (ej: 'transferencia', 'efectivo')"),
    },
    handler: async ({ query }) => {
      const allForms = getPaymentForms();
      const results = query
        ? allForms.filter((f) => f.name.includes(query.toLowerCase()) || f.code.includes(query))
        : allForms;

      return {
        content: [{
          type: "text",
          text: JSON.stringify(results, null, 2),
        }],
      };
    },
  },
  {
    name: "calculate_taxes",
    description: `Calcula el desglose de impuestos (subtotal, IVA, IEPS, total) para un monto dado.

- Si tax_included=true, el monto YA incluye impuestos y se desglosan.
- Si tax_included=false, los impuestos se suman al monto base.`,
    inputSchema: {
      account_id: z.string().optional(),
      amount: z.number().min(0).describe("Monto base o total"),
      tax_included: z.boolean().default(true).describe("Si el monto ya incluye impuestos"),
      iva_rate: z.number().min(0).max(1).default(0.16).describe("Tasa de IVA (default: 0.16 = 16%)"),
      ieps_rate: z.number().min(0).max(1).default(0).describe("Tasa de IEPS (default: 0)"),
    },
    handler: async ({ amount, tax_included, iva_rate, ieps_rate }) => {
      const breakdown = calculateTaxBreakdown(amount, tax_included, iva_rate, ieps_rate);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            input: { amount, tax_included, iva_rate, ieps_rate },
            breakdown: {
              subtotal: breakdown.subtotal,
              iva: breakdown.iva,
              ieps: breakdown.ieps,
              total: breakdown.total,
            },
            interpretation: tax_included
              ? `El monto de $${amount} YA incluye impuestos. Subtotal real: $${breakdown.subtotal}, IVA: $${breakdown.iva}`
              : `Subtotal: $${breakdown.subtotal} + IVA: $${breakdown.iva} = Total: $${breakdown.total}`,
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "validate_invoice_before_stamping",
    description: `Revisa que los datos de una factura cumplan con los requisitos antes de enviarla al SAT.
Verifica: campos requeridos, RFC valido del receptor, claves SAT correctas, montos positivos, etc.`,
    inputSchema: {
      account_id: z.string().optional(),
      type: z.enum(["I","E","P","N","T"]).default("I"),
      customer_rfc: z.string().describe("RFC del receptor"),
      customer_name: z.string(),
      customer_zip: z.string(),
      items_count: z.number().int().min(1).max(5000),
      payment_form: z.string().length(2),
      payment_method: z.enum(["PUE","PPD"]).default("PUE"),
    },
    handler: async (input) => {
      const warnings: string[] = [];
      const errors: string[] = [];

      if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(input.customer_rfc)) {
        errors.push("RFC del receptor no tiene formato valido (XXXX000000XXX)");
      }

      if (input.items_count > 5000) {
        errors.push("Maximo 5,000 conceptos por factura. Divide en varias facturas.");
      }

      if (input.payment_method === "PPD" && input.customer_rfc === "XAXX010101000") {
        warnings.push("PPD con publico en general (XAXX010101000) requiere emitir complemento de pago despues.");
      }

      if (input.items_count > 100) {
        warnings.push(`Factura con ${input.items_count} conceptos. Revisa que ninguno exceda caracteres permitidos.`);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            valid: errors.length === 0,
            errors,
            warnings,
            recommendation: errors.length === 0
              ? "Los datos basicos son validos. Procede a crear la factura."
              : "Corrige los errores antes de crear la factura.",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "explain_tax_field",
    description: "Explica que significa un campo o clave fiscal del CFDI. Util cuando el usuario pregunta sobre terminos fiscales.",
    inputSchema: {
      account_id: z.string().optional(),
      field: z.string().describe("Campo o clave a explicar (ej: 'regimen_fiscal', 'uso_cfdi', 'forma_pago', 'PUE', 'PPD', 'UUID')"),
    },
    handler: async ({ field }) => {
      const explanations: Record<string, string> = {
        regimen_fiscal: "Clave de 3 digitos del SAT que identifica el regimen fiscal del contribuyente (ej: 612=Persona Fisica con Act. Empresarial, 601=General de Ley Personas Morales).",
        uso_cfdi: "Clave que indica el proposito de la factura para el receptor (ej: G01=Adquisicion de mercancias, G03=Gastos en general, P01=Por definir).",
        forma_pago: "Clave de 2 digitos que indica como se realizo el pago (01=Efectivo, 03=Transferencia, 04=Tarjeta de credito, 99=Por definir).",
        metodo_pago: "PUE = Pago en Una sola Exhibicion (se paga todo de una vez). PPD = Pago en Parcialidades o Diferido (a credito o en abonos).",
        PUE: "Pago en Una sola Exhibicion. El total de la factura se paga en un solo momento.",
        PPD: "Pago en Parcialidades o Diferido. Se paga en abonos o en fecha posterior. REQUIERE emitir Complemento de Pago al recibir el pago.",
        UUID: "Identificador universal unico (UUID) asignado por el SAT a cada CFDI timbrado. Es el 'folio fiscal' de 36 caracteres que prueba que la factura es valida.",
        CSD: "Certificado de Sello Digital. Archivos .cer y .key emitidos por el SAT necesarios para timbrar facturas. Vence cada 4 años.",
        efirma: "e.firma (antes FIEL). Firma electronica avanzada del SAT. Ademas de facturar, sirve para tramites fiscales, firma de documentos y acceso al portal del SAT.",
        carta_manifiesto: "Documento requerido por el SAT donde el contribuyente manifiesta que usara un PAC (como conectus.mx) para timbrar sus facturas. Se firma con la e.firma.",
        complemento_pago: "Complemento del CFDI que se emite para registrar los pagos recibidos de facturas PPD. Relaciona el pago con las facturas que cubre.",
        invoice_type: "Tipos: I=Ingreso (venta normal), E=Egreso (nota de credito), P=Pago (complemento de pago), N=Nomina, T=Traslado de mercancias.",
      };

      const explanation = explanations[field.toLowerCase()] ?? `No se encontro explicacion para "${field}". Los campos comunes son: regimen_fiscal, uso_cfdi, forma_pago, metodo_pago, PUE, PPD, UUID, CSD, efirma, carta_manifiesto, complemento_pago, invoice_type.`;

      return { content: [{ type: "text", text: JSON.stringify({ field, explanation }, null, 2) }] };
    },
  },
  {
    name: "get_certificate_status",
    description: "Revisa la vigencia del CSD y alerta si esta por vencer o ya vencio.",
    inputSchema: {
      account_id: z.string(),
    },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);
      if (!org) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No hay organizacion configurada" }) }] };
      }

      if (!org.csd_expires_at) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              has_csd: org.setup_status.csd_uploaded,
              expiry: "No disponible",
              status: "unknown",
            }, null, 2),
          }],
        };
      }

      const daysRemaining = Math.ceil((new Date(org.csd_expires_at).getTime() - Date.now()) / 86400000);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            expires_at: org.csd_expires_at,
            days_remaining: daysRemaining,
            status: daysRemaining <= 0 ? "expired" : daysRemaining <= 30 ? "expiring_soon" : "valid",
            recommendation: daysRemaining <= 0
              ? "RENOVAR INMEDIATAMENTE. No podras facturar hasta renovar tu CSD."
              : daysRemaining <= 30
                ? `Renovar en los proximos ${daysRemaining} dias para no interrumpir facturacion.`
                : "Todo en orden.",
          }, null, 2),
        }],
      };
    },
  },
  {
    name: "get_fiscal_compliance_checklist",
    description: "Checklist completo de cumplimiento fiscal: que necesitas tener para facturar sin problemas.",
    inputSchema: {
      account_id: z.string().optional(),
    },
    handler: async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            checklist: [
              {
                id: 1,
                name: "RFC activo en el SAT",
                description: "Tu RFC debe estar dado de alta y sin irregularidades. Verifica en el portal del SAT.",
                required: true,
              },
              {
                id: 2,
                name: "e.firma (FIEL) vigente",
                description: "Archivos .cer y .key de tu firma electronica. Se tramita en el SAT, vigencia 4 años.",
                required: true,
              },
              {
                id: 3,
                name: "CSD vigente",
                description: "Certificado de Sello Digital. Se obtiene con la e.firma. Necesario para timbrar.",
                required: true,
              },
              {
                id: 4,
                name: "Domicilio fiscal actualizado",
                description: "Tu direccion fiscal en el SAT debe estar correcta. Afecta la emision de CFDI.",
                required: true,
              },
              {
                id: 5,
                name: "Regimen fiscal correcto",
                description: "Verifica que tu regimen fiscal corresponda a tu actividad economica real.",
                required: true,
              },
              {
                id: 6,
                name: "Carta Manifiesto firmada",
                description: "Documento donde autorizas a conectus.mx como tu proveedor de timbrado. Se firma con e.firma.",
                required: true,
              },
              {
                id: 7,
                name: "Suscripcion activa en conectus.mx",
                description: "Plan de facturacion vigente para emitir CFDI ilimitados o con el plan contratado.",
                required: true,
              },
            ],
            tips: [
              "Renueva tu e.firma y CSD al menos 30 dias antes de que venzan.",
              "Manten actualizados tus datos fiscales en el SAT.",
              "Verifica periodicamente tu buzon tributario del SAT.",
            ],
          }, null, 2),
        }],
      };
    },
  },
];
