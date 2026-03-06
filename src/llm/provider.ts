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
 * LLM provider with automatic failover.
 * Tries Groq first; on 429 rate limit, falls back to OpenRouter.
 */
class FailoverProvider implements LLMProvider {
    readonly name = "Failover(Groq→OpenRouter)";
    private primary: GroqProvider;
    private fallback: OpenRouterProvider | null;

    constructor(primary: GroqProvider, fallback: OpenRouterProvider | null) {
        this.primary = primary;
        this.fallback = fallback;
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        try {
            return await this.primary.chat(messages, tools);
        } catch (error) {
            // Only fallback on rate limits
            if (error instanceof GroqError && error.isRateLimit && this.fallback) {
                logger.warn("⚠️  Groq rate limited. Switching to OpenRouter fallback.");
                return await this.fallback.chat(messages, tools);
            }
            throw error;
        }
    }

    async transcribeAudio(audioBuffer: Uint8Array, filename: string): Promise<string> {
        if (this.primary.transcribeAudio) {
            return await this.primary.transcribeAudio(audioBuffer, filename);
        }
        throw new Error("Audio transcription not supported by primary provider.");
    }
}

/**
 * Creates the configured LLM provider.
 */
export function createLLMProvider(): LLMProvider {
    const groq = new GroqProvider(config.GROQ_API_KEY);

    let fallback: OpenRouterProvider | null = null;
    if (config.OPENROUTER_API_KEY) {
        fallback = new OpenRouterProvider(config.OPENROUTER_API_KEY, config.OPENROUTER_MODEL);
    }

    if (config.KIMI_API_KEY) {
        logger.info("🤖 LLM: Groq (primary) + OpenRouter (fallback) + Kimi (integrated)");
    } else {
        logger.info(`🤖 LLM: Groq (primary) ${fallback ? "+ OpenRouter (fallback)" : ""}`);
    }

    return new FailoverProvider(groq, fallback);
}
