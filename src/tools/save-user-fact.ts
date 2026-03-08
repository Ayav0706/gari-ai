// ============================================
// GARI – Tool: Save User Fact
// ============================================
// Allows the bot to proactively save important user data to memory.

import type { ToolDefinition } from "../types.js";
import { saveMemory } from "../memory/db.js";
import { logger } from "../logger.js";

export const saveUserFactTool: ToolDefinition = {
    name: "save_user_fact",
    description: "Saves a permanent fact, preference or key information about the user to long-term memory. Use this sparingly for IMPORTANT info (e.g. name, work, coding preferences, project names). Proactively decide on a semantic 'key' to group info together (p.ej. 'user_info', 'tech_stack', 'project_x'). This allows Gari to recall it in future conversations.",
    parameters: {
        type: "object",
        properties: {
            key: {
                type: "string",
                description: "A semantic key to store the fact under (e.g. 'work_preference', 'birthday'). If you use the same key, the previous fact for that user with that key will be overwritten. Choose descriptively.",
            },
            fact: {
                type: "string",
                description: "The fact to remember. Be clear and specific (e.g. 'El usuario prefiere usar TypeScript para proyectos web').",
            },
            category: {
                type: "string",
                description: "Optional category to organize memory (e.g. PERSONNEL, PROJECTS, TECH, HOBBIES). Defaults to GENERAL.",
                enum: ["GENERAL", "PERSONAL", "PROJECTS", "TECH", "HOBBIES", "WORK"],
            },
            tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of tags for easier retrieval (e.g. ['typescript', 'react', 'preferences']).",
            },
        },
        required: ["key", "fact"],
    },
    async execute(args, context) {
        const { key, fact, category = "GENERAL", tags = [] } = args as { 
            key: string; 
            fact: string; 
            category?: string; 
            tags?: string[] 
        };
        const userId = context?.userId;

        if (!userId) {
            return "Error: No userId provided in tool execution context.";
        }

        try {
            logger.info(`🧠 [${category}] Saving user fact for user ${userId} (key: ${key}): ${fact}`);
            await saveMemory(userId, key, fact, category, tags);
            return `✅ Memoria guardada satisfactoriamente en [${category}]: "${fact}" (Etiquetada como: ${key})`;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to save user fact: ${msg}`);
            return `❌ Error al intentar guardar el dato semántico: ${msg}`;
        }
    },
};
