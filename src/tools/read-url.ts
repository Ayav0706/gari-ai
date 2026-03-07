// ============================================
// GARI – Read URL Tool
// ============================================
// Fetches a URL and extracts clean text content.
// Uses HTML → plain text conversion for LLM consumption.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

const DEFAULT_MAX_LENGTH = 4000;

/**
 * Strip HTML tags and collapse whitespace into readable plain text.
 * Intentionally simple — no dependency on heavy DOM parsers.
 */
function htmlToText(html: string): string {
    return html
        // Remove script/style blocks entirely
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        // Convert common block elements to newlines
        .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        // Strip remaining tags
        .replace(/<[^>]+>/g, "")
        // Decode common HTML entities
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        // Collapse whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export const readUrlTool: ToolDefinition = {
    name: "read_url",
    description:
        "Fetch a web page and extract its text content. Use this to read articles, documentation, or any web page the user shares.",
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The full URL to fetch (must start with http:// or https://).",
            },
            max_length: {
                type: "number",
                description: `Maximum characters to return (default: ${DEFAULT_MAX_LENGTH}).`,
            },
        },
        required: ["url"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const url = args.url as string;
        const maxLength = (args.max_length as number) || DEFAULT_MAX_LENGTH;

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return "Error: URL must start with http:// or https://";
        }

        logger.info(`🌐 Reading URL: ${url}`);

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);

            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "Gari-Bot/1.0 (AI Assistant)",
                    Accept: "text/html,application/xhtml+xml,text/plain",
                },
            });
            clearTimeout(timeout);

            if (!res.ok) {
                return `Error: HTTP ${res.status} ${res.statusText}`;
            }

            const contentType = res.headers.get("content-type") || "";
            const rawBody = await res.text();

            // Plain text or JSON — return directly
            if (contentType.includes("text/plain") || contentType.includes("application/json")) {
                return rawBody.slice(0, maxLength);
            }

            // HTML — convert to readable text
            const text = htmlToText(rawBody);
            if (!text) return "The page returned no readable text content.";

            const truncated = text.slice(0, maxLength);
            const suffix = text.length > maxLength ? "\n\n[... content truncated]" : "";

            return `Content from ${url}:\n\n${truncated}${suffix}`;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return `Error: Request timed out after 15 seconds for ${url}`;
            }
            return `Error reading URL: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
