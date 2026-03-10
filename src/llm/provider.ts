// ============================================
// GARI – LLM Provider Factory
// ============================================
// Creates the primary (Groq) provider with automatic
// fallback to OpenRouter when rate limited.

import { config } from "../config.js";
import { logger } from "../logger.js";
import { GroqProvider } from "./groq.js";
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
    private readonly providerCooldowns = new Map<string, number>();
    private readonly providerFailures = new Map<string, number>();
    private readonly incidents: Array<{
        ts: string;
        provider: string;
        category: string;
        status: number;
        action: string;
        detail: string;
    }> = [];
    private readonly MAX_INCIDENTS = 80;

    constructor(providers: LLMProvider[]) {
        this.providers = providers.filter(p => p !== null);
    }

    /** Small delay to let rate-limited APIs recover before trying next provider */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getErrorStatus(error: any): number {
        const explicit = error?.statusCode || error?.status;
        if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
        const message = String(error?.message || "");
        const match = message.match(/\b([1-5]\d{2})\b/);
        if (match) return Number(match[1]);
        return 0;
    }

    private classifyError(error: any): "rate_limit" | "auth" | "service" | "bad_request" | "tool_use_failed" | "unknown" {
        const status = this.getErrorStatus(error);
        const message = String(error?.message || "").toLowerCase();
        if (error?.isToolUseFailed || message.includes("tool_use_failed")) return "tool_use_failed";
        if (status === 429 || message.includes("429") || error?.isRateLimit) return "rate_limit";
        if (status === 401 || status === 403 || message.includes("401") || message.includes("403")) return "auth";
        if (
            status >= 500 ||
            status === 408 ||
            status === 404 ||
            message.includes("500") ||
            message.includes("503") ||
            message.includes("timeout") ||
            message.includes("no endpoints found")
        ) return "service";
        if (status === 400 || status === 422 || message.includes("400") || message.includes("invalid_request")) return "bad_request";
        return "unknown";
    }

    private setCooldown(providerName: string, ms: number): void {
        const until = Date.now() + ms;
        this.providerCooldowns.set(providerName, until);
    }

    private isCoolingDown(providerName: string): boolean {
        const until = this.providerCooldowns.get(providerName) ?? 0;
        return until > Date.now();
    }

    private recordIncident(
        provider: string,
        category: string,
        status: number,
        action: string,
        detail: string
    ): void {
        this.incidents.push({
            ts: new Date().toISOString(),
            provider,
            category,
            status,
            action,
            detail: detail.slice(0, 260),
        });
        if (this.incidents.length > this.MAX_INCIDENTS) {
            this.incidents.shift();
        }
        logger.warn("🛠️ Self-heal incident", {
            provider,
            category,
            status,
            action,
            detail: detail.slice(0, 140),
        });
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        let lastError: any = null;

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i];
            if (this.isCoolingDown(provider.name)) {
                continue;
            }

            const maxAttempts = provider.name === "Groq" ? 3 : 1;
            let attempt = 0;

            while (attempt < maxAttempts) {
                attempt++;
                try {
                    return await provider.chat(messages, tools);
                } catch (error: any) {
                    lastError = error;
                    const status = this.getErrorStatus(error);
                    const category = this.classifyError(error);
                    const failCount = (this.providerFailures.get(provider.name) ?? 0) + 1;
                    this.providerFailures.set(provider.name, failCount);

                    // If tool-calling degrades, retry same provider without tools.
                    if ((category === "tool_use_failed" || category === "bad_request") && tools && tools.length > 0) {
                        this.recordIncident(
                            provider.name,
                            category,
                            status,
                            "retry_without_tools",
                            String(error?.message || "tool call failed")
                        );
                        try {
                            return await provider.chat(messages, undefined);
                        } catch (retryError: any) {
                            lastError = retryError;
                            this.recordIncident(
                                provider.name,
                                this.classifyError(retryError),
                                this.getErrorStatus(retryError),
                                "fallback_next_provider",
                                String(retryError?.message || "retry without tools failed")
                            );
                            break;
                        }
                    }

                    if (category === "rate_limit") {
                        if (attempt < maxAttempts) {
                            const retryDelay = 1200 * attempt;
                            this.recordIncident(
                                provider.name,
                                category,
                                status,
                                `retry_same_provider_${attempt}`,
                                String(error?.message || "rate limit")
                            );
                            await this.sleep(retryDelay);
                            continue;
                        }
                        this.setCooldown(provider.name, 30_000);
                        this.recordIncident(
                            provider.name,
                            category,
                            status,
                            "cooldown_30s_fallback_next_provider",
                            String(error?.message || "rate limit")
                        );
                        break;
                    }

                    if (category === "auth") {
                        this.setCooldown(provider.name, 10 * 60_000);
                        this.recordIncident(
                            provider.name,
                            category,
                            status,
                            "disable_provider_10m_fallback_next_provider",
                            String(error?.message || "auth error")
                        );
                        break;
                    }

                    if (category === "service") {
                        this.setCooldown(provider.name, 60_000);
                        this.recordIncident(
                            provider.name,
                            category,
                            status,
                            "cooldown_60s_fallback_next_provider",
                            String(error?.message || "service error")
                        );
                        break;
                    }

                    if (category === "bad_request") {
                        this.recordIncident(
                            provider.name,
                            category,
                            status,
                            "fallback_next_provider",
                            String(error?.message || "bad request")
                        );
                        break;
                    }

                    // Unknown errors on external providers should degrade to the next provider.
                    // This avoids dropping to local contingency for transient provider quirks.
                    this.recordIncident(
                        provider.name,
                        category,
                        status,
                        "fallback_next_provider_unknown",
                        String(error?.message || "unknown error")
                    );
                    this.setCooldown(provider.name, 45_000);
                    break;
                }
            }
        }

        // Last-resort degradation: if tools were enabled, retry once without tools on the whole chain.
        if (tools && tools.length > 0) {
            try {
                this.recordIncident(
                    "FailoverChain",
                    "unknown",
                    this.getErrorStatus(lastError),
                    "global_retry_without_tools",
                    "all providers failed with tools"
                );
                return await this.chat(messages, undefined);
            } catch {
                // Continue to throw original error below.
            }
        }

        throw lastError;
    }

    getSelfHealStatus(): {
        providerCooldowns: Record<string, number>;
        providerFailures: Record<string, number>;
        recentIncidents: Array<{ ts: string; provider: string; category: string; status: number; action: string; detail: string }>;
    } {
        const now = Date.now();
        const cooldowns: Record<string, number> = {};
        for (const [provider, until] of this.providerCooldowns.entries()) {
            if (until > now) {
                cooldowns[provider] = until - now;
            }
        }
        const failures: Record<string, number> = {};
        for (const [provider, count] of this.providerFailures.entries()) {
            failures[provider] = count;
        }
        return {
            providerCooldowns: cooldowns,
            providerFailures: failures,
            recentIncidents: this.incidents.slice(-10),
        };
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
        const configuredModel = config.OPENROUTER_MODEL?.trim() || "";
        const reliabilityFallbacks = [
            "google/gemini-2.0-flash-001",
            "openai/gpt-4o-mini",
            "mistralai/mistral-small-3.2-24b-instruct",
            "qwen/qwen-2.5-72b-instruct",
            "anthropic/claude-3.5-haiku",
            "meta-llama/llama-3.3-70b-instruct:free",
        ] as const;

        const openRouterChain = [
            ...(configuredModel ? [configuredModel] : []),
            ...reliabilityFallbacks,
        ].filter((model, idx, arr) => arr.indexOf(model) === idx);

        for (const model of openRouterChain) {
            providers.push(new OpenRouterProvider(config.OPENROUTER_API_KEY, model));
        }
    }

    const chainNames = providers.map(p => p.name).join(" \u2192 ");
    logger.info(`🤖 LLM Intelligence Chain: ${chainNames}`);

    return new FailoverProvider(providers);
}
