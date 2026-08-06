-- ============================================================
-- conectus.mx - Esquema de Base de Datos para Facturacion CFDI
-- ============================================================

-- Cuentas de usuario en conectus.mx
CREATE TABLE conectus_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'inactive',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organizaciones fiscales por cuenta
CREATE TABLE tax_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES conectus_accounts(id) NOT NULL,
  organization_name TEXT NOT NULL,
  rfc TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  tax_system TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  
  -- CSD (ENCRIPTADO)
  csd_cer_encrypted TEXT,
  csd_key_encrypted TEXT,
  csd_password_encrypted TEXT,
  csd_expires_at DATE,
  csd_serial_number TEXT,
  
  -- e.firma / FIEL (ENCRIPTADO)
  fiel_cer_encrypted TEXT,
  fiel_key_encrypted TEXT,
  fiel_password_encrypted TEXT,
  
  -- ID en FacturAPI
  facturapi_organization_id TEXT,
  
  -- Estado de configuracion
  setup_status JSONB DEFAULT '{
    "organization_created": false,
    "csd_uploaded": false,
    "fiscal_data_complete": false,
    "subscription_active": false,
    "manifesto_signed": false,
    "live_ready": false
  }',
  
  -- Personalizacion
  logo_url TEXT,
  pdf_customization JSONB DEFAULT '{}',
  default_series TEXT,
  autofactura_enabled BOOLEAN DEFAULT FALSE,
  receipts_enabled BOOLEAN DEFAULT FALSE,
  
  -- Timbre tracking
  current_month_invoices INTEGER DEFAULT 0,
  invoice_quota INTEGER DEFAULT 100,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuracion de plataforma (API Keys maestras ENCRIPTADAS)
CREATE TABLE platform_config (
  key TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log de actividad de facturacion
CREATE TABLE billing_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES tax_organizations(id),
  account_id UUID REFERENCES conectus_accounts(id),
  action_type TEXT NOT NULL,
  document_type TEXT,
  facturapi_invoice_id TEXT,
  cfdi_uuid TEXT,
  customer_name TEXT,
  total NUMERIC(12,2),
  status TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clientes (cache local)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES tax_organizations(id),
  facturapi_customer_id TEXT UNIQUE,
  legal_name TEXT NOT NULL,
  tax_id TEXT,
  email TEXT,
  phone TEXT,
  address JSONB,
  metadata JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Productos/Servicios (cache local)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES tax_organizations(id),
  facturapi_product_id TEXT UNIQUE,
  description TEXT NOT NULL,
  product_key TEXT NOT NULL,
  price NUMERIC(12,2),
  sku TEXT,
  unit_key TEXT DEFAULT 'H87',
  unit_name TEXT DEFAULT 'Elemento',
  tax_included BOOLEAN DEFAULT TRUE,
  taxability TEXT DEFAULT '02',
  taxes JSONB,
  metadata JSONB,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX idx_org_account ON tax_organizations(account_id);
CREATE INDEX idx_activity_org ON billing_activity_log(organization_id);
CREATE INDEX idx_activity_account ON billing_activity_log(account_id);
CREATE INDEX idx_activity_date ON billing_activity_log(created_at);
CREATE INDEX idx_customers_org ON customers(organization_id);
CREATE INDEX idx_customers_tax_id ON customers(tax_id);
CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_sku ON products(sku);

-- RLS para seguridad
ALTER TABLE tax_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
