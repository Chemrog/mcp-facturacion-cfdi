import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "async_hooks";
import session from "express-session";
import multer from "multer";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler } from "@modelcontextprotocol/node";

import * as db from "./lib/db.js";
import { setMasterKeys } from "./lib/facturapi-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "conectus-internal-secret-dev";

// ============================================================
// Session context (para MCP tools - quien es el usuario)
// ============================================================
interface SessionContext {
  accountId?: string;
  orgId?: string;
}
const mcpContext = new AsyncLocalStorage<SessionContext>();

// ============================================================
// Express setup
// ============================================================
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "web", "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "web", "views"));
app.use(session({
  secret: process.env.ENCRYPTION_KEY || "dev-secret",
  resave: false,
  saveUninitialized: true,
}));

// ============================================================
// Health / Info
// ============================================================
app.get("/info", (_req, res) => {
  res.send(`
    <html><head><title>conectus.mx - Facturacion CFDI MCP</title></head>
    <body style="font-family:sans-serif;padding:40px;background:#0a0a0f;color:#e2e8f0">
      <h1>🧾 conectus.mx</h1>
      <h2>MCP Server de Facturacion Electronica CFDI</h2>
      <p>89 herramientas para emitir CFDI 4.0, recibos, retenciones y mas.</p>
      <p>Endpoint MCP: <code>POST /mcp</code></p>
      <p>Onboarding: <a href="/onboarding">/onboarding</a></p>
      <p>Health: <a href="/health">/health</a></p>
    </body></html>
  `);
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  res.json({
    resource: `${protocol}://${host}`,
    authorization_servers: [process.env.PLATFORM_URL || `http://localhost:${PORT}`],
    scopes_supported: ["mcp:use"],
  });
});

// ============================================================
// Auth middleware para MCP
// ============================================================
// Cache de validacion (5 min)
const authCache = new Map<string, { data: { userId?: string; tenantId?: string; accountId?: string }; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

const mcpAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const key = req.headers.authorization?.replace("Bearer ", "") || (req.query.key as string);

  if (!key) {
    res.status(401).json({ error: "No API key" });
    return;
  }

  // Check cache
  const cached = authCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    (req as any).auth = cached.data;
    next();
    return;
  }

  // Si la key coincide con INTERNAL_SECRET, es admin
  if (key === INTERNAL_SECRET) {
    const data = { accountId: "admin" };
    authCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
    (req as any).auth = data;
    next();
    return;
  }

  // Intentar decodificar como JWT (OAuth token de Claude/conectus.mx)
  try {
    const parts = key.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      const userId = payload.sub || payload.userId;
      const tenantId = payload.tenant_id || payload.tenantId || "default";
      if (userId || tenantId) {
        const data = { userId, tenantId, accountId: tenantId };
        authCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
        (req as any).auth = data;
        next();
        return;
      }
    }
  } catch {
    // Not a valid JWT, fall through
  }

  // Fallback: validar contra DB local
  try {
    const pool = db.getPool();
    const row = await pool.query(
      `SELECT t.id as org_id, t.account_id FROM tax_organizations t WHERE t.id = $1 OR t.account_id = $1`,
      [key]
    );

    if (row.rows.length > 0) {
      const data = { accountId: row.rows[0].account_id, orgId: row.rows[0].org_id };
      authCache.set(key, { data, expiry: Date.now() + CACHE_TTL });
      (req as any).auth = data;
      next();
      return;
    }
  } catch {
    // DB not available
  }

  res.status(403).json({ error: "Invalid API key" });
};

// ============================================================
// MCP Server setup
// ============================================================
async function createMcpServer(): Promise<McpServer> {
  console.error("🔄 Inicializando MCP server...");
  
  setMasterKeys(
    process.env.FACTURAPI_LIVE_KEY || "",
    process.env.FACTURAPI_TEST_KEY || "",
    process.env.FACTURAPI_USER_KEY || ""
  );
  console.error("✅ FacturAPI keys configuradas");

  try { 
    db.initDatabase(); 
    console.error("✅ Neon DB conectada");
  } catch (e: any) { 
    console.error("⚠️ Neon DB no disponible:", e.message);
  }

  const server = new McpServer(
    { name: "conectus-mx-facturacion-cfdi", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Cargar todas las tools
  try {
    console.error("📦 Cargando tools...");
    try { await import("./tools/onboarding.tools.js"); console.error("  ✅ onboarding tools"); } catch(e: any) { console.error("  ❌ onboarding:", e.message); }
    try { await import("./tools/customers_products.tools.js"); console.error("  ✅ customers/products"); } catch(e: any) { console.error("  ❌ customers:", e.message); }
    try { await import("./tools/invoices.tools.js"); console.error("  ✅ invoices"); } catch(e: any) { console.error("  ❌ invoices:", e.message); }
    try { await import("./tools/receipts_retentions.tools.js"); console.error("  ✅ receipts/retentions"); } catch(e: any) { console.error("  ❌ receipts:", e.message); }
    try { await import("./tools/consulting.tools.js"); console.error("  ✅ consulting"); } catch(e: any) { console.error("  ❌ consulting:", e.message); }
    try { await import("./tools/carta_porte.tools.js"); console.error("  ✅ carta porte"); } catch(e: any) { console.error("  ❌ carta:", e.message); }
    try { await import("./tools/reports_webhooks.tools.js"); console.error("  ✅ reports"); } catch(e: any) { console.error("  ❌ reports:", e.message); }
    try { await import("./tools/assistant.tools.js"); console.error("  ✅ assistant"); } catch(e: any) { console.error("  ❌ assistant:", e.message); }
    
    const { onboardingTools } = await import("./tools/onboarding.tools.js");
    const { customerTools, productTools } = await import("./tools/customers_products.tools.js");
    const { invoiceTools } = await import("./tools/invoices.tools.js");
    const { receiptTools, retentionTools } = await import("./tools/receipts_retentions.tools.js");
    const { consultingTools } = await import("./tools/consulting.tools.js");
    const { cartaPorteTools, foreignTradeTools } = await import("./tools/carta_porte.tools.js");
    const { reportsTools } = await import("./tools/reports_webhooks.tools.js");
    const { assistantTools } = await import("./tools/assistant.tools.js");

    const allTools = [
      ...onboardingTools,
      ...customerTools,
      ...productTools,
      ...invoiceTools,
      ...receiptTools,
      ...retentionTools,
      ...consultingTools,
      ...cartaPorteTools,
      ...foreignTradeTools,
      ...reportsTools,
      ...assistantTools,
    ];

    for (const tool of allTools) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: tool.inputSchema,
      } as any, async (args: any) => {
        try {
          return await tool.handler(args);
        } catch (err: any) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: err.message, code: err.code || "internal_error" }, null, 2),
            }],
          };
        }
      });
    }

    console.error(`🚀 conectus.mx - ${allTools.length} tools registradas en 11 grupos`);
  } catch (e: any) {
    console.error("❌ Error cargando tools:", e.message, e.stack);
    throw e;
  }

  return server;
}

// ============================================================
// MCP HTTP handler (Streamable HTTP)
// ============================================================
(async () => {
  let nodeMcpHandler: any = null;

  try {
    console.error("🔄 Creando MCP server...");
    const mcpServer = new McpServer(
      { name: "conectus-mx-facturacion-cfdi", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );
    console.error("✅ Servidor creado");
    
    // Cargar tools (con logging individual)
    try {
      setMasterKeys(
        process.env.FACTURAPI_LIVE_KEY || "",
        process.env.FACTURAPI_TEST_KEY || "",
        process.env.FACTURAPI_USER_KEY || ""
      );
      try { db.initDatabase(); console.error("  ✅ DB"); } catch(e: any) { console.error("  ⚠️ DB:", e.message); }
      
      const mods: Array<[string, () => Promise<any>]> = [
        ["onboarding", () => import("./tools/onboarding.tools.js")],
        ["customers", () => import("./tools/customers_products.tools.js")],
        ["invoices", () => import("./tools/invoices.tools.js")],
        ["receipts", () => import("./tools/receipts_retentions.tools.js")],
        ["consulting", () => import("./tools/consulting.tools.js")],
        ["carta", () => import("./tools/carta_porte.tools.js")],
        ["reports", () => import("./tools/reports_webhooks.tools.js")],
        ["assistant", () => import("./tools/assistant.tools.js")],
      ];
      
      let totalTools = 0;
      for (const [name, loader] of mods) {
        try {
          const mod = await loader();
          const tools: any[] = Object.values(mod).flat().filter((t: any) => t?.name);
          for (const tool of tools) {
            (mcpServer as any).registerTool(tool.name, {
              description: tool.description, 
              inputSchema: tool.inputSchema,
            }, async (args: any) => {
              try { return await tool.handler(args); } catch (e: any) {
                return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
              }
            });
            totalTools++;
          }
          console.error(`  ✅ ${name}: ${tools.length} tools`);
        } catch (e: any) {
          console.error(`  ❌ ${name}: ${e.message}`);
        }
      }
      console.error(`✅ Total: ${totalTools} tools registradas`);
    } catch (e: any) {
      console.error("❌ Error tools:", e.message);
      (globalThis as any).__mcpError = e.message;
      throw e;
    }
    
    console.error("🔄 Creando HTTP handler...");
    const mcpHandler = createMcpHandler(async () => mcpServer);
    nodeMcpHandler = toNodeHandler(mcpHandler);
    console.error("✅ MCP HTTP handler listo");
  } catch (err: any) {
    console.error("❌ Error fatal MCP:", err?.message || err, err?.stack?.slice(0,300));
    (globalThis as any).__mcpError = err?.message || String(err);
  }

  app.get("/health", (_req, res) => res.json({ 
    status: "ok", 
    mcp: "conectus-facturacion-cfdi",
    mcpReady: !!nodeMcpHandler,
  }));

  app.all(["/", "/mcp", "/sse"], mcpAuthMiddleware, async (req, res) => {
    if (!nodeMcpHandler) {
      return res.status(503).json({ error: "MCP server not initialized", mcpReady: false });
    }
    await mcpContext.run(
      { accountId: (req as any).auth?.accountId, orgId: (req as any).auth?.orgId },
      async () => {
        await nodeMcpHandler(req, res, req.body);
      }
    );
  });

  // ============================================================
  // Onboarding Web Routes
  // ============================================================
  app.get("/onboarding", async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    try {
      const org = await db.getOrganizationByAccount(req.session.account_id);
      if (!org) return res.render("onboarding-step1", { error: null });
      res.redirect("/onboarding/dashboard");
    } catch { res.render("onboarding-step1", { error: null }); }
  });

  app.get("/onboarding/login", (_req, res) => {
    res.render("login", { error: null, layout: false });
  });

  app.post("/onboarding/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      const row = await db.getPool().query(
        `SELECT id FROM conectus_accounts WHERE email = $1 AND password_hash = $2`,
        [email, password]
      );
      if (row.rows.length === 0) {
        return res.render("login", { error: "Email o contrasena incorrectos", layout: false });
      }
      req.session.account_id = row.rows[0].id;
      res.redirect("/onboarding");
    } catch (err: any) {
      res.render("login", { error: err.message, layout: false });
    }
  });

  app.get("/onboarding/register", (_req, res) => {
    res.render("register", { error: null, layout: false });
  });

  app.post("/onboarding/register", async (req: any, res) => {
    try {
      const { email, full_name, password } = req.body;
      if (!email || !full_name || !password) {
        return res.render("register", { error: "Todos los campos son requeridos", layout: false });
      }
      const row = await db.getPool().query(
        `INSERT INTO conectus_accounts (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [email, full_name, password]
      );
      req.session.account_id = row.rows[0].id;
      res.redirect("/onboarding");
    } catch (err: any) {
      res.render("register", { error: err.message?.includes("unique") ? "Email ya registrado" : err.message, layout: false });
    }
  });

  // Onboarding Step 1: Datos fiscales
  app.post("/onboarding/step1", async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    try {
      const { organization_name, rfc, legal_name, tax_system, zip_code } = req.body;
      if (!organization_name || !rfc || !legal_name || !tax_system || !zip_code) {
        return res.render("onboarding-step1", { error: "Todos los campos fiscales son requeridos" });
      }
      const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
      if (!rfcRegex.test(rfc)) {
        return res.render("onboarding-step1", { error: "RFC invalido. Formato: XXXX000000XXX" });
      }
      const org = await db.createOrganization({
        account_id: req.session.account_id,
        organization_name, rfc, legal_name, tax_system, zip_code,
      });
      req.session.org_id = org.id;
      res.redirect("/onboarding/step2");
    } catch (err: any) {
      res.render("onboarding-step1", { error: err.message });
    }
  });

  // Onboarding Step 2: CSD + Logo
  app.get("/onboarding/step2", async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) return res.redirect("/onboarding");
    res.render("onboarding-step2", {
      error: null,
      has_csd: org.setup_status.csd_uploaded,
      csd_expires_at: org.csd_expires_at,
    });
  });

  app.post("/onboarding/step2", upload.fields([
    { name: "cer_file", maxCount: 1 },
    { name: "key_file", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]), async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    try {
      const org = await db.getOrganizationByAccount(req.session.account_id);
      if (!org) return res.redirect("/onboarding");

      const files = req.files as any;
      const cerFile = files?.cer_file?.[0];
      const keyFile = files?.key_file?.[0];
      const logoFile = files?.logo?.[0];
      const password = req.body.csd_password;

      if (!cerFile || !keyFile || !password) {
        return res.render("onboarding-step2", {
          error: "Debes subir ambos archivos (.cer y .key) y la contrasena",
          has_csd: org.setup_status.csd_uploaded,
          csd_expires_at: org.csd_expires_at,
        });
      }

      await db.saveCsdEncrypted(
        org.id,
        cerFile.buffer.toString("base64"),
        keyFile.buffer.toString("base64"),
        password
      );

      // Guardar logo si se subio
      if (logoFile) {
        await db.getPool().query(
          `UPDATE tax_organizations SET logo_url = $1, updated_at = NOW() WHERE id = $2`,
          [logoFile.buffer.toString("base64"), org.id]
        );
      }

      res.redirect("/onboarding/step3");
    } catch (err: any) {
      const orgUpdated = await db.getOrganizationByAccount(req.session.account_id);
      res.render("onboarding-step2", {
        error: err.message,
        has_csd: orgUpdated?.setup_status.csd_uploaded ?? false,
        csd_expires_at: orgUpdated?.csd_expires_at ?? null,
      });
    }
  });

  // Onboarding Step 3: e.firma
  app.get("/onboarding/step3", async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) return res.redirect("/onboarding");
    res.render("onboarding-step3", { error: null, has_fiel: !!org.fiel_cer_encrypted });
  });

  app.post("/onboarding/step3", upload.fields([
    { name: "fiel_cer", maxCount: 1 },
    { name: "fiel_key", maxCount: 1 },
  ]), async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    try {
      const org = await db.getOrganizationByAccount(req.session.account_id);
      if (!org) return res.redirect("/onboarding");

      const files = req.files as any;
      const cer = files?.fiel_cer?.[0];
      const key = files?.fiel_key?.[0];
      const pass = req.body.fiel_password;

      if (!cer || !key || !pass) {
        return res.render("onboarding-step3", { error: "Sube ambos archivos y la contrasena", has_fiel: !!org.fiel_cer_encrypted });
      }

      await db.saveFielEncrypted(org.id, cer.buffer.toString("base64"), key.buffer.toString("base64"), pass);
      res.redirect("/onboarding/dashboard");
    } catch (err: any) {
      const org = await db.getOrganizationByAccount(req.session.account_id);
      res.render("onboarding-step3", { error: err.message, has_fiel: !!org?.fiel_cer_encrypted });
    }
  });

  // Dashboard
  app.get("/onboarding/dashboard", async (req: any, res) => {
    if (!req.session.account_id) return res.redirect("/onboarding/login");
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) return res.redirect("/onboarding");

    const csdDays = org.csd_expires_at
      ? Math.ceil((new Date(org.csd_expires_at).getTime() - Date.now()) / 86400000)
      : null;

    res.render("dashboard", { org, csd_days: csdDays, status: org.setup_status });
  });

  app.get("/onboarding/logout", (req: any, res) => {
    req.session.destroy(() => res.redirect("/onboarding/login"));
  });

  // Start
  app.listen(PORT, () => {
    console.log(`\n🧾 conectus.mx - MCP Facturacion CFDI v1.0.0`);
    console.log(`   MCP Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`   Onboarding:   http://localhost:${PORT}/onboarding`);
    console.log(`   Health:       http://localhost:${PORT}/health`);
    console.log(`   MCP Status:   ${nodeMcpHandler ? "✅ OK" : "❌ FAILED"}\n`);
  });
})();
