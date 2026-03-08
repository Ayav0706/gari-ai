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

    /** Small delay to let rate-limited APIs recover before trying next provider */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        let lastError: any = null;

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];
            const maxAttempts = provider.name === "Groq" ? 3 : 1;
            let attempt = 0;

            while (attempt < maxAttempts) {
                attempt++;
            try {
                return await provider.chat(messages, tools);
            } catch (error: any) {
                lastError = error;

                // Special case: Groq's tool_use_failed bug (happens with accented Spanish chars).
                // Retry the SAME provider without tools so the user gets a text response.
                if (error.isToolUseFailed && tools && tools.length > 0) {
                    logger.warn(`⚠️ ${provider.name} tool_use_failed — retrying without tools...`);
                    try {
                        return await provider.chat(messages, undefined);
                    } catch (retryError: any) {
                        lastError = retryError;
                        logger.warn(`⚠️ ${provider.name} retry also failed. Trying next provider...`);
                        continue;
                    }
                }

                // If it's a rate limit (429), a temporary service error (500/503/etc),
                // OR a bad request (400) — we try the next provider in the chain.
                const status = error.statusCode || error.status || 0;
                const isRateLimit = status === 429 || error.message?.includes("429") || error.isRateLimit;
                const isServiceError = status >= 500 || error.message?.includes("500");
                const isBadRequest = status === 400 || error.message?.includes("400");
                const isAuthError = status === 401 || status === 403 || error.message?.includes("401") || error.message?.includes("403");

                if (isRateLimit || isServiceError || isBadRequest) {
                    // Backoff: wait before trying next provider (longer for rate limits)
                    if (isRateLimit && attempt < maxAttempts) {
                        const retryDelay = 1500 * attempt;
                        logger.warn(`⚠️ ${provider.name} rate-limited (${status || "429"}). Retry ${attempt}/${maxAttempts} in ${retryDelay}ms...`);
                        await this.sleep(retryDelay);
                        continue;
                    }
                    const delay = isRateLimit ? 2000 : 1000;
                    logger.warn(`⚠️ ${provider.name} failed (${status || "Error"}). Waiting ${delay}ms before next provider...`);
                    await this.sleep(delay);
                    break;
                }

                // Auth errors should not kill the full chain; skip to next provider.
                if (isAuthError) {
                    logger.warn(`⚠️ ${provider.name} auth failed (${status || "auth error"}). Skipping provider.`);
                    break;
                }

                // Unknown errors: keep existing behavior (fail fast).
                throw error;
            }
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
    providers.push(new GroqProvider(config.GROQ_API_KEY, config.GROQ_MODEL));

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
