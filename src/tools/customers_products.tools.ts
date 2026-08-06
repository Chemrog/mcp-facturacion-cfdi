import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";
import * as db from "../lib/db.js";
import { rfcRegex } from "../lib/validation.js";

async function ensureOrg(accountId: string): Promise<db.DbOrganization> {
  const org = await db.getOrganizationByAccount(accountId);
  if (!org) throw new Error("No hay organizacion configurada. Usa onboarding_start primero.");
  if (!org.facturapi_organization_id) throw new Error("Organizacion no sincronizada. Completa el onboarding.");
  return org;
}

export const customerTools: McpServerTool[] = [
  {
    name: "add_customer",
    description: `Registra un nuevo cliente en tu catalogo de facturacion.

DATOS REQUERIDOS:
- legal_name: Razon social o nombre fiscal SIN regimen societario (ej: "Juan Perez", no "Juan Perez SA de CV")
- tax_id: RFC del cliente (para extranjeros usar XEXX010101000)
- tax_system: Clave de regimen fiscal del cliente (3 digitos SAT)
- address: Domicilio fiscal (minimo zip + country)

NOTA: El SAT valida que el RFC y los datos fiscales del cliente existan. Si el RFC no existe, se rechazara.`,
    inputSchema: {
      account_id: z.string(),
      legal_name: z.string().min(1),
      tax_id: z.string().min(1).describe("RFC del cliente. Para extranjeros: XEXX010101000"),
      tax_system: z.string().length(3).describe("Clave regimen fiscal (3 digitos)"),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address_street: z.string().optional(),
      address_exterior: z.string().optional(),
      address_interior: z.string().optional(),
      address_neighborhood: z.string().optional(),
      address_city: z.string().optional(),
      address_municipality: z.string().optional(),
      address_zip: z.string(),
      address_state: z.string().optional(),
      address_country: z.string().default("MEX"),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);

        const customer = await facturapi.customers.create({
          legal_name: input.legal_name,
          tax_id: input.tax_id,
          tax_system: input.tax_system,
          email: input.email,
          phone: input.phone,
          address: {
            street: input.address_street,
            exterior: input.address_exterior,
            interior: input.address_interior,
            neighborhood: input.address_neighborhood,
            city: input.address_city,
            municipality: input.address_municipality,
            zip: input.address_zip,
            state: input.address_state,
            country: input.address_country,
          },
        }, "live") as Record<string, unknown>;

        await db.cacheCustomer(org.id, customer);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Cliente creado", customer }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Error" }, null, 2),
          }],
        };
      }
    },
  },
  {
    name: "list_customers",
    description: "Lista clientes registrados con busqueda por nombre o RFC y paginacion.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional().describe("Buscar por nombre o RFC"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const params: Record<string, string | number | boolean | undefined> = {
          page: input.page,
          limit: input.limit,
        };
        if (input.query) params.q = input.query;

        const result = await facturapi.customers.list(params) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_customer_details",
    description: "Obtiene los datos completos de un cliente por su ID.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const customer = await facturapi.customers.get(input.customer_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(customer, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "update_customer_info",
    description: "Actualiza los datos de un cliente existente. Solo envia los campos que necesitas cambiar.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
      legal_name: z.string().optional(),
      tax_system: z.string().length(3).optional(),
      email: z.string().email().optional().or(z.literal("")),
      phone: z.string().optional(),
      address_zip: z.string().optional(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const data: Record<string, unknown> = {};
        if (input.legal_name) data.legal_name = input.legal_name;
        if (input.tax_system) data.tax_system = input.tax_system;
        if (input.email !== undefined) data.email = input.email;
        if (input.phone !== undefined) data.phone = input.phone;
        if (input.address_zip) data.address = { zip: input.address_zip };

        const result = await facturapi.customers.update(input.customer_id, data) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, customer: result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "remove_customer",
    description: "Elimina un cliente del catalogo. Las facturas asociadas NO se eliminan.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.customers.delete(input.customer_id);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Cliente eliminado" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "validate_customer_rfc",
    description: "Valida que el RFC de un cliente este activo y sus datos fiscales coincidan con los registros del SAT.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const result = await facturapi.customers.validateTaxInfo(input.customer_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "send_customer_data_form",
    description: "Envia al cliente un enlace por correo para que complete sus datos fiscales. Valido por 7 dias.",
    inputSchema: {
      account_id: z.string(),
      customer_id: z.string(),
      email: z.string().email().optional(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const result = await facturapi.customers.sendEditLink(input.customer_id, input.email) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Enlace enviado al cliente", result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];

export const productTools: McpServerTool[] = [
  {
    name: "add_product",
    description: `Registra un producto o servicio en tu catalogo para usarlo en facturas.

CAMPOS CLAVE:
- description: Nombre/descripcion como aparecera en la factura
- product_key: Clave SAT de producto/servicio (usa find_sat_product_code para buscarla)
- price: Precio unitario
- unit_key: Clave de unidad SAT (default: 'H87' = pieza/elemento)
- tax_included: Si el precio ya incluye IVA (default: true)
- taxability: Codigo de objeto de impuesto (default: '02' = si es objeto)`,
    inputSchema: {
      account_id: z.string(),
      description: z.string().min(1),
      product_key: z.string().min(1).describe("Clave SAT del producto (buscala con find_sat_product_code)"),
      price: z.number().min(0),
      unit_key: z.string().default("H87"),
      unit_name: z.string().default("Elemento"),
      tax_included: z.boolean().default(true),
      taxability: z.enum(["01","02","03","04","05","06","07","08"]).default("02"),
      sku: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const org = await ensureOrg(input.account_id);
        const product = await facturapi.products.create({
          description: input.description,
          product_key: input.product_key,
          price: input.price,
          unit_key: input.unit_key,
          unit_name: input.unit_name,
          tax_included: input.tax_included,
          taxability: input.taxability,
          sku: input.sku,
        }, "live") as Record<string, unknown>;

        await db.cacheProduct(org.id, product);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, product }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "list_products",
    description: "Lista productos con busqueda por descripcion o SKU y paginacion.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
      sku: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const params: Record<string, string | number | boolean | undefined> = { page: input.page, limit: input.limit };
        if (input.query) params.q = input.query;
        if (input.sku) params.sku = input.sku;

        const result = await facturapi.products.list(params) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "get_product_details",
    description: "Obtiene los detalles completos de un producto.",
    inputSchema: {
      account_id: z.string(),
      product_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const product = await facturapi.products.get(input.product_id) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "update_product_info",
    description: "Actualiza un producto existente. Solo envia los campos a modificar.",
    inputSchema: {
      account_id: z.string(),
      product_id: z.string(),
      description: z.string().optional(),
      price: z.number().min(0).optional(),
      sku: z.string().optional(),
      tax_included: z.boolean().optional(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        const data: Record<string, unknown> = {};
        if (input.description) data.description = input.description;
        if (input.price !== undefined) data.price = input.price;
        if (input.sku !== undefined) data.sku = input.sku;
        if (input.tax_included !== undefined) data.tax_included = input.tax_included;

        const result = await facturapi.products.update(input.product_id, data) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ success: true, product: result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "remove_product",
    description: "Elimina un producto del catalogo. Las facturas asociadas NO se eliminan.",
    inputSchema: {
      account_id: z.string(),
      product_id: z.string(),
    },
    handler: async (input) => {
      try {
        await ensureOrg(input.account_id);
        await facturapi.products.delete(input.product_id);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Producto eliminado" }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];
