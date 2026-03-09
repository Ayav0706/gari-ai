// ============================================
// GARI – Tool Registry
// ============================================
// Dynamic tool registration and execution.
// Schema-first design: the LLM sees tool schemas, not code.

import { logger } from "../logger.js";
import type { ToolDefinition, ToolSchema } from "../types.js";

type ErrorCategory = "transient" | "validation" | "execution" | "not_found";

type IncidentAction = "retry" | "fail" | "no_retry" | "recovered";

type ToolIncident = {
    tool: string;
    ts: string;
    attempt: number;
    category: ErrorCategory;
    action: IncidentAction;
    detail: string;
};

type ToolPolicy = {
    maxRetries: number;
    baseBackoffMs: number;
};

type ToolHealthStatus = {
    failuresByTool: Record<string, number>;
    recentIncidents: ToolIncident[];
};

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();
    private policies: Map<string, ToolPolicy> = new Map();
    private failureCounts: Map<string, number> = new Map();
    private incidents: ToolIncident[] = [];

    /** Maximum time (ms) a tool can run before being timed out. */
    private readonly TOOL_TIMEOUT_MS = 30_000;
    private readonly INCIDENTS_LIMIT = 50;
    private readonly DEFAULT_POLICY: ToolPolicy = {
        maxRetries: 2,
        baseBackoffMs: 250,
    };

    /**
     * Register a new tool. Throws if a tool with the same name already exists.
     */
    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered.`);
        }
        this.tools.set(tool.name, tool);
        this.policies.set(tool.name, this.resolvePolicy(tool.name));
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
            this.recordIncident(name, 1, "not_found", "fail", msg);
            logger.warn(msg);
            return `Error: ${msg}`;
        }

        let args: Record<string, unknown>;
        try {
            args = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.incrementFailure(name);
            this.recordIncident(name, 1, "validation", "no_retry", `Invalid JSON args: ${message}`);
            logger.error(`Tool execution error: ${name}`, { error: message });
            return `Error executing ${name}: Invalid JSON arguments (${message})`;
        }

        logger.debug(`Executing tool: ${name}`, { args, context });
        const policy = this.policies.get(name) ?? this.DEFAULT_POLICY;

        for (let attempt = 1; attempt <= policy.maxRetries + 1; attempt++) {
            try {
                const result = await this.executeWithTimeout(tool, name, args, context);
                if (attempt > 1) {
                    this.recordIncident(name, attempt, "transient", "recovered", "Tool recovered after retry");
                }
                logger.debug(`Tool result: ${name}`, { result: result.slice(0, 200) });
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const category = this.categorizeError(message);
                const canRetry = category === "transient" && attempt <= policy.maxRetries;

                if (canRetry) {
                    this.recordIncident(name, attempt, category, "retry", message);
                    logger.warn(`Retrying tool after transient error: ${name}`, { attempt, error: message });
                    await this.sleep(this.computeBackoffMs(policy.baseBackoffMs, attempt));
                    continue;
                }

                this.incrementFailure(name);
                this.recordIncident(name, attempt, category, category === "validation" ? "no_retry" : "fail", message);
                logger.error(`Tool execution error: ${name}`, { error: message, attempt, category });
                return `Error executing ${name}: ${message}`;
            }
        }

        const fallbackMsg = `Unexpected execution state for tool "${name}".`;
        this.incrementFailure(name);
        this.recordIncident(name, 1, "execution", "fail", fallbackMsg);
        logger.error(fallbackMsg);
        return `Error executing ${name}: ${fallbackMsg}`;
    }

    /**
     * Basic health status for tooling execution.
     */
    getToolHealthStatus(): ToolHealthStatus {
        const failuresByTool: Record<string, number> = {};
        for (const [tool, count] of this.failureCounts.entries()) {
            failuresByTool[tool] = count;
        }

        return {
            failuresByTool,
            recentIncidents: [...this.incidents],
        };
    }

    private async executeWithTimeout(
        tool: ToolDefinition,
        name: string,
        args: Record<string, unknown>,
        context?: { userId: number }
    ): Promise<string> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                tool.execute(args, context),
                new Promise<string>((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`Tool "${name}" timed out after ${this.TOOL_TIMEOUT_MS / 1000}s`)),
                        this.TOOL_TIMEOUT_MS
                    );
                }),
            ]);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    private categorizeError(message: string): ErrorCategory {
        const normalized = message.toLowerCase();
        const transientHints = [
            "timed out",
            "timeout",
            "network",
            "socket hang up",
            "econnreset",
            "eai_again",
            "enotfound",
            "rate limit",
            "too many requests",
            "429",
            "temporarily unavailable",
            "connection reset",
        ];
        if (transientHints.some((hint) => normalized.includes(hint))) {
            return "transient";
        }

        const validationHints = [
            "invalid json",
            "json",
            "validation",
            "schema",
            "required",
            "unexpected token",
            "must be",
            "invalid argument",
        ];
        if (validationHints.some((hint) => normalized.includes(hint))) {
            return "validation";
        }

        return "execution";
    }

    private resolvePolicy(toolName: string): ToolPolicy {
        const normalized = toolName.toLowerCase();
        if (normalized.includes("web") || normalized.includes("http") || normalized.includes("network")) {
            return { maxRetries: 3, baseBackoffMs: 250 };
        }
        return this.DEFAULT_POLICY;
    }

    private computeBackoffMs(baseMs: number, attempt: number): number {
        const jitter = Math.floor(Math.random() * 80);
        return baseMs * attempt + jitter;
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    private incrementFailure(tool: string): void {
        const current = this.failureCounts.get(tool) ?? 0;
        this.failureCounts.set(tool, current + 1);
    }

    private recordIncident(
        tool: string,
        attempt: number,
        category: ErrorCategory,
        action: IncidentAction,
        detail: string
    ): void {
        this.incidents.push({
            tool,
            ts: new Date().toISOString(),
            attempt,
            category,
            action,
            detail: detail.slice(0, 400),
        });
        if (this.incidents.length > this.INCIDENTS_LIMIT) {
            this.incidents = this.incidents.slice(this.incidents.length - this.INCIDENTS_LIMIT);
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
