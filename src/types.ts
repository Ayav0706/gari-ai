// ============================================
// GARI – Shared Types
// ============================================
// Core type definitions used across all modules.

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
        arguments: string; // JSON string
    };
}

export interface LLMResponse {
    message: LLMMessage;
    finish_reason: "stop" | "tool_calls" | "length" | "error";
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface LLMProvider {
    /**
     * Send a chat completion request to the LLM.
     * @param messages - Conversation history
     * @param tools - Available tools for function calling
     * @returns The LLM's response
     */
    chat(messages: LLMMessage[], tools?: ToolSchema[]): Promise<LLMResponse>;

    /** Optional: Transcribe audio to text. */
    transcribeAudio?(audioBuffer: Uint8Array, filename: string): Promise<string>;

    /** Provider name for logging */
    readonly name: string;
}

// ── Tool Types ──────────────────────────────

export interface ToolParameter {
    type: string;
    description: string;
    enum?: string[];
    default?: unknown;
}

export interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, ToolParameter>;
            required?: string[];
        };
    };
}

export interface ToolDefinition {
    /** Unique tool name (snake_case) */
    name: string;

    /** Clear description for the LLM – this is what the model reads */
    description: string;

    /** JSON Schema for parameters */
    parameters: {
        type: "object";
        properties: Record<string, ToolParameter>;
        required?: string[];
    };

    /** Execute the tool with validated arguments */
    execute: (args: Record<string, unknown>) => Promise<string>;
}

// ── Memory Types ────────────────────────────

export interface MemoryEntry {
    id: string;      // Firebase document ID
    user_id: number;
    key: string;
    value: string;
    created_at: string;
    updated_at: string;
}

export interface ConversationMessage {
    id: string;      // Firebase document ID
    user_id: number;
    role: string;
    content: string;
    timestamp: string;
}
