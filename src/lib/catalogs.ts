import {
  TaxSystem,
  CfdiUse,
  PaymentForm,
  PaymentMethod,
  TaxabilityCode,
  InvoiceType,
} from "./types.js";

interface CatalogEntry {
  code: string;
  name: string;
  description: string;
}

function buildCatalog<T extends Record<string, string>>(obj: T): CatalogEntry[] {
  return Object.entries(obj).map(([name, code]) => ({
    code,
    name: name.replace(/_/g, " ").toLowerCase(),
    description: `${name.replace(/_/g, " ")} (${code})`,
  }));
}

export function getTaxSystems(): CatalogEntry[] {
  return buildCatalog(TaxSystem);
}

export function getCfdiUses(): CatalogEntry[] {
  return buildCatalog(CfdiUse);
}

export function getPaymentForms(): CatalogEntry[] {
  return buildCatalog(PaymentForm);
}

export function getPaymentMethods(): CatalogEntry[] {
  return buildCatalog(PaymentMethod);
}

export function getTaxabilityCodes(): CatalogEntry[] {
  return buildCatalog(TaxabilityCode);
}

export function getInvoiceTypes(): CatalogEntry[] {
  return buildCatalog(InvoiceType);
}

export function searchTaxSystem(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return getTaxSystems().filter(
    (e) => e.name.includes(q) || e.code.includes(q) || e.description.toLowerCase().includes(q)
  );
}

export function searchCfdiUse(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return getCfdiUses().filter(
    (e) => e.name.includes(q) || e.code.includes(q) || e.description.toLowerCase().includes(q)
  );
}

export function searchPaymentForm(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return getPaymentForms().filter(
    (e) => e.name.includes(q) || e.code.includes(q) || e.description.toLowerCase().includes(q)
  );
}

const TAX_SYSTEM_LABELS: Record<string, string> = {
  "601": "General de Ley Personas Morales",
  "603": "Personas Morales con Fines no Lucrativos",
  "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
  "606": "Arrendamiento",
  "608": "Demas ingresos",
  "609": "Consolidacion",
  "610": "Residentes en el Extranjero sin Establecimiento Permanente en Mexico",
  "611": "Ingresos por Dividendos (socios y accionistas)",
  "612": "Personas Fisicas con Actividades Empresariales y Profesionales",
  "621": "Incorporacion Fiscal",
  "622": "Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras",
  "625": "Regimen de las Plataformas Tecnologicas",
  "626": "Regimen Simplificado de Confianza",
};

const CFDI_USE_LABELS: Record<string, string> = {
  "G01": "Adquisicion de mercancias",
  "G02": "Devoluciones, descuentos o bonificaciones",
  "G03": "Gastos en general",
  "CP01": "Pagos",
  "CN01": "Nomina",
  "S01": "Sin efectos fiscales",
};

const TAX_REGIME_SUGGESTIONS: Record<string, string[]> = {
  persona_fisica: ["612", "621", "625", "626", "606"],
  persona_moral: ["601", "603", "610"],
  arrendamiento: ["606"],
  plataformas: ["625"],
  agricultura: ["622"],
  salarios: ["605"],
};

export function suggestTaxRegime(
  personType: "persona_fisica" | "persona_moral",
  activity?: string
): { code: string; name: string }[] {
  const codes = activity
    ? TAX_REGIME_SUGGESTIONS[activity] ?? TAX_REGIME_SUGGESTIONS[personType]
    : TAX_REGIME_SUGGESTIONS[personType];

  return codes.map((code) => ({
    code,
    name: TAX_SYSTEM_LABELS[code] ?? code,
  }));
}

export function suggestCfdiUsage(
  operation: "venta" | "gasto" | "nomina" | "devolucion" | "exportacion"
): { code: string; name: string }[] {
  const map: Record<string, string[]> = {
    venta: ["G01", "G03"],
    gasto: ["G01", "G03"],
    nomina: ["CN01"],
    devolucion: ["G02"],
    exportacion: ["G01"],
  };
  const codes = map[operation] ?? ["G01"];
  return codes.map((code) => ({
    code,
    name: CFDI_USE_LABELS[code] ?? code,
  }));
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
