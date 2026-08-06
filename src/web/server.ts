import express from "express";
import session from "express-session";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import * as db from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.ENCRYPTION_KEY || "dev-secret",
  resave: false,
  saveUninitialized: true,
}));

declare module "express-session" {
  interface SessionData {
    account_id?: string;
    org_id?: string;
  }
}

// ============================================================
// RUTAS
// ============================================================

app.get("/", (_req, res) => {
  res.render("index");
});

// --- Registro ---
app.get("/register", (_req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  try {
    const { email, full_name, password } = req.body;
    if (!email || !full_name || !password) {
      return res.render("register", { error: "Todos los campos son requeridos" });
    }
    const hash = password; // TODO: bcrypt

    const row = await db.getPool().query(
      `INSERT INTO conectus_accounts (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, full_name, hash]
    );

    req.session.account_id = row.rows[0].id;
    res.redirect("/onboarding");
  } catch (err: any) {
    res.render("register", { error: err.message.includes("unique") ? "Este email ya esta registrado" : "Error al registrar" });
  }
});

app.get("/login", (_req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const row = await db.getPool().query(
      `SELECT id FROM conectus_accounts WHERE email = $1 AND password_hash = $2`,
      [email, password]
    );
    if (row.rows.length === 0) {
      return res.render("login", { error: "Email o contrasena incorrectos" });
    }
    req.session.account_id = row.rows[0].id;
    res.redirect("/onboarding");
  } catch (err) {
    res.render("login", { error: "Error al iniciar sesion" });
  }
});

// --- Onboarding ---
app.get("/onboarding", async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

  try {
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) {
      return res.render("onboarding-step1", { error: null });
    }
    res.redirect("/dashboard");
  } catch {
    res.render("onboarding-step1", { error: null });
  }
});

app.post("/onboarding/step1", async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

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
      organization_name,
      rfc,
      legal_name,
      tax_system,
      zip_code,
    });

    req.session.org_id = org.id;
    res.redirect("/onboarding/step2");
  } catch (err: any) {
    res.render("onboarding-step1", { error: err.message });
  }
});

app.get("/onboarding/step2", async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

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
]), async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

  try {
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) return res.redirect("/onboarding");

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const cerFile = files?.cer_file?.[0];
    const keyFile = files?.key_file?.[0];
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

    res.redirect("/onboarding/step3");
  } catch (err: any) {
    const orgUpdated = await db.getOrganizationByAccount(req.session.account_id!);
    res.render("onboarding-step2", {
      error: err.message,
      has_csd: orgUpdated?.setup_status.csd_uploaded ?? false,
      csd_expires_at: orgUpdated?.csd_expires_at ?? null,
    });
  }
});

app.get("/onboarding/step3", async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

  const org = await db.getOrganizationByAccount(req.session.account_id);
  if (!org) return res.redirect("/onboarding");

  res.render("onboarding-step3", {
    error: null,
    has_fiel: !!org.fiel_cer_encrypted,
  });
});

app.post("/onboarding/step3", upload.fields([
  { name: "fiel_cer", maxCount: 1 },
  { name: "fiel_key", maxCount: 1 },
]), async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

  try {
    const org = await db.getOrganizationByAccount(req.session.account_id);
    if (!org) return res.redirect("/onboarding");

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const cer = files?.fiel_cer?.[0];
    const key = files?.fiel_key?.[0];
    const pass = req.body.fiel_password;

    if (!cer || !key || !pass) {
      return res.render("onboarding-step3", { error: "Sube ambos archivos y la contrasena", has_fiel: !!org.fiel_cer_encrypted });
    }

    await db.saveFielEncrypted(org.id, cer.buffer.toString("base64"), key.buffer.toString("base64"), pass);
    res.redirect("/dashboard");
  } catch (err: any) {
    const org = await db.getOrganizationByAccount(req.session.account_id!);
    res.render("onboarding-step3", { error: err.message, has_fiel: !!org?.fiel_cer_encrypted });
  }
});

// --- Dashboard ---
app.get("/dashboard", async (req, res) => {
  if (!req.session.account_id) return res.redirect("/login");

  const org = await db.getOrganizationByAccount(req.session.account_id);
  if (!org) return res.redirect("/onboarding");

  const csdDays = org.csd_expires_at
    ? Math.ceil((new Date(org.csd_expires_at).getTime() - Date.now()) / 86400000)
    : null;

  res.render("dashboard", {
    org,
    csd_days: csdDays,
    status: org.setup_status,
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ============================================================
// START
// ============================================================
const PORT = process.env.WEB_PORT || 3000;

try {
  db.initDatabase();
  app.listen(PORT, () => {
    console.log(`🌐 conectus.mx Onboarding corriendo en http://localhost:${PORT}`);
  });
} catch (err) {
  console.error("Failed to start web server:", err);
}
