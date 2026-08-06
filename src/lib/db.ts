import { Pool, PoolClient } from "pg";
import { encrypt, decrypt } from "./encryption.js";

let pool: Pool | null = null;

export function initDatabase(connectionString?: string): Pool {
  if (pool) return pool;

  const connStr = connectionString ?? process.env.NEON_DATABASE_URL ?? process.env.NEON_POOL_URL;

  if (!connStr) {
    throw new Error("NEON_DATABASE_URL or NEON_POOL_URL environment variable is required");
  }

  pool = new Pool({
    connectionString: connStr,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  pool.on("error", (err) => {
    console.error("Neon pool error:", err.message);
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) return initDatabase();
  return pool;
}

async function query<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

async function queryOne<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ============================================================
// Organizaciones
// ============================================================

export interface DbOrganization {
  id: string;
  account_id: string;
  organization_name: string;
  rfc: string;
  legal_name: string;
  tax_system: string;
  zip_code: string;
  csd_cer_encrypted: string | null;
  csd_key_encrypted: string | null;
  csd_password_encrypted: string | null;
  csd_expires_at: string | null;
  fiel_cer_encrypted: string | null;
  fiel_key_encrypted: string | null;
  fiel_password_encrypted: string | null;
  facturapi_organization_id: string | null;
  setup_status: Record<string, boolean>;
  logo_url: string | null;
  pdf_customization: Record<string, unknown> | null;
  default_series: string | null;
  autofactura_enabled: boolean;
  receipts_enabled: boolean;
  current_month_invoices: number;
  invoice_quota: number;
  created_at: string;
  updated_at: string;
}

export async function getOrganizationByAccount(accountId: string): Promise<DbOrganization | null> {
  return queryOne<DbOrganization>(
    `SELECT * FROM tax_organizations WHERE account_id = $1`,
    [accountId]
  );
}

export async function getOrganizationById(orgId: string): Promise<DbOrganization | null> {
  return queryOne<DbOrganization>(
    `SELECT * FROM tax_organizations WHERE id = $1`,
    [orgId]
  );
}

export async function createOrganization(data: {
  account_id: string;
  organization_name: string;
  rfc: string;
  legal_name: string;
  tax_system: string;
  zip_code: string;
}): Promise<DbOrganization> {
  const row = await queryOne<DbOrganization>(
    `INSERT INTO tax_organizations (account_id, organization_name, rfc, legal_name, tax_system, zip_code, setup_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.account_id,
      data.organization_name,
      data.rfc,
      data.legal_name,
      data.tax_system,
      data.zip_code,
      JSON.stringify({
        organization_created: true,
        csd_uploaded: false,
        fiscal_data_complete: true,
        subscription_active: false,
        manifesto_signed: false,
        live_ready: false,
      }),
    ]
  );

  if (!row) throw new Error("Failed to create organization");
  return row;
}

export async function updateOrganizationSetupStatus(
  orgId: string,
  updates: Partial<Record<string, boolean>>
): Promise<void> {
  const org = await getOrganizationById(orgId);
  if (!org) throw new Error("Organization not found");

  const currentStatus = typeof org.setup_status === "string"
    ? JSON.parse(org.setup_status as unknown as string)
    : org.setup_status;
  const newStatus = { ...currentStatus, ...updates };

  await getPool().query(
    `UPDATE tax_organizations SET setup_status = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(newStatus), orgId]
  );
}

export async function saveCsdEncrypted(
  orgId: string,
  cerBase64: string,
  keyBase64: string,
  password: string
): Promise<void> {
  const expiry = extractCertExpiry(cerBase64);
  const org = await getOrganizationById(orgId);
  const currentStatus = org
    ? (typeof org.setup_status === "string" ? JSON.parse(org.setup_status as unknown as string) : org.setup_status)
    : {};

  await getPool().query(
    `UPDATE tax_organizations 
     SET csd_cer_encrypted = $1, csd_key_encrypted = $2, csd_password_encrypted = $3,
         csd_expires_at = $4, setup_status = $5, updated_at = NOW()
     WHERE id = $6`,
    [encrypt(cerBase64), encrypt(keyBase64), encrypt(password), expiry, JSON.stringify({ ...currentStatus, csd_uploaded: true }), orgId]
  );
}

export async function getCsdDecrypted(orgId: string): Promise<{
  cer: string;
  key: string;
  password: string;
} | null> {
  const org = await getOrganizationById(orgId);
  if (!org || !org.csd_cer_encrypted || !org.csd_key_encrypted || !org.csd_password_encrypted) return null;

  return {
    cer: decrypt(org.csd_cer_encrypted),
    key: decrypt(org.csd_key_encrypted),
    password: decrypt(org.csd_password_encrypted),
  };
}

export async function saveFielEncrypted(
  orgId: string,
  cerBase64: string,
  keyBase64: string,
  password: string
): Promise<void> {
  await getPool().query(
    `UPDATE tax_organizations 
     SET fiel_cer_encrypted = $1, fiel_key_encrypted = $2, fiel_password_encrypted = $3, updated_at = NOW()
     WHERE id = $4`,
    [encrypt(cerBase64), encrypt(keyBase64), encrypt(password), orgId]
  );
}

export async function updateFacturapiOrgId(
  orgId: string,
  facturapiOrgId: string
): Promise<void> {
  await getPool().query(
    `UPDATE tax_organizations SET facturapi_organization_id = $1, updated_at = NOW() WHERE id = $2`,
    [facturapiOrgId, orgId]
  );
}

export async function recordBillingActivity(data: {
  organization_id: string;
  account_id: string;
  action_type: string;
  document_type?: string;
  facturapi_invoice_id?: string;
  cfdi_uuid?: string;
  customer_name?: string;
  total?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO billing_activity_log 
     (organization_id, account_id, action_type, document_type, facturapi_invoice_id, cfdi_uuid, customer_name, total, status, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
    [
      data.organization_id, data.account_id, data.action_type, data.document_type ?? null,
      data.facturapi_invoice_id ?? null, data.cfdi_uuid ?? null, data.customer_name ?? null,
      data.total ?? null, data.status ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
}

// ============================================================
// Cache de Clientes y Productos
// ============================================================

export async function cacheCustomer(orgId: string, customer: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO customers (organization_id, facturapi_customer_id, legal_name, tax_id, email, phone, metadata, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (facturapi_customer_id) 
     DO UPDATE SET legal_name = $3, tax_id = $4, email = $5, phone = $6, metadata = $7, last_synced_at = NOW()`,
    [
      orgId, customer.id as string, customer.legal_name as string,
      customer.tax_id as string ?? null, customer.email as string ?? null,
      customer.phone as string ?? null, JSON.stringify(customer),
    ]
  );
}

export async function cacheProduct(orgId: string, product: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO products (organization_id, facturapi_product_id, description, product_key, price, sku, metadata, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (facturapi_product_id) 
     DO UPDATE SET description = $3, product_key = $4, price = $5, sku = $6, metadata = $7, last_synced_at = NOW()`,
    [
      orgId, product.id as string, product.description as string,
      product.product_key as string, product.price as number,
      product.sku as string ?? null, JSON.stringify(product),
    ]
  );
}

// ============================================================
// Utilidades
// ============================================================

function extractCertExpiry(base64Cer: string): string | null {
  try {
    const der = Buffer.from(base64Cer, "base64");
    const certStr = der.toString("latin1");
    const match = certStr.match(/Validity[\s\S]*?Not After\s*:\s*([^\n]+)/);
    if (match) {
      const parts = match[1].trim().split(/[\s:]/);
      const months: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
      };
      const day = parseInt(parts[0]);
      const month = months[parts[1]] ?? 0;
      const year = parseInt(parts[2]);
      return new Date(year, month, day).toISOString().split("T")[0];
    }
    return null;
  } catch {
    return null;
  }
}
