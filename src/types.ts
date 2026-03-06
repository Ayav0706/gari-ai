// ============================================
// GARI – Type Definitions
// ============================================
// Central type definitions for the entire application.
// All modules import their types from here.

// ── LLM Types ───────────────────────────────

export interface LLMMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: LLMToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface LLMToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface LLMResponse {
    message: LLMMessage;
    finish_reason: "stop" | "tool_calls" | "length";
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface LLMProvider {
    readonly name: string;
    chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse>;
    transcribeAudio?(audioBuffer: Uint8Array, filename: string): Promise<string>;
}

// ── Tool Types ──────────────────────────────

export interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    execute: (args: Record<string, unknown>) => Promise<string>;
}

// ── Memory Types ────────────────────────────

export interface MemoryEntry {
    id: string;
    user_id: number;
    key: string;
    value: string;
    created_at: string;
    updated_at: string;
}

export interface ConversationMessage {
    role: string;
    content: string;
}
