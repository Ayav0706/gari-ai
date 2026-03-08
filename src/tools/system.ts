import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

// Lista de comandos permitidos (whitelist)
const ALLOWED_COMMANDS = [
    "ls", "cat", "echo", "pwd", "whoami", 
    "npm", "node", "git", "dir", "type", 
    "yarn", "pnpm", "npx"
];

// Lista de patrones bloqueados (blacklist)
const BLOCKED_PATTERNS = [
    "rm -rf", "sudo", "mv ", "kill", "del", 
    "format", "mkfs"
];

export const executeShellCommandTool: ToolDefinition = {
    name: "execute_shell_command",
    description: "Executes a shell command on the host system. Use this to install packages, run scripts, or perform system operations.",
    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The shell command to execute.",
            },
        },
        required: ["command"],
    },
    execute: async (args) => {
        const { command } = args as { command: string };
        try {
            const commandString = command.trim().toLowerCase();
            
            // Verificar blacklist
            const isBlocked = BLOCKED_PATTERNS.some(pattern => commandString.includes(pattern));
            if (isBlocked) {
                 return `Command rejected: Contains blacklisted patterns.`;
            }

            // Verificar whitelist (extraer el comando base)
            const baseCommand = commandString.split(/\s+/)[0];
            const isAllowed = ALLOWED_COMMANDS.includes(baseCommand);
            
            if (!isAllowed) {
                return `Command rejected: '${baseCommand}' is not in the allowed commands list. Allowed commands: ${ALLOWED_COMMANDS.join(", ")}`;
            }

            logger.info(`Running shell command: ${command}`);
            const { stdout, stderr } = await execAsync(command);
            return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
        } catch (error: any) {
            return `Command failed with error: ${error.message}\nSTDOUT:\n${error.stdout}\nSTDERR:\n${error.stderr}`;
        }
    },
};

export const readFileTool: ToolDefinition = {
    name: "read_file",
    description: "Reads the contents of a file from the host system.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "The absolute or relative path to the file.",
            },
        },
        required: ["path"],
    },
    execute: async (args) => {
        const { path } = args as { path: string };
        try {
            const absolutePath = resolve(process.cwd(), path);
            logger.info(`Reading file: ${absolutePath}`);
            const content = await readFile(absolutePath, "utf-8");
            return content;
        } catch (error: any) {
            return `Failed to read file: ${error.message}`;
        }
    },
};

export const writeFileTool: ToolDefinition = {
    name: "write_file",
    description: "Writes content to a file on the host system. Will overwrite existing content.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "The absolute or relative path to the file.",
            },
            content: {
                type: "string",
                description: "The content to write to the file.",
            },
        },
        required: ["path", "content"],
    },
    execute: async (args) => {
        const { path, content } = args as { path: string; content: string };
        try {
            const absolutePath = resolve(process.cwd(), path);
            logger.info(`Writing to file: ${absolutePath}`);
            await writeFile(absolutePath, content, "utf-8");
            return `Successfully wrote to ${absolutePath}`;
        } catch (error: any) {
            return `Failed to write file: ${error.message}`;
        }
    },
};

export const restartTool: ToolDefinition = {
    name: "restart",
    description: "Restarts the bot. Useful after applying code updates or changes.",
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
    execute: async () => {
        logger.info("Restart command received. Exiting process to trigger restart...");
        setTimeout(() => process.exit(0), 1000);
        return "Bot is restarting... You may need to wait a few seconds before sending the next message.";
    },
};
