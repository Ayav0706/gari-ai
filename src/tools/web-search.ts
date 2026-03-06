// ============================================
// GARI – Web Search Tool (DuckDuckGo)
// ============================================
// Searches the web using DuckDuckGo's API.
// No API key required.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

export const webSearchTool: ToolDefinition = {
    name: "search_web",
    description:
        "Busca información actualizada en todo Internet. Usa esta herramienta cuando el usuario pregunte algo que necesite datos recientes, noticias, o información que Wikipedia no tenga.",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "La búsqueda a realizar en Internet. Sé específico.",
            },
        },
        required: ["query"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const query = args.query as string;
        logger.info(`🌐 Web search: "${query}"`);

        try {
            // DuckDuckGo Instant Answer API
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const res = await fetch(url);

            if (!res.ok) {
                return `Error en la búsqueda web (${res.status}).`;
            }

            const data = await res.json() as any;
            const results: string[] = [];

            // Abstract (main answer)
            if (data.AbstractText) {
                results.push(`📋 ${data.AbstractSource}: ${data.AbstractText}`);
                if (data.AbstractURL) results.push(`🔗 ${data.AbstractURL}`);
            }

            // Answer (direct answer)
            if (data.Answer) {
                results.push(`✅ Respuesta: ${data.Answer}`);
            }

            // Related topics
            if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                results.push("\n📌 Temas relacionados:");
                for (const topic of data.RelatedTopics.slice(0, 5)) {
                    if (topic.Text) {
                        results.push(`• ${topic.Text}`);
                        if (topic.FirstURL) results.push(`  🔗 ${topic.FirstURL}`);
                    }
                }
            }

            // If we got some results
            if (results.length > 0) {
                return results.join("\n");
            }

            // Fallback: try a simple HTML scrape of DuckDuckGo lite
            const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            const liteRes = await fetch(liteUrl, {
                headers: { "User-Agent": "Gari-AI/1.0" }
            });

            if (liteRes.ok) {
                const html = await liteRes.text();
                // Extract text snippets from the result links
                const snippets = html.match(/<td class="result-snippet">(.*?)<\/td>/gs);
                if (snippets && snippets.length > 0) {
                    const cleanSnippets = snippets.slice(0, 5).map(s =>
                        s.replace(/<[^>]+>/g, '').trim()
                    );
                    return `🌐 Resultados web para "${query}":\n\n${cleanSnippets.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}`;
                }
            }

            return `No se encontraron resultados web para "${query}". Intenta reformular la búsqueda.`;
        } catch (error) {
            logger.error(`Web search error: ${error}`);
            return `Error al buscar en la web: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
