import { getPool } from "./db.js";

interface CatalogEntry {
  code: string;
  name: string;
  description?: string;
  extra?: Record<string, unknown>;
}

export async function searchTaxRegimes(query: string): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name FROM sat_tax_regimes 
     WHERE active = true AND (code ILIKE $1 OR name ILIKE $1 OR name % $2)
     ORDER BY code LIMIT 20`,
    [`%${query}%`, query]
  );
  return rows;
}

export async function getAllTaxRegimes(): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name, applies_to_fisica, applies_to_moral FROM sat_tax_regimes WHERE active = true ORDER BY code`
  );
  return rows;
}

export async function suggestTaxRegime(
  personType: "persona_fisica" | "persona_moral",
  activity?: string
): Promise<{ code: string; name: string }[]> {
  const col = personType === "persona_fisica" ? "applies_to_fisica" : "applies_to_moral";
  const { rows } = await getPool().query(
    `SELECT code, name FROM sat_tax_regimes 
     WHERE active = true AND ${col} = true 
     ORDER BY code LIMIT 10`
  );
  return rows;
}

export async function searchCfdiUses(query: string): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name, receiver_type FROM sat_cfdi_uses 
     WHERE code ILIKE $1 OR name ILIKE $1
     ORDER BY code LIMIT 20`,
    [`%${query}%`]
  );
  return rows;
}

export async function getAllCfdiUses(): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(`SELECT code, name, receiver_type FROM sat_cfdi_uses ORDER BY code`);
  return rows;
}

export async function suggestCfdiUsage(
  operation: "venta" | "gasto" | "nomina" | "devolucion" | "exportacion" | "deduccion_personal" | "pago"
): Promise<{ code: string; name: string }[]> {
  const map: Record<string, string> = {
    venta: "general",
    gasto: "general",
    exportacion: "general",
    devolucion: "general",
    nomina: "nomina",
    pago: "complemento_pago",
    deduccion_personal: "deduccion_personal",
  };
  const type = map[operation] || "general";
  const { rows } = await getPool().query(
    `SELECT code, name FROM sat_cfdi_uses WHERE receiver_type = $1 OR receiver_type = 'general' ORDER BY code LIMIT 20`,
    [type]
  );
  return rows;
}

export async function searchPaymentForms(query: string): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name FROM sat_payment_forms 
     WHERE active = true AND (code ILIKE $1 OR name ILIKE $1)
     ORDER BY code LIMIT 30`,
    [`%${query}%`]
  );
  return rows;
}

export async function getAllPaymentForms(): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name FROM sat_payment_forms WHERE active = true ORDER BY code`
  );
  return rows;
}

export async function searchProductKeys(query: string): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name, category FROM sat_product_keys 
     WHERE keywords ILIKE $1 OR name ILIKE $1 OR code ILIKE $1
     ORDER BY code LIMIT 30`,
    [`%${query.toLowerCase()}%`]
  );
  return rows;
}

export async function searchUnitKeys(query: string): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(
    `SELECT code, name, description FROM sat_unit_keys 
     WHERE code ILIKE $1 OR name ILIKE $1 OR description ILIKE $1
     ORDER BY code LIMIT 30`,
    [`%${query}%`]
  );
  return rows;
}

export async function getAllUnitKeys(): Promise<CatalogEntry[]> {
  const { rows } = await getPool().query(`SELECT code, name, description FROM sat_unit_keys ORDER BY code`);
  return rows;
}

export function calculateIva(subtotal: number, rate: number = 0.16): number {
  return Math.round(subtotal * rate * 100) / 100;
}

export function calculateTaxBreakdown(
  amount: number,
  taxIncluded: boolean,
  ivaRate: number = 0.16,
  iepsRate: number = 0
): {
  subtotal: number;
  iva: number;
  ieps: number;
  total: number;
} {
  let subtotal: number;
  if (taxIncluded) {
    const divisor = 1 + ivaRate + iepsRate;
    subtotal = Math.round((amount / divisor) * 100) / 100;
  } else {
    subtotal = amount;
  }
  const ieps = Math.round(subtotal * iepsRate * 100) / 100;
  const baseIva = iepsRate > 0 ? subtotal + ieps : subtotal;
  const iva = Math.round(baseIva * ivaRate * 100) / 100;
  const total = Math.round((subtotal + iva + ieps) * 100) / 100;

  return { subtotal, iva, ieps, total };
}
