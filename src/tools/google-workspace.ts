// ============================================
// GARI – Tool: Google Workspace (gog)
// ============================================
// Tool to interact with Gmail, Calendar, Drive, etc.
// Requires the 'gog' CLI to be installed and configured.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

export const googleWorkspaceTool: ToolDefinition = {
    name: "google_workspace",
    description:
        "Interacts with Google Workspace (Gmail, Calendar, Drive, Sheets, Docs). " +
        "Allows searching emails, sending messages, managing events, and reading files. " +
        "Uses the 'gog' CLI internally.",
    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description:
                    "The full 'gog' command to execute (e.g., 'gmail search newer_than:1d'). " +
                    "Do NOT include the 'gog' binary name itself.",
            },
        },
        required: ["command"],
    },

    execute: async (args: Record<string, unknown>): Promise<string> => {
        const cmd = args.command as string;
        try {
            logger.info(`Executing Google Workspace command: gog ${cmd}`);

            // Execute the gog command
            // Note: In production, the gog binary must be in the PATH.
            const { stdout, stderr } = await execAsync(`gog ${cmd} --json --no-input`);

            if (stderr && !stdout) {
                return `Error executing command: ${stderr}`;
            }

            return stdout || "Command executed successfully (no output).";
        } catch (error: any) {
            const msg = error.message || String(error);
            logger.error(`Google Workspace tool failed: ${msg}`);
            return `Failed to execute Google Workspace command. Ensure the 'gog' CLI is installed and configured.\nError: ${msg}`;
        }
    },
};
