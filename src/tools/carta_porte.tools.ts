import { z } from "zod";
import type { McpServerTool } from "../lib/types.js";
import * as facturapi from "../lib/facturapi-client.js";

export const cartaPorteTools: McpServerTool[] = [
  {
    name: "find_transport_methods",
    description: "Busca codigos de transporte aereo para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional().describe("Filtro de busqueda"),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchTransport({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "find_packaging_types",
    description: "Busca tipos de empaque para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchPackaging({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "find_hazardous_materials",
    description: "Busca clasificaciones de materiales peligrosos para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchHazardousMaterials({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "find_customs_documents",
    description: "Busca tipos de documentos aduaneros para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchCustomsDocuments({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "find_shipping_containers",
    description: "Busca tipos de contenedores maritimos para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchContainers({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
  {
    name: "find_ports_and_stations",
    description: "Busca estaciones y puertos para Carta Porte.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().optional(),
    },
    handler: async (input) => {
      try {
        const result = await facturapi.cartaPorte.searchPorts({ q: input.query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];

export const foreignTradeTools: McpServerTool[] = [
  {
    name: "find_tariff_code",
    description: "Busca fracciones arancelarias para Comercio Exterior por descripcion o codigo.",
    inputSchema: {
      account_id: z.string(),
      query: z.string().describe("Descripcion o codigo de fraccion arancelaria a buscar"),
    },
    handler: async ({ account_id, query }) => {
      try {
        const result = await facturapi.foreignTrade.searchTariffFractions({ q: query }) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ query, results: result }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: err instanceof Error ? err.message : "Error" }) }] };
      }
    },
  },
];
