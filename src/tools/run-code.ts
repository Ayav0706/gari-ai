// ============================================
// GARI – Run Code Tool (Sandboxed JS)
// ============================================
// Executes JavaScript in a sandboxed VM context.
// No filesystem, no network — pure computation only.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";
import vm from "node:vm";

const TIMEOUT_MS = 5_000;

export const runCodeTool: ToolDefinition = {
    name: "run_code",
    description:
        "Execute JavaScript code in a secure sandbox and return the result. " +
        "Use for calculations, data transformations, string manipulation, JSON parsing, etc. " +
        "The last expression's value is returned. No filesystem or network access.",
    parameters: {
        type: "object",
        properties: {
            code: {
                type: "string",
                description: "JavaScript code to execute. The result of the last expression is returned.",
            },
        },
        required: ["code"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const code = args.code as string;

        if (!code.trim()) return "Error: No code provided.";

        logger.info(`⚡ Running sandboxed code (${code.length} chars)`);

        try {
            // Minimal sandbox context — only safe globals
            const sandbox: Record<string, unknown> = {
                console: {
                    log: (...a: unknown[]) => outputs.push(a.map(String).join(" ")),
                    error: (...a: unknown[]) => outputs.push("[ERROR] " + a.map(String).join(" ")),
                    warn: (...a: unknown[]) => outputs.push("[WARN] " + a.map(String).join(" ")),
                },
                Math,
                JSON,
                Date,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                encodeURIComponent,
                decodeURIComponent,
                Array,
                Object,
                String,
                Number,
                Boolean,
                Map,
                Set,
                RegExp,
                Error,
                Promise,
                Symbol,
            };

            const outputs: string[] = [];
            const context = vm.createContext(sandbox);

            const result = vm.runInContext(code, context, {
                timeout: TIMEOUT_MS,
                filename: "gari-sandbox.js",
            });

            // Build output: console logs + final result
            const parts: string[] = [];
            if (outputs.length > 0) {
                parts.push("Console output:\n" + outputs.join("\n"));
            }
            if (result !== undefined) {
                const resultStr = typeof result === "object"
                    ? JSON.stringify(result, null, 2)
                    : String(result);
                parts.push("Result: " + resultStr);
            }

            return parts.length > 0
                ? parts.join("\n\n")
                : "Code executed successfully (no output).";
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);

            if (msg.includes("Script execution timed out")) {
                return `Error: Code execution timed out after ${TIMEOUT_MS / 1000} seconds.`;
            }

            return `Error executing code: ${msg}`;
        }
    },
};
