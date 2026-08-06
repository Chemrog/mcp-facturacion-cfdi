import { encrypt, decrypt } from "./encryption.js";

const FACTURAPI_BASE = "https://www.facturapi.io/v2";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

let masterLiveKey: string | null = null;
let masterTestKey: string | null = null;
let masterUserKey: string | null = null;

export function setMasterKeys(live: string, test: string, user: string): void {
  masterLiveKey = live;
  masterTestKey = test;
  masterUserKey = user;
}

function getKey(env: "live" | "test" | "user"): string {
  switch (env) {
    case "live":
      return masterLiveKey ?? process.env.FACTURAPI_LIVE_KEY ?? "";
    case "test":
      return masterTestKey ?? process.env.FACTURAPI_TEST_KEY ?? "";
    case "user":
      return masterUserKey ?? process.env.FACTURAPI_USER_KEY ?? "";
  }
}

interface RequestOptions {
  env?: "live" | "test" | "user";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  isFormData?: boolean;
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { env = "test", body, params } = options;
  const apiKey = getKey(env);

  if (!apiKey) {
    throw new Error(
      `FacturAPI ${env} key not configured. Set FACTURAPI_LIVE_KEY / FACTURAPI_TEST_KEY / FACTURAPI_USER_KEY`
    );
  }

  let url = `${FACTURAPI_BASE}${path}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) searchParams.set(key, String(value));
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await response.json();

    if (!response.ok) {
      const err = json as {
        code?: string;
        message?: string;
        status?: number;
        errors?: Array<{ message: string; code: string; source: string }>;
      };
      throw new ApiError(
        err.message ?? "Unknown error",
        response.status,
        err.code ?? "api_error",
        err.errors
      );
    }

    return json as T;
  }

  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, response.status, "http_error");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer as unknown as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public errors?: Array<{ message: string; code: string; source: string }>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getBuffer(path: string, env: "live" | "test" = "test"): Promise<Buffer> {
  const apiKey = getKey(env);
  const response = await fetch(`${FACTURAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new ApiError(`Download failed: ${response.status}`, response.status, "download_error");
  }
  return Buffer.from(await response.arrayBuffer());
}

// ============================================================
// Clientes
// ============================================================
export const customers = {
  create: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/customers", { env, body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", "/customers", { env, params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/customers/${id}`, { env }),
  update: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/customers/${id}`, { env, body: data }),
  delete: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/customers/${id}`, { env }),
  validateTaxInfo: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/customers/${id}/tax-info-validation`, { env }),
  sendEditLink: (id: string, email?: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/customers/${id}/email-edit-link`, { env, body: { email } }),
};

// ============================================================
// Productos
// ============================================================
export const products = {
  create: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/products", { env, body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", "/products", { env, params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/products/${id}`, { env }),
  update: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/products/${id}`, { env, body: data }),
  delete: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/products/${id}`, { env }),
};

// ============================================================
// Facturas
// ============================================================
export const invoices = {
  create: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/invoices", { env, body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", "/invoices", { env, params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/invoices/${id}`, { env }),
  update: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/invoices/${id}`, { env, body: data }),
  cancel: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/invoices/${id}`, { env }),
  copyToDraft: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/invoices/${id}/copy`, { env }),
  stampDraft: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/invoices/${id}/stamp`, { env }),
  download: async (id: string, type: "xml" | "pdf" | "zip", env: "live" | "test" = "test"): Promise<Buffer> => {
    const typeMap = { xml: "xml", pdf: "pdf", zip: "zip" };
    return getBuffer(`/invoices/${id}/${typeMap[type]}`, env);
  },
  downloadCancellationReceipt: async (id: string, env: "live" | "test" = "test"): Promise<Buffer> => {
    return getBuffer(`/invoices/${id}/cancellation_receipt`, env);
  },
  sendByEmail: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/invoices/${id}/email`, { env, body: data }),
  updateStatus: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/invoices/${id}/status`, { env, body: data }),
  previewPdf: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/invoices/preview", { env, body: data }),
};

// ============================================================
// Recibos
// ============================================================
export const receipts = {
  create: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/receipts", { env, body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", "/receipts", { env, params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/receipts/${id}`, { env }),
  assignCustomer: (id: string, customerId: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/receipts/${id}`, { env, body: { customer: { id: customerId } } }),
  cancel: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/receipts/${id}`, { env }),
  downloadPdf: async (id: string, env: "live" | "test" = "test"): Promise<Buffer> => {
    return getBuffer(`/receipts/${id}/pdf`, env);
  },
  sendByEmail: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/receipts/${id}/email`, { env, body: data }),
  invoice: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/receipts/${id}/invoice`, { env }),
  invoiceMultiple: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/receipts/invoice-multiple", { env, body: data }),
  createGlobalInvoice: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/receipts/global-invoice", { env, body: data }),
  previewMultiplePdf: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/receipts/preview-multiple", { env, body: data }),
};

// ============================================================
// Retenciones
// ============================================================
export const retentions = {
  create: (data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", "/retentions", { env, body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", "/retentions", { env, params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/retentions/${id}`, { env }),
  update: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/retentions/${id}`, { env, body: data }),
  cancel: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/retentions/${id}`, { env }),
  copyToDraft: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/retentions/${id}/copy`, { env }),
  stampDraft: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/retentions/${id}/stamp`, { env }),
  download: async (id: string, type: "xml" | "pdf" | "zip" = "zip", env: "live" | "test" = "test"): Promise<Buffer> => {
    return getBuffer(`/retentions/${id}/${type}`, env);
  },
  sendByEmail: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/retentions/${id}/email`, { env, body: data }),
};

// ============================================================
// Organizaciones
// ============================================================
export const organizations = {
  create: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("POST", "/organizations", { env: "user", body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/organizations", { env: "user", params }),
  get: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/organizations/${id}`, { env }),
  getById: (id: string) =>
    request<Record<string, unknown>>("GET", `/organizations/${id}`, { env: "user" }),
  updateFiscalData: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/fiscal-data`, { env: "live", body: data }),
  uploadCertificate: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/certificates`, { env: "live", body: data }),
  deleteCertificate: (id: string) =>
    request<Record<string, unknown>>("DELETE", `/organizations/${id}/certificates`, { env: "live" }),
  uploadFiel: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/fiel`, { env: "live", body: data }),
  uploadLogo: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/logo`, { env: "live", body: data }),
  updateCustomization: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/customization`, { env: "live", body: data }),
  updateReceiptsConfig: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/receipts-config`, { env: "live", body: data }),
  updateAutofactura: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/autofactura`, { env: "live", body: data }),
  listSeries: (id: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("GET", `/organizations/${id}/series`, { env }),
  createSeries: (id: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("POST", `/organizations/${id}/series`, { env, body: data }),
  updateSeries: (id: string, seriesName: string, data: Record<string, unknown>, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/series/${seriesName}`, { env, body: data }),
  deleteSeries: (id: string, seriesName: string, env: "live" | "test" = "test") =>
    request<Record<string, unknown>>("DELETE", `/organizations/${id}/series/${seriesName}`, { env }),
  getApiKeys: (id: string, type: "test" | "live") =>
    request<Record<string, unknown>>("GET", `/organizations/${id}/api-keys/${type}`, { env: "user" }),
  renewTestKey: (id: string) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/api-keys/test/renew`, { env: "user" }),
  createLiveKey: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/organizations/${id}/api-keys/live`, { env: "user", body: data }),
  revokeLiveKey: (id: string, apiKeyId: string) =>
    request<Record<string, unknown>>("DELETE", `/organizations/${id}/api-keys/live/${apiKeyId}`, { env: "user" }),
};

// ============================================================
// Herramientas / Catalogos
// NOTA: Algunos endpoints de herramientas no estan disponibles en la API v2 actual.
// Se implementan localmente con datos del catalogo SAT.
// ============================================================
export const tools = {
  // La API v2 no tiene endpoint health independiente - usamos list organizations como check
  healthCheck: async () => {
    const r = await fetch(`${FACTURAPI_BASE}/organizations`, {
      headers: { Authorization: `Bearer ${getKey("user")}` }
    });
    return { ok: r.ok, status: r.status } as Record<string, unknown>;
  },

  // RFC validation no disponible via API v2 - se hace localmente
  validateRfc: async (rfc: string) => {
    const valid = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/.test(rfc);
    return { valid, rfc } as Record<string, unknown>;
  },
};

// ============================================================
// Catalogos Carta Porte
// ============================================================
export const cartaPorte = {
  searchTransport: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/transport", { env: "test", params }),
  searchConfigurations: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/configurations", { env: "test", params }),
  searchCustomsDocuments: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/customs-documents", { env: "test", params }),
  searchPackaging: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/packaging", { env: "test", params }),
  searchTrailers: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/trailers", { env: "test", params }),
  searchHazardousMaterials: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/hazardous-materials", { env: "test", params }),
  searchNavalAuthorizations: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/naval", { env: "test", params }),
  searchPorts: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/ports", { env: "test", params }),
  searchContainers: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/containers", { env: "test", params }),
  searchTransitRights: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/carta-porte/transit-rights", { env: "test", params }),
};

// ============================================================
// Comercio Exterior
// ============================================================
export const foreignTrade = {
  searchTariffFractions: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/tools/catalogs/foreign-trade/tariff-fractions", { env: "test", params }),
};

// ============================================================
// Webhooks
// ============================================================
export const webhooks = {
  create: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("POST", "/webhooks", { env: "user", body: data }),
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<Record<string, unknown>>("GET", "/webhooks", { env: "user", params }),
  get: (id: string) =>
    request<Record<string, unknown>>("GET", `/webhooks/${id}`, { env: "user" }),
  update: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>("PUT", `/webhooks/${id}`, { env: "user", body: data }),
  delete: (id: string) =>
    request<Record<string, unknown>>("DELETE", `/webhooks/${id}`, { env: "user" }),
  validateEvent: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("POST", "/webhooks/validate", { env: "user", body: data }),
};
