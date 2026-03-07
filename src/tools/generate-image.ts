// ============================================
// GARI – Generate Image Tool
// ============================================
// Uses Pollinations.ai free API — no API key required.
// Returns a URL that Telegram can display inline.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

export const generateImageTool: ToolDefinition = {
    name: "generate_image",
    description:
        "Generate an AI image from a text prompt using Pollinations.ai (free, no API key). " +
        "Returns a direct image URL. Use when the user asks for an image, illustration, artwork, or visual.",
    parameters: {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "Detailed English description of the image to generate.",
            },
            width: {
                type: "number",
                description: "Image width in pixels (default: 1024).",
            },
            height: {
                type: "number",
                description: "Image height in pixels (default: 1024).",
            },
        },
        required: ["prompt"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const prompt = args.prompt as string;
        const width = (args.width as number) || 1024;
        const height = (args.height as number) || 1024;

        if (!prompt.trim()) return "Error: No prompt provided.";

        logger.info(`🎨 Generating image: "${prompt.slice(0, 80)}..."`);

        try {
            // Pollinations.ai generates on-the-fly via URL parameters.
            // We ping the URL first to ensure the image is actually generated
            // before returning the link (it generates on first request).
            const encodedPrompt = encodeURIComponent(prompt);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

            // Pre-warm: make a HEAD request so the image starts generating
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000);

            const res = await fetch(imageUrl, {
                method: "HEAD",
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                return `Error: Image generation failed (HTTP ${res.status}).`;
            }

            return (
                `🎨 Image generated successfully!\n\n` +
                `**Prompt:** ${prompt}\n` +
                `**Size:** ${width}x${height}\n` +
                `**URL:** ${imageUrl}\n\n` +
                `Send this URL directly to show the image to the user.`
            );
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return "Error: Image generation timed out after 30 seconds.";
            }
            return `Error generating image: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
