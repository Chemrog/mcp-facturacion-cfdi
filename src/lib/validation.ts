import { z } from "zod";

export const rfcRegex = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/;
export const taxIdExtRegex = /^[A-Z0-9]{5,20}$/;

export const rfcSchema = z.string().regex(rfcRegex, "RFC invalido. Formato: XXXX000000XXX");

export const addressSchema = z.object({
  street: z.string().min(1, "Calle requerida"),
  exterior: z.string().optional(),
  interior: z.string().optional(),
  neighborhood: z.string().optional(),
  city: z.string().optional(),
  municipality: z.string().optional(),
  zip: z.string().min(1, "Codigo Postal requerido"),
  state: z.string().optional(),
  country: z.string().min(1, "Pais requerido"),
});

export const customerSchema = z.object({
  legal_name: z.string().min(1, "Razon Social requerida"),
  tax_id: z.string().min(1, "RFC requerido"),
  tax_system: z.string().length(3, "Regimen Fiscal requiere 3 digitos"),
  address: addressSchema,
  email: z.string().email("Email invalido").optional(),
  phone: z.string().optional(),
  default_invoice_use: z.string().optional(),
});

export const productSchema = z.object({
  description: z.string().min(1, "Descripcion requerida"),
  product_key: z.string().min(1, "Clave de producto/servicio requerida"),
  price: z.number().min(0, "Precio debe ser >= 0"),
  unit_key: z.string().default("H87"),
  unit_name: z.string().default("Elemento"),
  tax_included: z.boolean().default(true),
  taxability: z.enum(["01","02","03","04","05","06","07","08"]).default("02"),
  taxes: z.array(z.object({
    type: z.enum(["IVA","IEPS","ISR"]),
    rate: z.number().min(0).max(1),
    withholding: z.boolean().optional(),
  })).optional(),
  sku: z.string().optional(),
});

export const lineItemSchema = z.object({
  quantity: z.number().min(1, "Cantidad debe ser >= 1"),
  discount: z.number().min(0).default(0),
  product: z.union([
    z.object({ id: z.string() }),
    productSchema,
  ]),
});

export const invoiceSchema = z.object({
  type: z.enum(["I","E","P","N","T"]).default("I"),
  customer: z.union([
    z.object({ id: z.string() }),
    customerSchema,
  ]),
  items: z.array(lineItemSchema).min(1, "Minimo 1 concepto"),
  payment_form: z.string().length(2, "Forma de pago requiere 2 digitos"),
  payment_method: z.enum(["PUE","PPD"]).default("PUE"),
  use: z.string().default("G01"),
  currency: z.string().default("MXN"),
  exchange: z.number().min(0).default(1),
  conditions: z.string().optional(),
  status: z.enum(["draft","pending"]).optional(),
  date: z.string().optional(),
  external_id: z.string().optional(),
  folio_number: z.number().int().optional(),
  series: z.string().max(25).optional(),
});

export const receiptSchema = z.object({
  customer: z.object({ id: z.string() }).optional(),
  items: z.array(lineItemSchema).min(1),
  payment_form: z.string().length(2),
  date: z.string().optional(),
  currency: z.string().default("MXN"),
  exchange: z.number().min(0).default(1),
  external_id: z.string().optional(),
});

export function validateRfcString(rfc: string): { valid: boolean; message?: string } {
  if (!rfcRegex.test(rfc)) {
    return { valid: false, message: "Formato RFC invalido. Debe ser XXXX000000XXX" };
  }
  return { valid: true };
}

export function validatePrice(price: unknown): { valid: boolean; message?: string } {
  if (typeof price !== "number" || isNaN(price) || price < 0) {
    return { valid: false, message: "El precio debe ser un numero positivo" };
  }
  return { valid: true };
}
