import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";

export const onboardingTools: McpServerTool[] = [
  // ============================================================
  // 1. onboarding_start
  // ============================================================
  {
    name: "onboarding_start",
    description: `Inicia el proceso de alta fiscal en conectus.mx. 
Devuelve el checklist de configuracion y el estado actual de la organizacion.
Usa esta herramienta cuando un usuario quiera comenzar a facturar o verificar que pasos le faltan.

Pasos del checklist:
1. Datos fiscales completos (RFC, Razon Social, Regimen Fiscal, Codigo Postal)
2. Certificado CSD cargado (.cer, .key, contrasena)
3. e.firma/FIEL cargada (opcional pero requerida para firmar carta manifiesto)
4. Carta manifiesto firmada (requisito SAT)
5. Listo para timbrar en produccion`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
    },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);
      if (!org) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              exists: false,
              message: "No tienes una organizacion fiscal configurada. Usa onboarding_start para comenzar el proceso.",
              checklist: {
                fiscal_data_complete: false,
                csd_uploaded: false,
                fiel_uploaded: false,
                manifesto_signed: false,
                live_ready: false,
              },
            }, null, 2),
          }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            exists: true,
            organization_name: org.organization_name,
            rfc: org.rfc,
            facturapi_organization_id: org.facturapi_organization_id,
            checklist: {
              fiscal_data_complete: org.setup_status.fiscal_data_complete,
              csd_uploaded: org.setup_status.csd_uploaded,
              fiel_uploaded: !!org.fiel_cer_encrypted,
              manifesto_signed: org.setup_status.manifesto_signed,
              live_ready: org.setup_status.live_ready,
            },
            csd_expires_at: org.csd_expires_at,
            current_month_invoices: org.current_month_invoices,
            invoice_quota: org.invoice_quota,
          }, null, 2),
        }],
      };
    },
  },

  // ============================================================
  // 2. save_fiscal_data
  // ============================================================
  {
    name: "save_fiscal_data",
    description: `Guarda o actualiza los datos fiscales de la organizacion en conectus.mx.
    
DATOS REQUERIDOS:
- rfc: RFC con homoclave (ej: XAXX010101000)
- legal_name: Razon social o nombre fiscal completo SIN regimen societario (ej: "Juan Perez Lopez", no "Juan Perez Lopez SA de CV")
- tax_system: Clave del regimen fiscal del SAT (3 digitos). Usa 'suggest_tax_regime' si no sabes cual elegir.
- zip_code: Codigo postal del domicilio fiscal (5 digitos)

Si la organizacion no existe en conectus.mx, se creara una nueva. Si ya existe, se actualizaran los datos.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      organization_name: z.string().describe("Nombre descriptivo de la organizacion (ej: 'Mi Empresa SA', 'Freelance Juan Perez')"),
      rfc: z.string().describe("RFC con homoclave. Formato: 4 letras + 6 digitos + 3 caracteres"),
      legal_name: z.string().describe("Razon social / nombre fiscal completo"),
      tax_system: z.string().describe("Clave de regimen fiscal SAT (3 digitos, ej: '612' para Persona Fisica, '601' para Persona Moral)"),
      zip_code: z.string().describe("Codigo Postal del domicilio fiscal (5 digitos)"),
    },
    handler: async (input) => {
      try {
        let org = await db.getOrganizationByAccount(input.account_id);

        if (!org) {
          org = await db.createOrganization({
            account_id: input.account_id,
            organization_name: input.organization_name,
            rfc: input.rfc,
            legal_name: input.legal_name,
            tax_system: input.tax_system,
            zip_code: input.zip_code,
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Organizacion fiscal creada exitosamente en conectus.mx",
                organization_id: org.id,
                next_steps: [
                  "Subir certificado CSD con upload_tax_certificate",
                  "Subir e.firma con upload_digital_signature (necesario para carta manifiesto)",
                ],
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Datos fiscales actualizados correctamente",
              organization_id: org.id,
              next_steps: [
                org.setup_status.csd_uploaded ? "✅ CSD ya cargado" : "⬜ Subir CSD con upload_tax_certificate",
                org.fiel_cer_encrypted ? "✅ e.firma ya cargada" : "⬜ Subir e.firma con upload_digital_signature",
              ],
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error desconocido",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 3. upload_tax_certificate
  // ============================================================
  {
    name: "upload_tax_certificate",
    description: `Sube el Certificado de Sello Digital (CSD) de la organizacion a conectus.mx.

REQUISITOS:
- cer_base64: Archivo .cer del CSD codificado en base64
- key_base64: Archivo .key del CSD codificado en base64  
- password: Contrasena de la llave privada del CSD

El CSD es OBLIGATORIO para poder timbrar facturas. Sin CSD no se puede facturar en produccion.
Estos archivos se obtienen del SAT cuando tramitas tu e.firma/FIEL.
Los archivos se almacenan ENCRIPTADOS en nuestra base de datos.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      cer_base64: z.string().describe("Contenido del archivo .cer codificado en base64"),
      key_base64: z.string().describe("Contenido del archivo .key codificado en base64"),
      password: z.string().describe("Contrasena de la llave privada del CSD"),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada. Usa save_fiscal_data primero.");

        await db.saveCsdEncrypted(org.id, input.cer_base64, input.key_base64, input.password);

        // Si ya tenemos organizacion en FacturAPI, subir el CSD alli tambien
        if (org.facturapi_organization_id) {
          try {
            await facturapi.organizations.uploadCertificate(org.facturapi_organization_id, {
              cer: input.cer_base64,
              key: input.key_base64,
              password: input.password,
            });
            await db.updateOrganizationSetupStatus(org.id, { csd_uploaded: true });
          } catch (apiErr) {
            console.error("Failed to upload CSD to FacturAPI:", apiErr);
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Certificado CSD guardado exitosamente (encriptado)",
              csd_expires_at: (await db.getOrganizationById(org.id))?.csd_expires_at,
              next_step: "Si no has subido la e.firma, hazlo con upload_digital_signature",
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al subir CSD",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 4. upload_digital_signature
  // ============================================================
  {
    name: "upload_digital_signature",
    description: `Sube la e.firma (FIEL) de la organizacion a conectus.mx.

REQUISITOS:
- fiel_cer_base64: Archivo .cer de la e.firma codificado en base64
- fiel_key_base64: Archivo .key de la e.firma codificado en base64
- fiel_password: Contrasena de la llave privada de la e.firma

La e.firma es necesaria para firmar la Carta Manifiesto, un requisito del SAT para poder emitir facturas.
Sin la Carta Manifiesto firmada, NO se podra timbrar en produccion.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      fiel_cer_base64: z.string().describe("Contenido del archivo .cer de la e.firma codificado en base64"),
      fiel_key_base64: z.string().describe("Contenido del archivo .key de la e.firma codificado en base64"),
      fiel_password: z.string().describe("Contrasena de la llave privada de la e.firma"),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada. Usa save_fiscal_data primero.");

        await db.saveFielEncrypted(org.id, input.fiel_cer_base64, input.fiel_key_base64, input.fiel_password);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "e.firma (FIEL) guardada exitosamente (encriptada)",
              next_step: "La e.firma se usara para firmar la Carta Manifiesto cuando sea necesario.",
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al subir e.firma",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 5. get_onboarding_status
  // ============================================================
  {
    name: "get_onboarding_status",
    description: `Revisa el estado completo de configuracion fiscal de la organizacion.
Devuelve un checklist detallado de que esta listo y que falta para poder facturar en produccion.`,
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
    },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);

      if (!org) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "not_started",
              message: "No has iniciado el proceso de configuracion fiscal",
              steps: [
                { step: 1, name: "Registrar datos fiscales", done: false, action: "Usa save_fiscal_data" },
                { step: 2, name: "Subir certificado CSD", done: false, action: "Usa upload_tax_certificate" },
                { step: 3, name: "Subir e.firma (FIEL)", done: false, action: "Usa upload_digital_signature" },
                { step: 4, name: "Firmar carta manifiesto", done: false },
                { step: 5, name: "Listo para timbrar", done: false },
              ],
            }, null, 2),
          }],
        };
      }

      const steps = [
        { step: 1, name: "Datos fiscales completos", done: org.setup_status.fiscal_data_complete },
        { step: 2, name: "CSD cargado", done: org.setup_status.csd_uploaded },
        { step: 3, name: "e.firma cargada", done: !!org.fiel_cer_encrypted },
        { step: 4, name: "Carta manifiesto firmada", done: org.setup_status.manifesto_signed },
        { step: 5, name: "Listo para timbrar en produccion", done: org.setup_status.live_ready },
      ];

      const allDone = steps.every((s) => s.done);
      const canInvoiceTest = org.setup_status.fiscal_data_complete && org.setup_status.csd_uploaded;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: allDone ? "ready" : "in_progress",
            organization_name: org.organization_name,
            rfc: org.rfc,
            can_test_invoice: canInvoiceTest,
            can_live_invoice: allDone,
            csd_expires_at: org.csd_expires_at,
            csd_days_remaining: org.csd_expires_at
              ? Math.ceil((new Date(org.csd_expires_at).getTime() - Date.now()) / 86400000)
              : null,
            steps,
          }, null, 2),
        }],
      };
    },
  },

  // ============================================================
  // 6. get_fiscal_profile
  // ============================================================
  {
    name: "get_fiscal_profile",
    description: "Muestra el perfil fiscal completo de la organizacion: RFC, razon social, regimen, direccion fiscal y configuracion de facturacion.",
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
    },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);
      if (!org) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "No hay organizacion configurada" }) }],
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            organization_name: org.organization_name,
            rfc: org.rfc,
            legal_name: org.legal_name,
            tax_system: org.tax_system,
            zip_code: org.zip_code,
            logo_url: org.logo_url,
            pdf_customization: org.pdf_customization,
            autofactura_enabled: org.autofactura_enabled,
            receipts_enabled: org.receipts_enabled,
            default_series: org.default_series,
            monthly_invoice_quota: org.invoice_quota,
            used_this_month: org.current_month_invoices,
          }, null, 2),
        }],
      };
    },
  },

  // ============================================================
  // 7. update_fiscal_data
  // ============================================================
  {
    name: "update_fiscal_data",
    description: "Actualiza datos fiscales especificos de la organizacion. Solo envia los campos que necesitas cambiar.",
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      tax_system: z.string().optional().describe("Nuevo regimen fiscal (3 digitos)"),
      zip_code: z.string().optional().describe("Nuevo codigo postal fiscal"),
      legal_name: z.string().optional().describe("Nueva razon social"),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org) throw new Error("No hay organizacion configurada");

        if (org.facturapi_organization_id && (input.tax_system || input.zip_code || input.legal_name)) {
          await facturapi.organizations.updateFiscalData(org.facturapi_organization_id, {
            tax_system: input.tax_system ?? org.tax_system,
            zip: input.zip_code ?? org.zip_code,
            legal_name: input.legal_name ?? org.legal_name,
          });
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Datos fiscales actualizados" }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al actualizar",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 8. update_company_logo
  // ============================================================
  {
    name: "update_company_logo",
    description: "Actualiza el logotipo que aparece en los PDFs de las facturas.",
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      logo_url: z.string().optional().describe("URL publica del logotipo"),
      logo_base64: z.string().optional().describe("Logotipo en base64 (PNG o JPG)"),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org || !org.facturapi_organization_id) throw new Error("Organizacion no configurada en FacturAPI");

        const logoPayload = input.logo_base64
          ? { base64: input.logo_base64 }
          : input.logo_url
            ? { url: input.logo_url }
            : null;

        if (!logoPayload) throw new Error("Debes proporcionar logo_url o logo_base64");

        await facturapi.organizations.uploadLogo(org.facturapi_organization_id, logoPayload);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Logotipo actualizado correctamente" }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al subir logotipo",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 9. customize_invoice_pdf
  // ============================================================
  {
    name: "customize_invoice_pdf",
    description: "Configura la apariencia de los PDFs de facturas: colores, campos visibles, etc.",
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
      primary_color: z.string().optional().describe("Color principal en hex (ej: '#1a56db')"),
      secondary_color: z.string().optional().describe("Color secundario en hex"),
      show_quantity: z.boolean().optional(),
      show_unit_price: z.boolean().optional(),
      show_discount: z.boolean().optional(),
      show_tax: z.boolean().optional(),
    },
    handler: async (input) => {
      try {
        const org = await db.getOrganizationByAccount(input.account_id);
        if (!org || !org.facturapi_organization_id) throw new Error("Organizacion no configurada");

        const customization: Record<string, unknown> = {};
        if (input.primary_color) customization.primary_color = input.primary_color;
        if (input.secondary_color) customization.secondary_color = input.secondary_color;
        if (input.show_quantity !== undefined) customization.show_quantity = input.show_quantity;
        if (input.show_unit_price !== undefined) customization.show_unit_price = input.show_unit_price;
        if (input.show_discount !== undefined) customization.show_discount = input.show_discount;
        if (input.show_tax !== undefined) customization.show_tax = input.show_tax;

        await facturapi.organizations.updateCustomization(org.facturapi_organization_id, customization);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Personalizacion de PDF actualizada" }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : "Error al personalizar PDF",
            }, null, 2),
          }],
        };
      }
    },
  },

  // ============================================================
  // 10. check_certificate_expiry
  // ============================================================
  {
    name: "check_certificate_expiry",
    description: "Verifica la vigencia del CSD. Alerta si faltan menos de 30 dias para que venza.",
    inputSchema: {
      account_id: z.string().describe("ID de la cuenta en conectus.mx"),
    },
    handler: async ({ account_id }) => {
      const org = await db.getOrganizationByAccount(account_id);
      if (!org) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "No hay organizacion configurada" }) }],
        };
      }

      if (!org.csd_expires_at) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "unknown",
              message: "No se pudo determinar la fecha de vencimiento del CSD",
              has_csd: org.setup_status.csd_uploaded,
            }, null, 2),
          }],
        };
      }

      const expiryDate = new Date(org.csd_expires_at);
      const daysRemaining = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
      const isExpiring = daysRemaining <= 30;
      const isExpired = daysRemaining <= 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: isExpired ? "expired" : isExpiring ? "expiring_soon" : "valid",
            expires_at: org.csd_expires_at,
            days_remaining: daysRemaining,
            needs_renewal: isExpiring || isExpired,
            alert: isExpired
              ? "⚠️ TU CSD YA VENCIO. Debes renovarlo inmediatamente para seguir facturando."
              : isExpiring
                ? `⚠️ Tu CSD vence en ${daysRemaining} dias. Renuevalo cuanto antes para no interrumpir tu facturacion.`
                : `Tu CSD vence en ${daysRemaining} dias. Todo en orden.`,
          }, null, 2),
        }],
      };
    },
  },
];
