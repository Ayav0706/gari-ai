// ============================================
// GARI – Tool Registry
// ============================================
// Dynamic tool registration and execution.
// Schema-first design: the LLM sees tool schemas, not code.

import { logger } from "../logger.js";
import type { ToolDefinition, ToolSchema } from "../types.js";

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    /** Maximum time (ms) a tool can run before being timed out. */
    private readonly TOOL_TIMEOUT_MS = 30_000;

    /**
     * Register a new tool. Throws if a tool with the same name already exists.
     */
    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered.`);
        }
        this.tools.set(tool.name, tool);
        logger.info(`🔧 Tool registered: ${tool.name}`);
    }

    /**
     * Get all tool schemas formatted for the LLM (OpenAI function calling format).
     */
    getSchemas(): ToolSchema[] {
        return Array.from(this.tools.values()).map((tool) => ({
            type: "function" as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }

    /**
     * Execute a tool by name with the given arguments.
     * Enforces a timeout to prevent hanging tools from blocking the agent loop.
     * Returns the result string, or an error message if the tool fails/times out.
     */
    async execute(name: string, rawArgs: string, context?: { userId: number }): Promise<string> {
        const tool = this.tools.get(name);

        if (!tool) {
            const msg = `Tool "${name}" not found. Available tools: ${this.listNames().join(", ")}`;
            logger.warn(msg);
            return `Error: ${msg}`;
        }

        try {
            const args = JSON.parse(rawArgs) as Record<string, unknown>;
            logger.debug(`Executing tool: ${name}`, { args, context });

            // Race the tool execution against a timeout
            const result = await Promise.race([
                tool.execute(args, context),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${this.TOOL_TIMEOUT_MS / 1000}s`)), this.TOOL_TIMEOUT_MS)
                ),
            ]);

            logger.debug(`Tool result: ${name}`, { result: result.slice(0, 200) });
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Tool execution error: ${name}`, { error: message });
            return `Error executing ${name}: ${message}`;
        }
    }

    /**
     * List all registered tool names.
     */
    listNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Get the count of registered tools.
     */
    get size(): number {
        return this.tools.size;
    }
}
