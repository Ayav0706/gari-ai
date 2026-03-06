// ============================================
// GARI – Tool: Coding Skills (Superpowers)
// ============================================
// Allows Gari to read specialized instructions for coding tasks.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, "../agent/skills");

export const codingSkillsTool: ToolDefinition = {
    name: "manage_coding_skills",
    description:
        "Consulta y lee instrucciones especializadas (superpoderes) para tareas de programaci\u00f3n, " +
        "como TDD, debugging, brainstorming o integraci\u00f3n con Google Workspace.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["list", "read"],
                description: "Acci\u00f3n a realizar: 'list' para ver disponibles, 'read' para leer una en particular.",
            },
            skill_name: {
                type: "string",
                description: "Nombre del superpoder a leer (ej. 'test-driven-development'). Solo necesario para 'read'.",
            },
        },
        required: ["action"],
    },

    execute: async (args: Record<string, unknown>): Promise<string> => {
        const action = args.action as string;
        const skillName = args.skill_name as string;

        try {
            if (action === "list") {
                const files = await fs.readdir(SKILLS_DIR);
                const skills = files
                    .filter((f) => f.endsWith(".md"))
                    .map((f) => f.replace(".md", ""));
                return `Superpoderes disponibles:\n- ${skills.join("\n- ")}`;
            }

            if (action === "read") {
                if (!skillName) return "Error: Debes proporcionar el nombre del superpoder para leerlo.";
                const filePath = path.join(SKILLS_DIR, `${skillName}.md`);
                const content = await fs.readFile(filePath, "utf-8");
                return `Instrucciones para el superpoder '${skillName}':\n\n${content}`;
            }

            return "Error: Acci\u00f3n no reconocida.";
        } catch (error: any) {
            logger.error(`Coding Skills tool failed: ${error.message}`);
            return `Error al acceder a los superpoderes: ${error.message}`;
        }
    },
};
