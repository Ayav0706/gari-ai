import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

export const searchWebTool: ToolDefinition = {
    name: "search_wikipedia",
    description: "Search Wikipedia for a physical person, place, or concept to get updated information.",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The term to search for (e.g. 'Nemesio Oseguera Cervantes')",
            },
        },
        required: ["query"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const query = args.query as string;
        logger.info(`Searching Wikipedia for: ${query}`);

        try {
            // First search for the article title
            const searchRes = await fetch(`https://es.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`);
            if (!searchRes.ok) return "Error searching Wikipedia.";

            const searchData = await searchRes.json();
            const titles = searchData[1];
            if (!titles || titles.length === 0) {
                return `No se encontraron resultados en Wikipedia para '${query}'.`;
            }

            const title = titles[0];

            // Get extract
            const extractRes = await fetch(`https://es.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=5&exlimit=1&titles=${encodeURIComponent(title)}&explaintext=1&formatversion=2&format=json`);
            const extractData = await extractRes.json();

            const pages = extractData.query.pages;
            const pageId = Object.keys(pages)[0];
            const extract = pages[pageId].extract;

            if (!extract) return `Sin información para '${query}'.`;

            return `Wikipedia (${title}):\n${extract}`;
        } catch (error) {
            return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
