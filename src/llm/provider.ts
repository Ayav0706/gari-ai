// ============================================
// GARI – LLM Provider Factory
// ============================================
// Creates the primary (Groq) provider with automatic
// fallback to OpenRouter when rate limited.

import { config } from "../config.js";
import { logger } from "../logger.js";
import { GroqProvider, GroqError } from "./groq.js";
import { OpenRouterProvider } from "./openrouter.js";
import { KimiProvider } from "./kimi.js";
import type { LLMMessage, LLMProvider, LLMResponse, ToolSchema } from "../types.js";

/**
 * LLM provider with multi-stage failover.
 * Tries providers in order; on rate limit or technical failure, tries the next one.
 */
class FailoverProvider implements LLMProvider {
    readonly name = "FailoverChain";
    private providers: LLMProvider[];

    constructor(providers: LLMProvider[]) {
        this.providers = providers.filter(p => p !== null);
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        let lastError: any = null;

        for (const provider of this.providers) {
            try {
                return await provider.chat(messages, tools);
            } catch (error: any) {
                lastError = error;
                // If it's a rate limit (429) or a temporary service error (500/503/etc)
                // we try the next provider in the chain.
                const isRateLimit = error.status === 429 || error.message?.includes("429") || error.isRateLimit;
                const isServiceError = error.status >= 500 || error.message?.includes("500");

                if (isRateLimit || isServiceError) {
                    logger.warn(`⚠️ ${provider.name} failed (${error.status || 'Error'}). Trying next provider...`);
                    continue;
                }
                // If it's a validation error (400) or something else, we might want to fail fast
                throw error;
            }
        }
        throw lastError;
    }

    async transcribeAudio(audioBuffer: Uint8Array, filename: string): Promise<string> {
        // We use the first provider that supports transcription (usually Groq)
        for (const provider of this.providers) {
            if (provider.transcribeAudio) {
                try {
                    return await provider.transcribeAudio(audioBuffer, filename);
                } catch (e) {
                    logger.error(`Audio transcription failed on ${provider.name}`);
                }
            }
        }
        throw new Error("No provider available for audio transcription.");
    }
}

export function createLLMProvider(): LLMProvider {
    const providers: LLMProvider[] = [];

    // 1. Groq (Primary)
    providers.push(new GroqProvider(config.GROQ_API_KEY));

    // 2. Kimi (Integrated deeper fallback)
    if (config.KIMI_API_KEY) {
        providers.push(new KimiProvider(config.KIMI_API_KEY));
    }

    // 3. OpenRouter (Final fallback)
    if (config.OPENROUTER_API_KEY) {
        providers.push(new OpenRouterProvider(config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL));
    }

    const chainNames = providers.map(p => p.name).join(" \u2192 ");
    logger.info(`🤖 LLM Intelligence Chain: ${chainNames}`);

    return new FailoverProvider(providers);
}
