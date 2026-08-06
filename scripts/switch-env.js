#!/usr/bin/env node
// Cambiar entre modo TEST (seguro) y LIVE (facturas reales)
// Uso: node scripts/switch-env.js [test|live]

const fs = require("fs");
const path = require("path");

const ENV = process.argv[2];

if (!ENV || !["test", "live"].includes(ENV)) {
  console.error("Uso: node scripts/switch-env.js [test|live]");
  process.exit(1);
}

const configPath = path.join(
  process.env.HOME!,
  "Library/Application Support/Claude/claude_desktop_config.json"
);

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const server = config.mcpServers?.["conectus-facturacion"];

if (!server) {
  console.error("MCP conectus-facturacion no encontrado en Claude Desktop config");
  process.exit(1);
}

if (!server.env) server.env = {};

if (ENV === "live") {
  const liveKey = process.env.FACTURAPI_LIVE_KEY || process.argv[3];
  if (!liveKey) {
    console.error("FACTURAPI_LIVE_KEY no configurada. Pasala como argumento:");
    console.error("  node scripts/switch-env.js live sk_live_...");
    process.exit(1);
  }
  server.env.FACTURAPI_LIVE_KEY = liveKey;
  console.log("🟢 MODO PRODUCCION activado. Las facturas se timbraran al SAT.");
} else {
  server.env.FACTURAPI_LIVE_KEY = "";
  console.log("🟡 MODO PRUEBAS activado. Facturas de prueba, sin validez fiscal.");
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log("⚠️  Reinicia Claude Desktop para aplicar el cambio.");
