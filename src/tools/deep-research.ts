// ============================================
// GARI – Deep Research Tool
// ============================================
// Multi-source research: DuckDuckGo Instant Answers + Wikipedia.
// Returns a structured research report.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

interface DuckDuckGoResult {
    AbstractText?: string;
    AbstractSource?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
}

/**
 * Query DuckDuckGo Instant Answer API (free, no key needed).
 */
async function queryDDG(topic: string): Promise<DuckDuckGoResult | null> {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        return (await res.json()) as DuckDuckGoResult;
    } catch {
        return null;
    }
}

/**
 * Query Wikipedia API for a detailed summary.
 */
async function queryWikipedia(topic: string): Promise<string | null> {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&format=json`;
        const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
        if (!searchRes.ok) return null;

        const searchData = (await searchRes.json()) as unknown[];
        const titles = searchData[1] as string[];
        if (!titles?.length) return null;

        const title = titles[0];
        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exsentences=8&exlimit=1&titles=${encodeURIComponent(title)}&explaintext=1&formatversion=2&format=json`;
        const extractRes = await fetch(extractUrl, { signal: AbortSignal.timeout(8_000) });
        const extractData = (await extractRes.json()) as any;

        return extractData?.query?.pages?.[0]?.extract || null;
    } catch {
        return null;
    }
}

export const deepResearchTool: ToolDefinition = {
    name: "deep_research",
    description:
        "Perform multi-source research on a topic. Queries DuckDuckGo and Wikipedia " +
        "to build a structured research report. Use for in-depth questions, learning about " +
        "concepts, or when the user needs thorough information on a topic.",
    parameters: {
        type: "object",
        properties: {
            topic: {
                type: "string",
                description: "The topic or question to research.",
            },
        },
        required: ["topic"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const topic = args.topic as string;

        logger.info(`🔬 Deep research on: "${topic}"`);

        // Run queries in parallel for speed
        const [ddg, wiki] = await Promise.all([
            queryDDG(topic),
            queryWikipedia(topic),
        ]);

        const sections: string[] = [];
        sections.push(`🔬 **Research Report: ${topic}**\n`);

        // DuckDuckGo abstract
        if (ddg?.AbstractText) {
            sections.push(`**📖 Summary (${ddg.AbstractSource || "DuckDuckGo"}):**`);
            sections.push(ddg.AbstractText);
            if (ddg.AbstractURL) sections.push(`Source: ${ddg.AbstractURL}`);
        }

        // Wikipedia
        if (wiki) {
            sections.push(`\n**📚 Wikipedia:**`);
            sections.push(wiki);
        }

        // Related topics from DDG
        if (ddg?.RelatedTopics && ddg.RelatedTopics.length > 0) {
            const related = ddg.RelatedTopics
                .filter((t) => t.Text)
                .slice(0, 5)
                .map((t) => `• ${t.Text}`)
                .join("\n");

            if (related) {
                sections.push(`\n**🔗 Related Topics:**`);
                sections.push(related);
            }
        }

        // If we got nothing useful
        if (sections.length <= 1) {
            return `No se encontró información detallada sobre "${topic}". Intenta reformular la búsqueda o usa un término más específico.`;
        }

        return sections.join("\n");
    },
};
