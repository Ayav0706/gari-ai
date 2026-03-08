import { config } from "../config.js";
import { GroqProvider } from "./groq.js";
import { logger } from "../logger.js";

const ROUTER_MODEL = "llama-3.1-8b-instant";

export async function classifyIntent(message: string): Promise<"SIMPLE" | "COMPLEX"> {
    try {
        if (!config.GROQ_API_KEY) {
            return "COMPLEX"; // Fallback if no GROQ key
        }

        const provider = new GroqProvider(config.GROQ_API_KEY, ROUTER_MODEL);

        const systemPrompt = `You are an intent classifier. Your job is to determine if the user's message is a SIMPLE conversational query or a COMPLEX task requiring external tools, file reading, command execution, logic, UI building or system info.
Rules:
- Respond ONLY with the word "SIMPLE" or "COMPLEX".
- If the user asks for code changes, building an app, or asks to look at a file, it is COMPLEX.
- If the user asks what you can do, or says a greeting, or asks a general world knowledge question, it is SIMPLE.
- If the user asks about the weather, it is COMPLEX (needs a tool).
- If you are unsure, default to "COMPLEX".`;

        const response = await provider.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
        ]);

        const text = response.message.content?.trim().toUpperCase();

        if (text === "SIMPLE" || text === "COMPLEX") {
            return text as "SIMPLE" | "COMPLEX";
        }
        
        // Sometimes it might say "It is COMPLEX" or so
        if (text?.includes("COMPLEX")) return "COMPLEX";
        if (text?.includes("SIMPLE")) return "SIMPLE";

        return "COMPLEX";
    } catch (error) {
        logger.error("Intent routing failed, defaulting to COMPLEX:", { error });
        return "COMPLEX";
    }
}
