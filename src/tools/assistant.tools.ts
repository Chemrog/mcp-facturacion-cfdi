import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as db from "../lib/db.js";
import {
  suggestTaxRegime,
  suggestCfdiUsage,
  calculateTaxBreakdown,
  getAllPaymentForms,
  getAllCfdiUses,
  getAllTaxRegimes,
} from "../lib/catalogs.js";

export const assistantTools: McpServerTool[] = [
  {
    name: "suggest_tax_regime",
    description: `Sugiere el regimen fiscal del SAT apropiado segun el tipo de persona y actividad.
Los datos provienen del catalogo oficial c_RegimenFiscal del SAT.

TIPOS:
- persona_fisica: Persona con actividad empresarial, profesional, arrendamiento, plataformas, etc.
- persona_moral: Empresa, sociedad, asociacion, etc.

NOTA: 621 (Incorporacion Fiscal/RIF) ya NO existe desde 2022. RESICO (626) aplica tanto a fisicas como morales con limites de ingresos.`,
    inputSchema: {
      account_id: z.string().optional(),
      person_type: z.enum(["persona_fisica", "persona_moral"]).describe("Tipo de persona"),
      activity: z.string().optional().describe("Actividad especifica (opcional)"),
    },
    handler: async ({ person_type, activity }) => {
      try {
        const suggestions = await suggestTaxRegime(person_type, activity);
        const allRegimes = await getAllTaxRegimes();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              person_type,
              activity,
              suggestions,
              total_regimes: allRegimes.length,
              all_options: allRegimes,
              note: "Verifica con tu contador cual es el regimen correcto.",
            }, null, 2),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
      }
    },
  },
  {
    name: "suggest_cfdi_usage",
    description: `Sugiere la clave de Uso CFDI segun el tipo de operacion. Datos del catalogo oficial c_UsoCFDI del SAT.
Incluye todas las familias: G (generales), I (inversiones), D (deducciones personales), S, CP, CN.

Operaciones soportadas: venta, gasto, nomina, devolucion, exportacion, deduccion_personal, pago`,
    inputSchema: {
      account_id: z.string().optional(),
      operation: z.enum(["venta", "gasto", "nomina", "devolucion", "exportacion", "deduccion_personal", "pago"]).describe("Tipo de operacion"),
    },
    handler: async ({ operation }) => {
      try {
        const suggestions = await suggestCfdiUsage(operation);
        const allUses = await getAllCfdiUses();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ operation, suggestions, total_uses: allUses.length, all_options: allUses }, null, 2),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
      }
    },
  },
  {
    name: "suggest_payment_method",
    description: "Explica los metodos de pago: PUE (Pago en Una sola Exhibicion) vs PPD (Pago en Parcialidades o Diferido).",
    inputSchema: { account_id: z.string().optional() },
    handler: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        methods: [
          { code: "PUE", name: "Pago en Una sola Exhibicion", when: "El pago se recibe en un solo momento y por el total de la factura.", example: "Venta de contado, pago con tarjeta en tienda, transferencia unica." },
          { code: "PPD", name: "Pago en Parcialidades o Diferido", when: "El pago se recibe en varias exhibiciones o en una fecha posterior.", example: "Ventas a credito, pagos a plazos, suscripciones con cobro mensual.", important: "Requiere emitir un Complemento de Pago cuando se reciba el pago." },
        ],
      }, null, 2) }],
    }),
  },
  {
    name: "suggest_payment_type",
    description: `Muestra el catalogo de formas de pago del SAT (c_FormaPago oficial) con todas las claves vigentes.
Puedes filtrar por nombre o codigo.`,
    inputSchema: {
      account_id: z.string().optional(),
      query: z.string().optional().describe("Filtrar por nombre o codigo (ej: 'transferencia', 'efectivo', '28')"),
    },
    handler: async ({ query }) => {
      try {
        const forms = await getAllPaymentForms();
        const results = query
          ? forms.filter((f: any) => f.name.toLowerCase().includes(String(query).toLowerCase()) || f.code.includes(String(query)))
          : forms;
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
      }
    },
  },
  {
    name: "calculate_taxes",
    description: `Calcula el desglose de impuestos (subtotal, IVA, IEPS, total) para un monto dado.
Si tax_included=true, el monto YA incluye impuestos y se desglosan.
Si tax_included=false, los impuestos se suman al monto base.`,
    inputSchema: {
      account_id: z.string().optional(),
      amount: z.number().min(0),
      tax_included: z.boolean().default(true),
      iva_rate: z.number().min(0).max(1).default(0.16),
      ieps_rate: z.number().min(0).max(1).default(0),
    },
    handler: async ({ amount, tax_included, iva_rate, ieps_rate }) => {
      const breakdown = calculateTaxBreakdown(amount, tax_included, iva_rate, ieps_rate);
      return { content: [{ type: "text", text: JSON.stringify({
        input: { amount, tax_included, iva_rate, ieps_rate },
        breakdown,
        interpretation: tax_included
          ? `El monto de $${amount} YA incluye impuestos. Subtotal real: $${breakdown.subtotal}, IVA: $${breakdown.iva}`
          : `Subtotal: $${breakdown.subtotal} + IVA: $${breakdown.iva} = Total: $${breakdown.total}`,
      }, null, 2) }] };
    },
  },
  {
    name: "validate_invoice_before_stamping",
    description: `Revisa que los datos de una factura cumplan con los requisitos antes de enviarla al SAT.
Verifica: campos requeridos, RFC valido, claves SAT correctas, montos positivos.`,
    inputSchema: {
      account_id: z.string().optional(),
      type: z.enum(["I","E","P","N","T"]).default("I"),
      customer_rfc: z.string(),
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
      if (input.items_count > 5000) errors.push("Maximo 5,000 conceptos por factura.");
      if (input.payment_method === "PPD" && input.customer_rfc === "XAXX010101000") {
        warnings.push("PPD con publico en general requiere emitir complemento de pago.");
      }
      if (input.items_count > 100) warnings.push(`Factura con ${input.items_count} conceptos. Revisa limites.`);

      return { content: [{ type: "text", text: JSON.stringify({
        valid: errors.length === 0, errors, warnings,
        recommendation: errors.length === 0 ? "Datos basicos validos. Procede a crear la factura." : "Corrige los errores.",
      }, null, 2) }] };
    },
  },
  {
    name: "explain_tax_field",
    description: `Explica que significa un campo o clave fiscal del CFDI.
Reconoce tanto nombres en API (taxability, tax_system, payment_form, use) como en espanol.`,
    inputSchema: {
      account_id: z.string().optional(),
      field: z.string().describe("Campo a explicar (ej: 'taxability', 'regimen_fiscal', 'PUE', 'UUID', 'tax_system')"),
    },
    handler: async ({ field }) => {
      const f = String(field).toLowerCase().replace(/ /g, "_");
      const explanations: Record<string, string> = {
        taxability: "Codigo ObjetoImp en el CFDI. Indica si el bien/servicio es objeto de impuesto. Valores: 01=No objeto, 02=Si objeto, 03=Si objeto sin desglose, 04=Si objeto y no causa impuesto, 05=IVA credito PODEBI, 06=Si objeto sin IVA, 07=No traslado IVA pero con IEPS, 08=No traslado IVA sin IEPS.",
        tax_system: "Clave de 3 digitos del regimen fiscal SAT (ej: 612=PF Act. Empresarial, 601=PM General de Ley, 626=RESICO).",
        regimen_fiscal: "Clave de 3 digitos del regimen fiscal SAT (ej: 612=PF Act. Empresarial, 601=PM General de Ley, 626=RESICO).",
        uso_cfdi: "Uso que el receptor dara a la factura (G01=Adquisicion mercancias, G03=Gastos generales, D01=Honorarios medicos, I01=Construcciones).",
        use: "Uso CFDI que el receptor dara a la factura. Catalogo c_UsoCFDI del SAT.",
        payment_form: "Forma de pago (2 digitos). 01=Efectivo, 03=Transferencia, 04=Tarjeta credito, 28=Tarjeta debito, 99=Por definir.",
        forma_pago: "Forma de pago (2 digitos). 01=Efectivo, 03=Transferencia, 04=Tarjeta credito, 28=Tarjeta debito, 99=Por definir.",
        payment_method: "PUE = Pago en Una sola Exhibicion. PPD = Pago en Parcialidades o Diferido (a credito, requiere complemento de pago).",
        metodo_pago: "PUE = Pago en Una sola Exhibicion. PPD = Pago en Parcialidades o Diferido (a credito, requiere complemento de pago).",
        product_key: "Clave SAT del producto/servicio (8 digitos). Ej: 81111500=Desarrollo de software.",
        unit_key: "Clave SAT de unidad de medida. H87=Elemento/Pieza, KGM=Kilogramo, LTR=Litro, E48=Unidad de servicio.",
        uuid: "Identificador universal unico de 36 caracteres asignado por el SAT al timbrar. Es el folio fiscal del CFDI.",
        csd: "Certificado de Sello Digital. Archivos .cer y .key necesarios para timbrar facturas. Vigencia 4 anos.",
        efirma: "e.firma (antes FIEL). Firma electronica del SAT para tramites fiscales y firma de documentos.",
        carta_manifiesto: "Documento SAT donde autorizas a conectus.mx como proveedor de timbrado. Se firma con e.firma.",
        complemento_pago: "Complemento CFDI que registra pagos recibidos de facturas PPD. Relaciona pago con facturas.",
        invoice_type: "Tipos de CFDI: I=Ingreso (venta), E=Egreso (nota credito), P=Pago (complemento), N=Nomina, T=Traslado.",
        pue: "Pago en Una sola Exhibicion. El total se paga en un solo momento.",
        ppd: "Pago en Parcialidades o Diferido. Se paga en abonos. REQUIERE emitir Complemento de Pago.",
      };
      const explanation = explanations[f] ?? `"${field}" no encontrado. Campos: ${Object.keys(explanations).join(", ")}`;
      return { content: [{ type: "text", text: JSON.stringify({ field, explanation }, null, 2) }] };
    },
  },
  {
    name: "get_certificate_status",
    description: "Revisa la vigencia del CSD y alerta si esta por vencer o ya vencio.",
    inputSchema: { account_id: z.string() },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);
      if (!org) return { content: [{ type: "text", text: JSON.stringify({ error: "No hay organizacion configurada" }) }] };
      if (!org.csd_expires_at) return { content: [{ type: "text", text: JSON.stringify({ has_csd: org.setup_status.csd_uploaded, expiry: "No disponible", status: "unknown" }) }] };
      const daysRemaining = Math.ceil((new Date(org.csd_expires_at).getTime() - Date.now()) / 86400000);
      return { content: [{ type: "text", text: JSON.stringify({
        expires_at: org.csd_expires_at, days_remaining: daysRemaining,
        status: daysRemaining <= 0 ? "expired" : daysRemaining <= 30 ? "expiring_soon" : "valid",
        recommendation: daysRemaining <= 0 ? "RENOVAR INMEDIATAMENTE." : daysRemaining <= 30 ? `Renovar en ${daysRemaining} dias.` : "Todo en orden.",
      }) }] };
    },
  },
  {
    name: "get_fiscal_compliance_checklist",
    description: "Checklist completo de cumplimiento fiscal para facturar sin problemas.",
    inputSchema: { account_id: z.string().optional() },
    handler: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        checklist: [
          { id: 1, name: "RFC activo en el SAT", required: true },
          { id: 2, name: "e.firma (FIEL) vigente", required: true },
          { id: 3, name: "CSD vigente", required: true },
          { id: 4, name: "Domicilio fiscal actualizado", required: true },
          { id: 5, name: "Regimen fiscal correcto", required: true },
          { id: 6, name: "Carta Manifiesto firmada", required: true },
          { id: 7, name: "Suscripcion activa en conectus.mx", required: true },
        ],
        tips: ["Renueva e.firma y CSD 30 dias antes del vencimiento.", "Manten actualizados tus datos en el SAT.", "Revisa periodicamente tu buzon tributario."],
      }, null, 2) }],
    }),
  },
];
