// ============================================
// GARI – Groq LLM Provider (Primary)
// ============================================
// Direct fetch to Groq's OpenAI-compatible API.
// Model: llama-3.3-70b-versatile (free tier).

import { logger } from "../logger.js";
import type { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, ToolSchema } from "../types.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

export class GroqProvider implements LLMProvider {
    readonly name = "Groq";
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse> {
        const body: Record<string, unknown> = {
            model: GROQ_MODEL,
            messages: messages.map((m) => this.formatMessage(m)),
            temperature: 0.7,
            max_tokens: 2048,
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }

        const res = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error(`Groq API error (${res.status}):`, { error: errorText });
            throw new GroqError(`Groq API returned ${res.status}`, res.status);
        }

        const data = await res.json() as GroqRawResponse;
        const choice = data.choices[0];

        const toolCalls: LLMToolCall[] | undefined = choice.message.tool_calls?.map(
            (tc: GroqRawToolCall) => ({
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

    async transcribeAudio(audioBuffer: Uint8Array, filename: string): Promise<string> {
        const formData = new FormData();
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "json");

        const blob = new Blob([audioBuffer as unknown as BlobPart]);
        formData.append("file", blob, filename);

        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                // Note: Do not manually set Content-Type, fetch sets it with boundaries for FormData
            },
            body: formData as unknown as BodyInit,
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error(`Groq Whisper API error (${res.status}):`, { error: errorText });
            throw new Error(`Transcription failed: ${res.status}`);
        }

        const data = await res.json() as { text: string };
        return data.text;
    }

    private formatMessage(msg: LLMMessage): Record<string, unknown> {
        const formatted: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        };

        if (msg.tool_calls) {
            formatted.tool_calls = msg.tool_calls;
        }
        if (msg.tool_call_id) {
            formatted.tool_call_id = msg.tool_call_id;
        }
        if (msg.name) {
            formatted.name = msg.name;
        }

        return formatted;
    }
}

export class GroqError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "GroqError";
    }

    /** Whether this error is a rate limit (429) */
    get isRateLimit(): boolean {
        return this.statusCode === 429;
    }
}

// ── Raw Groq API types ──────────────────────

interface GroqRawToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string;
    };
}

interface GroqRawResponse {
    choices: Array<{
        message: {
            role: string;
            content: string | null;
            tool_calls?: GroqRawToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
