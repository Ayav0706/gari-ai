// ============================================
// GARI – OpenRouter LLM Provider (Fallback)
// ============================================
// Used only when Groq hits rate limits or is unavailable.
// Configurable model via OPENROUTER_MODEL env var.

import { logger } from "../logger.js";
import type { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, ToolSchema } from "../types.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterProvider implements LLMProvider {
    readonly name: string;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string) {
        this.apiKey = apiKey;
        this.model = model;
        this.name = `OpenRouter(${model})`;
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: messages.map((m) => this.formatMessage(m)),
            temperature: 0.7,
            max_tokens: 2048,
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }

        const res = await fetch(OPENROUTER_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://gari.local",
                "X-Title": "Gari AI Agent",
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error(`OpenRouter API error (${res.status}):`, { error: errorText });
            throw new OpenRouterError(`OpenRouter API returned ${res.status}: ${errorText}`, res.status);
        }

        const data = await res.json() as OpenRouterRawResponse;
        const choice = data.choices[0];

        const toolCalls: LLMToolCall[] | undefined = choice.message.tool_calls?.map(
            (tc: OpenRouterRawToolCall) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            })
        );

        return {
            message: {
                role: "assistant",
                content: choice.message.content ?? null,
                tool_calls: toolCalls,
            },
            finish_reason: choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
            usage: data.usage
                ? {
                    prompt_tokens: data.usage.prompt_tokens,
                    completion_tokens: data.usage.completion_tokens,
                    total_tokens: data.usage.total_tokens,
                }
                : undefined,
        };
    }

    private formatMessage(msg: LLMMessage): Record<string, unknown> {
        const formatted: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        };
        if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;
        if (msg.name) formatted.name = msg.name;
        return formatted;
    }
}

export class OpenRouterError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "OpenRouterError";
    }
}

// ── Raw API types ───────────────────────────

interface OpenRouterRawToolCall {
    id: string;
    type: string;
    function: { name: string; arguments: string };
}

interface OpenRouterRawResponse {
    choices: Array<{
        message: {
            role: string;
            content: string | null;
            tool_calls?: OpenRouterRawToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
