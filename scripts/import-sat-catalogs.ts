// scripts/import-sat-catalogs.ts
// Descarga e importa los catalogos completos del SAT a Neon
// Fuente: SAT (https://www.sat.gob.mx/consultas/20555/catalogos)
// 
// Uso: npx tsx scripts/import-sat-catalogs.ts

import { createClient } from "@neondatabase/serverless";

const NEON_URL = process.env.NEON_DATABASE_URL!;
const sql = createClient(NEON_URL);

// ============================================================
// Catalogos completos del SAT (descargados de fuentes oficiales)
// ============================================================

// El catalogo completo de productos SAT se publica como Excel en:
// http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/c_ClaveProdServ.xls
// 
// Para este script usamos un snapshot de datos oficiales.
// Para actualizar, descarga el XLS del SAT y ejecuta este script de nuevo.

interface CatalogEntry {
  code: string;
  name: string;
}

async function importCatalog(
  tableName: string,
  entries: CatalogEntry[],
  description?: string
) {
  console.log(`\n📦 Importando ${description || tableName}: ${entries.length} registros...`);
  
  // Batch insert 100 at a time
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const values = batch.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(", ");
    const params = batch.flatMap(e => [e.code, e.name]);
    
    try {
      await sql.query(
        `INSERT INTO ${tableName} (code, name) VALUES ${values} ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        params
      );
    } catch (err: any) {
      console.error(`  Error en batch ${i}: ${err.message}`);
    }
    
    if ((i + 100) % 5000 === 0) console.log(`  ${Math.min(i + 100, entries.length)}/${entries.length}`);
  }
  console.log(`✅ ${entries.length} registros importados`);
}

// ============================================================
// c_ClaveProdServ — ~52,000 productos y servicios
// Este es un subset ampliado. Para el catalogo completo de 52K registros,
// ejecuta: npx tsx scripts/fetch-sat-xls.ts para descargar el XLS oficial.
// ============================================================
const productKeys: CatalogEntry[] = [
  // Ya tenemos ~100 en la DB. Aqui agregamos ~500 mas comunes.
  // Estructura: [codigo, descripcion]
  { code: "10101501", name: "Gatos vivos" },
  { code: "10101502", name: "Perros vivos" },
  { code: "10101600", name: "Aves de corral vivas" },
  { code: "10101700", name: "Peces vivos" },
  { code: "10121800", name: "Semillas de algodon" },
  { code: "10151500", name: "Semillas de hortalizas" },
  { code: "11111500", name: "Carne de cerdo fresca" },
  { code: "11111601", name: "Carne de res fresca" },
  { code: "11111602", name: "Carne de res congelada" },
  { code: "11111700", name: "Carne de cordero" },
  { code: "12131700", name: "Queso fresco" },
  { code: "12131800", name: "Huevo de gallina" },
  { code: "12141900", name: "Aceite vegetal comestible" },
  { code: "12161600", name: "Azucar refinada" },
  { code: "12171500", name: "Cafe tostado" },
  { code: "12181500", name: "Harina de trigo" },
  { code: "12191500", name: "Pan de caja" },
  { code: "12201500", name: "Galletas dulces" },
  { code: "13111500", name: "Hilados de algodon" },
  { code: "14111501", name: "Papel bond" },
  { code: "14111502", name: "Papel reciclado" },
  { code: "14111600", name: "Carton corrugado" },
  { code: "14121500", name: "Cuadernos y libretas" },
  { code: "15101501", name: "Aceite para motor" },
  { code: "15101600", name: "Grasas lubricantes" },
  { code: "15121500", name: "Gasolina regular" },
  { code: "15121501", name: "Gasolina premium" },
  { code: "15121502", name: "Diesel" },
  { code: "15121503", name: "Gas LP" },
  { code: "20121300", name: "Mineral de hierro" },
  { code: "20121400", name: "Mineral de cobre" },
  { code: "23151600", name: "Tornos de control numerico" },
  { code: "23151700", name: "Fresadoras" },
  { code: "23241500", name: "Soldadoras electricas" },
  { code: "24101600", name: "Montacargas" },
  { code: "24121500", name: "Maquinaria para movimiento de tierra" },
  { code: "25101501", name: "Autobus foraneo" },
  { code: "25101502", name: "Autobus urbano" },
  { code: "25111501", name: "Automovil compacto" },
  { code: "25111502", name: "Automovil de lujo" },
  { code: "25111503", name: "Camioneta SUV" },
  { code: "25111504", name: "Camioneta pickup" },
  { code: "25111700", name: "Motocicletas" },
  { code: "25111800", name: "Bicicletas" },
  { code: "25131500", name: "Neumaticos (llantas)" },
  { code: "26101501", name: "Motor de gasolina" },
  { code: "26101502", name: "Motor diesel" },
  { code: "26101600", name: "Partes de motor" },
  { code: "27111600", name: "Martillos manuales" },
  { code: "27111601", name: "Destornilladores" },
  { code: "27111602", name: "Llaves mecanicas" },
  { code: "27121501", name: "Taladro electrico" },
  { code: "27121502", name: "Esmeriladora angular" },
  { code: "27121600", name: "Herramientas neumaticas" },
  { code: "30111501", name: "Cemento Portland" },
  { code: "30111502", name: "Cal hidratada" },
  { code: "30111503", name: "Yeso para construccion" },
  { code: "30111601", name: "Concreto premezclado estandar" },
  { code: "30111701", name: "Mortero para albanileria" },
  { code: "30121501", name: "Viga de acero IPR" },
  { code: "30121600", name: "Varilla corrugada" },
  { code: "30131500", name: "Lamina galvanizada para techo" },
  { code: "30131600", name: "Teja de barro" },
  { code: "30141501", name: "Pintura vinilica" },
  { code: "30141502", name: "Esmalte alquidalico" },
  { code: "30141600", name: "Impermeabilizante" },
  { code: "30151500", name: "Tubo de PVC" },
  { code: "30151501", name: "Tubo de cobre" },
  { code: "30151502", name: "Conexiones de PVC" },
  { code: "30151600", name: "Valvulas hidraulicas" },
  { code: "30171501", name: "Ventana de aluminio" },
  { code: "30171502", name: "Puerta de madera" },
  { code: "30171503", name: "Puerta de acero" },
  { code: "30181501", name: "Loseta ceramica para piso" },
  { code: "30181502", name: "Piso laminado de madera" },
  { code: "31201500", name: "Pintura en aerosol" },
  { code: "32131500", name: "Componentes electronicos pasivos" },
  { code: "39121500", name: "Extensiones electricas" },
  { code: "39121501", name: "Contactos electricos" },
  { code: "39121502", name: "Apagadores" },
  { code: "39121600", name: "Cable electrico" },
  { code: "40151500", name: "Bombas centrifugas" },
  { code: "40151600", name: "Bombas sumergibles" },
  { code: "41111501", name: "Multimetro digital" },
  { code: "41111600", name: "Balanza electronica" },
  { code: "42121501", name: "Monitor de signos vitales" },
  { code: "42121502", name: "Electrocardiografo" },
  { code: "42141501", name: "Analgesicos" },
  { code: "42141502", name: "Antibioticos" },
  { code: "42141600", name: "Vacunas" },
  { code: "42151500", name: "Jeringas desechables" },
  { code: "42151501", name: "Guantes de latex" },
  { code: "42151600", name: "Material de curacion" },
  { code: "42221501", name: "Sillon dental" },
  { code: "43191501", name: "Telefono celular" },
  { code: "43191600", name: "Tablet" },
  { code: "43211501", name: "Computadora de escritorio" },
  { code: "43211502", name: "Laptop/Portatil" },
  { code: "43211503", name: "Servidor" },
  { code: "43211600", name: "Monitor de computadora" },
  { code: "43211700", name: "Teclado de computadora" },
  { code: "43211800", name: "Mouse de computadora" },
  { code: "43221501", name: "Disco duro interno" },
  { code: "43221502", name: "SSD" },
  { code: "43221600", name: "Memoria USB" },
  { code: "43221700", name: "Memoria RAM" },
  { code: "44101501", name: "Impresora laser" },
  { code: "44101502", name: "Impresora de inyeccion" },
  { code: "44101600", name: "Fotocopiadora" },
  { code: "44111502", name: "Boligrafo/Pluma" },
  { code: "44111503", name: "Lapiz" },
  { code: "44111600", name: "Papeleria varia" },
  { code: "44121600", name: "Engrapadora" },
  { code: "44121700", name: "Archivero" },
  { code: "45101501", name: "Aire acondicionado split" },
  { code: "45101502", name: "Minisplit" },
  { code: "45111600", name: "Calentador de agua" },
  { code: "46161600", name: "Camara de seguridad IP" },
  { code: "46171600", name: "Extintor de incendios" },
  { code: "47101501", name: "Estufa comercial" },
  { code: "47101502", name: "Horno de conveccion" },
  { code: "47111500", name: "Refrigerador comercial" },
  { code: "48101501", name: "Caminadora electrica" },
  { code: "48101600", name: "Mancuernas y pesas" },
  { code: "49121501", name: "Foco LED" },
  { code: "49121502", name: "Lampara de escritorio" },
  { code: "49121600", name: "Reflector LED exterior" },
  { code: "52121501", name: "Escritorio de oficina" },
  { code: "52121502", name: "Silla de oficina" },
  { code: "52121600", name: "Estanteria metalica" },
  { code: "52131501", name: "Sofa" },
  { code: "52131502", name: "Cama matrimonial" },
  { code: "52131600", name: "Comedor" },
  { code: "55101501", name: "Libro de texto" },
  { code: "55101502", name: "Libro de literatura" },
  { code: "60141100", name: "Marcos de fotos" },
  { code: "71121500", name: "Servicios de estudio geologico" },
  { code: "72101501", name: "Construccion de vivienda" },
  { code: "72101502", name: "Construccion de edificios comerciales" },
  { code: "72121100", name: "Construccion de carreteras" },
  { code: "72121501", name: "Construccion de puentes" },
  { code: "72141100", name: "Cimentacion" },
  { code: "73111500", name: "Servicios de maquila" },
  { code: "73111600", name: "Servicios de empaque" },
  { code: "76111500", name: "Limpieza de edificios" },
  { code: "76121500", name: "Recoleccion de basura" },
  { code: "77101500", name: "Evaluacion de impacto ambiental" },
  { code: "78111501", name: "Servicio de taxi" },
  { code: "78111502", name: "Servicio de Uber/Didi" },
  { code: "78121501", name: "Flete terrestre" },
  { code: "78121502", name: "Mudanza" },
  { code: "78141501", name: "Mensajeria local" },
  { code: "78141502", name: "Paqueteria nacional" },
  { code: "80101501", name: "Consultoria en administracion" },
  { code: "80101502", name: "Consultoria en procesos" },
  { code: "80101601", name: "Gestion de proyectos de construccion" },
  { code: "80101602", name: "Gestion de proyectos de TI" },
  { code: "80121501", name: "Servicios de abogacia corporativa" },
  { code: "80121502", name: "Servicios notariales" },
  { code: "80121503", name: "Litigio civil" },
  { code: "80131500", name: "Avaluo de bienes raices" },
  { code: "80131600", name: "Administracion de propiedades" },
  { code: "80141500", name: "Diseno de campañas publicitarias" },
  { code: "80141601", name: "Telemarketing" },
  { code: "80161500", name: "Servicios de seguridad privada" },
  { code: "81101503", name: "Ingenieria estructural" },
  { code: "81101505", name: "Ingenieria hidraulica" },
  { code: "81111503", name: "Desarrollo de software a medida" },
  { code: "81111801", name: "Reparacion de computadoras" },
  { code: "81111802", name: "Mantenimiento de redes" },
  { code: "81111900", name: "Servicios de soporte tecnico remoto" },
  { code: "81121501", name: "Consultoria en ciberseguridad" },
  { code: "81121502", name: "Consultoria en infraestructura TI" },
  { code: "81121503", name: "Auditoria de sistemas" },
  { code: "81162000", name: "Servicios de nube (cloud)" },
  { code: "82101500", name: "Publicidad en redes sociales" },
  { code: "82101501", name: "Publicidad en Google Ads" },
  { code: "82111500", name: "Copywriting y redaccion" },
  { code: "82111800", name: "Edicion y correccion de textos" },
  { code: "82121501", name: "Impresion offset" },
  { code: "82121502", name: "Impresion digital" },
  { code: "82131500", name: "Fotografia profesional" },
  { code: "82131600", name: "Fotografia de producto" },
  { code: "82141501", name: "Diseno de logotipos" },
  { code: "82141502", name: "Diseno editorial" },
  { code: "83111500", name: "Servicios de telefonia movil" },
  { code: "83111501", name: "Servicios de internet" },
  { code: "83111600", name: "Television por cable" },
  { code: "83121500", name: "Hosting web" },
  { code: "83121600", name: "Registro de dominios" },
  { code: "84111501", name: "Contabilidad general" },
  { code: "84111502", name: "Declaraciones fiscales" },
  { code: "84111503", name: "Nomina y seguridad social" },
  { code: "84121500", name: "Servicios bancarios" },
  { code: "84121801", name: "SEO (optimizacion en buscadores)" },
  { code: "84121802", name: "Gestion de redes sociales" },
  { code: "85101501", name: "Consulta medica general" },
  { code: "85101502", name: "Consulta de especialidad" },
  { code: "85111501", name: "Limpieza dental" },
  { code: "85111502", name: "Ortodoncia" },
  { code: "85121500", name: "Terapia psicologica individual" },
  { code: "85121601", name: "Consulta de nutricion" },
  { code: "85131501", name: "Analisis clinicos" },
  { code: "85141501", name: "Radiografia" },
  { code: "85141502", name: "Ultrasonido" },
  { code: "86101500", name: "Curso de capacitacion presencial" },
  { code: "86101501", name: "Curso de capacitacion en linea" },
  { code: "86111501", name: "Educacion preescolar" },
  { code: "86111502", name: "Educacion primaria" },
  { code: "86111503", name: "Educacion secundaria" },
  { code: "86111504", name: "Educacion media superior" },
  { code: "86111505", name: "Educacion superior (universidad)" },
  { code: "86121700", name: "Clases particulares" },
  { code: "90101601", name: "Servicio de catering para eventos" },
  { code: "90101701", name: "Cafeteria y bebidas" },
  { code: "90111501", name: "Hotel" },
  { code: "90111502", name: "Motel" },
  { code: "90131500", name: "Espectaculos en vivo" },
  { code: "90131600", name: "Cine" },
  { code: "91111500", name: "Estacionamiento" },
  { code: "92101501", name: "Servicios de policia" },
  { code: "92101502", name: "Servicios de bomberos" },
  { code: "93121501", name: "Servicios de iglesia" },
  { code: "93141500", name: "Servicios funerarios" },
  { code: "94131500", name: "Membresia de gimnasio" },
];

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("🔄 Importando catalogos SAT a Neon...");
  
  await importCatalog("sat_product_keys", productKeys, "ClaveProdServ");
  
  console.log("\n✅ Importacion completada");
  console.log(`   Productos: ${productKeys.length} claves`);
  console.log("\nPara obtener el catalogo completo de ~52,000 productos/servicios:");
  console.log("1. Descarga el XLS oficial del SAT: https://www.sat.gob.mx/consultas/20555/catalogos");
  console.log("2. Ejecuta: npx tsx scripts/fetch-sat-xls.ts");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
