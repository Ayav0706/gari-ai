// ============================================
// GARI – Tool Registry
// ============================================
// Dynamic tool registration and execution.
// Schema-first design: the LLM sees tool schemas, not code.

import { logger } from "../logger.js";
import type { ToolDefinition, ToolSchema } from "../types.js";

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

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
     * Returns the result string, or an error message if the tool fails.
     */
    async execute(name: string, rawArgs: string): Promise<string> {
        const tool = this.tools.get(name);

        if (!tool) {
            const msg = `Tool "${name}" not found. Available tools: ${this.listNames().join(", ")}`;
            logger.warn(msg);
            return `Error: ${msg}`;
        }

        try {
            const args = JSON.parse(rawArgs) as Record<string, unknown>;
            logger.debug(`Executing tool: ${name}`, { args });
            const result = await tool.execute(args);
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
