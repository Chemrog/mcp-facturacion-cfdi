#!/usr/bin/env node
// Importa catalogos SAT desde el XLS oficial a Neon
// 
// 1. Descarga el XLS del SAT: https://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/catCFDI_V_4_YYYYMMDD.xls
// 2. Ejecuta: npx tsx scripts/import-sat-xls.ts /ruta/al/catCFDI_V_4_20260806.xls
//
// Requiere: npm install xlsx

import { createClient } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const NEON_URL = process.env.NEON_DATABASE_URL!;
if (!NEON_URL) { console.error("NEON_DATABASE_URL no configurado"); process.exit(1); }

const sql = createClient(NEON_URL);

const SHEET_MAP: Record<string, { table: string; columns: string[]; filterCol?: string }> = {
  "c_ClaveProdServ": {
    table: "sat_product_keys",
    columns: ["clave", "descripción", null, null, null, "fechaInicioVigencia", "fechaFinVigencia", null, "palabrasSimilares"],
  },
};

async function importSheet(workbook: XLSX.WorkBook, sheetName: string) {
  const config = SHEET_MAP[sheetName];
  if (!config) { console.log(`⏭️  ${sheetName}: no configurado`); return; }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) { console.log(`⚠️  ${sheetName}: hoja no encontrada`); return; }

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
  if (rows.length < 2) { console.log(`⚠️  ${sheetName}: sin datos`); return; }

  const headerRow = rows[0];
  console.log(`\n📦 ${sheetName}: ${rows.length - 1} registros`);

  let imported = 0;
  let skipped = 0;
  const batch: unknown[][] = [];

  // Find column indices
  const codeIdx = headerRow.findIndex((h: string) => h?.toLowerCase().includes("clave"));
  const nameIdx = headerRow.findIndex((h: string) => h?.toLowerCase().includes("descripción"));
  const endDateIdx = headerRow.findIndex((h: string) => h?.toLowerCase().includes("fechafinvigencia"));

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[codeIdx]) continue;

    // Skip derogated entries
    if (endDateIdx >= 0 && row[endDateIdx]) {
      const endDate = new Date(row[endDateIdx]);
      if (endDate < new Date()) { skipped++; continue; }
    }

    const code = String(row[codeIdx]).trim();
    const name = String(row[nameIdx] || "").trim();
    if (!code || !name) { skipped++; continue; }

    // Look for keywords in "palabrasSimilares" column or use name as fallback
    let keywords = name;
    for (const [idx, col] of Object.entries(config.columns)) {
      if (col === "palabrasSimilares" && row[Number(idx)]) {
        keywords = String(row[Number(idx)]).trim();
      }
    }

    batch.push([code, name, keywords]);

    if (batch.length >= 500) {
      await insertBatch(config.table, batch);
      imported += batch.length;
      batch.length = 0;
      console.log(`  ${imported}/${rows.length - 1} (${skipped} derogados)`);
    }
  }

  if (batch.length > 0) {
    await insertBatch(config.table, batch);
    imported += batch.length;
  }

  console.log(`✅ ${sheetName}: ${imported} importados, ${skipped} derogados omitidos`);
}

async function insertBatch(table: string, rows: unknown[][]) {
  const values = rows.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(", ");
  const params = rows.flat();
  await sql.query(
    `INSERT INTO ${table} (code, name, keywords) VALUES ${values} ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, keywords = EXCLUDED.keywords`,
    params
  );
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: npx tsx scripts/import-sat-xls.ts <archivo.xls>");
    console.error("Descarga el XLS del SAT: https://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm");
    process.exit(1);
  }

  console.log(`📖 Leyendo ${filePath}...`);
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  console.log(`📚 Hojas: ${workbook.SheetNames.join(", ")}`);

  for (const sheetName of workbook.SheetNames) {
    if (SHEET_MAP[sheetName]) {
      await importSheet(workbook, sheetName);
    }
  }

  console.log("\n✅ Importacion completada");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
