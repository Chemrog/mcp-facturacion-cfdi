// ============================================================
// Tipos de datos para el MCP de Facturacion CFDI - conectus.mx
// ============================================================

import type { z } from "zod";

export interface McpServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (input: any) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

// --- Enums de catalogos SAT ---

export const TaxSystem = {
  GENERAL_LEY_PERSONAS_MORALES: "601",
  PERSONAS_MORALES_FINES_NO_LUCRATIVOS: "603",
  SUELDOS_Y_SALARIOS: "605",
  ARRENDAMIENTO: "606",
  DEMAS_INGRESOS: "608",
  CONSOLIDACION: "609",
  RESIDENTES_EXTRAJERO: "610",
  ACTIVIDADES_AGRICOLAS: "611",
  PERSONAS_FISICAS_ACTIVIDADES_EMPRESARIALES: "612",
  INCORPORACION_FISCAL: "621",
  ACTIVIDADES_PRIMARIAS: "622",
  PLATAFORMAS_TECNOLOGICAS: "625",
  SIMPLIFICADO_CONFIANZA: "626",
} as const;

export type TaxSystemCode = (typeof TaxSystem)[keyof typeof TaxSystem];

export const CfdiUse = {
  ADQUISICION_MERCANCIAS: "G01",
  DEVOLUCIONES_DESCUENTOS: "G02",
  GASTOS_GENERALES: "G03",
  CONSTRUCCIONES: "G04",
  MOBILIARIO_OFICINA: "G05",
  EQUIPO_TRANSPORTE: "G06",
  EQUIPO_COMPUTO: "G07",
  INVERSIONES: "G08",
  PAGO_POR_CUENTA_TERCEROS: "G09",
  DONATIVOS: "G10",
  IMPORTACIONES: "G11",
  SIN_EFECTOS_FISCALES: "S01",
  SERVICIOS_PERSONALES: "CP01",
  PAGOS_REPATRIACION: "CN01",
} as const;

export type CfdiUseCode = (typeof CfdiUse)[keyof typeof CfdiUse];

export const PaymentForm = {
  EFECTIVO: "01",
  CHEQUE_NOMINATIVO: "02",
  TRANSFERENCIA_ELECTRONICA: "03",
  TARJETA_CREDITO: "04",
  MONEDERO_ELECTRONICO: "05",
  DINERO_ELECTRONICO: "06",
  VALES_DESPENSA: "08",
  DACION_PAGO: "12",
  SUBROGACION: "13",
  CONSIGNACION: "14",
  CONDONACION: "15",
  COMPENSACION: "17",
  NOVACION: "23",
  CONFUSION: "24",
  REMISION_DEUDA: "25",
  PRESCRIPCION_CADUCIDAD: "26",
  SATISFACCION_PRENDA: "27",
  OTORGAMIENTO_PRENDA: "28",
  OTORGAMIENTO_HIPOTECA: "29",
  PAGO_POR_CUENTA_TERCEROS: "99",
} as const;

export type PaymentFormCode = (typeof PaymentForm)[keyof typeof PaymentForm];

export const PaymentMethod = {
  PUE: "PUE",
  PPD: "PPD",
} as const;

export type PaymentMethodCode = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const InvoiceType = {
  INGRESO: "I",
  EGRESO: "E",
  PAGO: "P",
  NOMINA: "N",
  TRASLADO: "T",
} as const;

export type InvoiceTypeCode = (typeof InvoiceType)[keyof typeof InvoiceType];

export const InvoiceStatus = {
  DRAFT: "draft",
  PENDING: "pending",
  VALID: "valid",
  CANCELLED: "cancelled",
} as const;

export type InvoiceStatusCode = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const TaxabilityCode = {
  NO_OBJETO: "01",
  SI_OBJETO: "02",
  SI_OBJETO_NO_DESGLOSE: "03",
  SI_OBJETO_NO_CAUSA: "04",
  SI_OBJETO_IVA_PODEBI: "05",
  SI_OBJETO_NO_IVA: "06",
  NO_IVA_DESGLOSE_IEPS: "07",
  NO_IVA_SIN_IEPS: "08",
} as const;

export type TaxabilityCodeType = (typeof TaxabilityCode)[keyof typeof TaxabilityCode];

// --- Tipos de datos principales ---

export interface Address {
  street: string;
  exterior?: string;
  interior?: string;
  neighborhood?: string;
  city?: string;
  municipality?: string;
  zip: string;
  state?: string;
  country: string;
}

export interface Tax {
  type: "IVA" | "IEPS" | "ISR";
  rate: number;
  withholding?: boolean;
}

export interface LocalTax {
  type: string;
  rate: number;
}

export interface CustomerData {
  legal_name: string;
  tax_id: string;
  tax_system: TaxSystemCode;
  address: Address;
  email?: string;
  phone?: string;
  default_invoice_use?: CfdiUseCode;
}

export interface Customer extends CustomerData {
  id: string;
  created_at: string;
  livemode: boolean;
  edit_link?: string;
  edit_link_expires_at?: string;
  sat_validated_at?: string;
}

export interface CustomerListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  data: Customer[];
}

export interface ProductData {
  description: string;
  product_key: string;
  price: number;
  unit_key?: string;
  unit_name?: string;
  tax_included?: boolean;
  taxability?: TaxabilityCodeType;
  taxes?: Tax[];
  local_taxes?: LocalTax[];
  sku?: string;
}

export interface Product extends ProductData {
  id: string;
  created_at: string;
  livemode: boolean;
}

export interface ProductListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  data: Product[];
}

export interface LineItem {
  quantity: number;
  discount?: number;
  product: ProductData | { id: string };
  parts?: PartItem[];
}

export interface PartItem {
  description: string;
  product_key: string;
  quantity: number;
  sku?: string;
  unit_price: number;
  unit_name: string;
  customs_keys?: string[];
}

export interface RelatedDocument {
  relationship: string;
  documents: Record<string, unknown>;
}

export interface GlobalInvoiceConfig {
  periodicity: string;
  months: string;
  year: number;
}

export interface ComplementInput {
  type: string;
  data?: Record<string, unknown>;
  custom?: string;
}

export interface Namespace {
  prefix: string;
  uri: string;
  schema_location?: string;
}

export interface PdfOptions {
  show_quantity?: boolean;
  show_unit_price?: boolean;
  show_discount?: boolean;
  show_tax?: boolean;
}

export interface InvoiceInput {
  type?: InvoiceTypeCode;
  customer: { id: string } | CustomerData;
  items: LineItem[];
  payment_form: PaymentFormCode;
  payment_method?: PaymentMethodCode;
  use?: CfdiUseCode;
  currency?: string;
  exchange?: number;
  conditions?: string;
  related_documents?: RelatedDocument[];
  global?: GlobalInvoiceConfig;
  complements?: ComplementInput[];
  status?: "draft" | "pending";
  date?: string;
  address?: Address;
  external_id?: string;
  idempotency_key?: string;
  folio_number?: number;
  series?: string;
  pdf_custom_section?: string;
  addenda?: string;
  namespaces?: Namespace[];
  pdf_options?: PdfOptions;
}

export interface StampData {
  signature: string;
  date: string;
  sat_cert_number: string;
  sat_signature: string;
}

export interface Invoice {
  id: string;
  created_at: string;
  livemode: boolean;
  status: InvoiceStatusCode;
  cancellation_status?: string;
  canceled_at?: string;
  verification_url?: string;
  date: string;
  address?: Address;
  type: InvoiceTypeCode;
  customer: Pick<Customer, "id" | "legal_name" | "tax_id" | "address">;
  total: number;
  uuid?: string;
  folio_number?: number;
  series?: string;
  external_id?: string;
  idempotency_key?: string;
  payment_form: string;
  payment_method?: string;
  use?: string;
  total_payment_amount?: number;
  items: LineItem[];
  related_documents?: RelatedDocument[];
  currency: string;
  exchange: number;
  complements?: Record<string, unknown>;
  stamp?: StampData;
  pdf_custom_section?: string;
  addenda?: string;
  namespaces?: Namespace[];
}

export interface InvoiceListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  data: Invoice[];
}

export interface InvoiceListParams {
  q?: string;
  customer?: string;
  status?: InvoiceStatusCode;
  type?: InvoiceTypeCode;
  date?: { gt?: string; lt?: string };
  page?: number;
  limit?: number;
}

export interface ReceiptInput {
  customer?: { id: string };
  items: LineItem[];
  payment_form: PaymentFormCode;
  date?: string;
  currency?: string;
  exchange?: number;
  external_id?: string;
  idempotency_key?: string;
}

export interface Receipt {
  id: string;
  created_at: string;
  livemode: boolean;
  status: string;
  date: string;
  customer?: Pick<Customer, "id" | "legal_name" | "tax_id">;
  total: number;
  items: LineItem[];
  currency: string;
  exchange: number;
  external_id?: string;
}

export interface ReceiptListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  data: Receipt[];
}

export interface RetentionInput {
  type: string;
  customer: { id: string } | CustomerData;
  items: Array<{
    tax_type: string;
    tax_rate: number;
    base: number;
    tax_amount: number;
    description?: string;
  }>;
  use?: string;
  date?: string;
  status?: "draft" | "pending";
  external_id?: string;
}

export interface Retention {
  id: string;
  created_at: string;
  livemode: boolean;
  status: string;
  type: string;
  customer: Pick<Customer, "id" | "legal_name" | "tax_id">;
  total: number;
  uuid?: string;
  items: Record<string, unknown>[];
}

export interface OrganizationFiscalData {
  rfc: string;
  legal_name: string;
  tax_system: TaxSystemCode;
  zip_code: string;
  regime?: string;
  certificate_password?: string;
}

export interface Organization {
  id: string;
  created_at: string;
  livemode: boolean;
  rfc: string;
  legal_name: string;
  tax_system: string;
  zip_code: string;
  is_active: boolean;
  setup_complete: boolean;
  logo_url?: string;
  pdf_customization?: Record<string, unknown>;
}

export interface OrganizationListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  data: Organization[];
}

export interface WebhookInput {
  url: string;
  events: string[];
  description?: string;
  enabled?: boolean;
}

export interface Webhook {
  id: string;
  created_at: string;
  url: string;
  events: string[];
  description?: string;
  enabled: boolean;
  secret?: string;
}

export interface DownloadResponse {
  type: "xml" | "pdf" | "zip";
  content: Buffer;
  filename: string;
  mime_type: string;
}

export interface EmailInput {
  email: string;
  subject?: string;
  message?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    status: number;
    location?: string;
    path?: string;
    errors?: Array<{
      message: string;
      code: string;
      source: string;
      location?: string;
      path?: string;
    }>;
  };
}

export interface PaginatedResponse<T> {
  page: number;
  total_pages: number;
  total_results: number;
  data: T[];
}

export interface OrganizationSetupStatus {
  organization_created: boolean;
  csd_uploaded: boolean;
  fiscal_data_complete: boolean;
  subscription_active: boolean;
  manifesto_signed: boolean;
  live_ready: boolean;
}

export interface BillingStats {
  invoices_this_month: number;
  receipts_this_month: number;
  retentions_this_month: number;
  total_billed_mxn: number;
  cancelled_this_month: number;
  csd_days_until_expiry: number | null;
}

export interface DateRange {
  from: string;
  to: string;
}

export type InvoiceDownloadType = "xml" | "pdf" | "zip";
