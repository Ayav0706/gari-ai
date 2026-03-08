import { logger } from "../logger.js";
import { 
    countConversationMessages, 
    getRecentMessages, 
    pruneConversation, 
    saveMemory
} from "./db.js";
import type { LLMProvider, LLMMessage } from "../types.js";

/**
 * Check if the conversation exceeds a certain threshold and prune it,
 * saving a summary of the pruned messages to user memory.
 */
export async function manageConversationSize(userId: number, llm: LLMProvider) {
    try {
        const count = await countConversationMessages(userId);
        const LIMIT = 40;
        const KEEP = 20;

        if (count <= LIMIT) return;

        logger.info(`Pruning conversation for user ${userId} (${count} messages)`);

        // 1. Get ALL messages to summarize the context
        // We get up to LIMIT messages to have the full context for summarization
        const allMessages = await getRecentMessages(userId, count);
        
        // 2. Summarize the history
        const summary = await summarizeThread(allMessages as any[], llm);

        // 3. Save summary to persistent memory
        if (summary) {
            await saveMemory(userId, "CONVERSATION_SUMMARY", summary);
            logger.debug(`Saved new conversation summary for user ${userId}`);
        }

        // 4. Prune the database
        await pruneConversation(userId, KEEP);
        logger.info(`Pruned conversation for user ${userId}, kept latest ${KEEP} messages`);

    } catch (error) {
        logger.error(`Error in manageConversationSize for user ${userId}:`, { error });
    }
}

async function summarizeThread(messages: any[], llm: LLMProvider): Promise<string | null> {
    if (messages.length === 0) return null;

    const formattedThread = messages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");

    const prompt: LLMMessage[] = [
        {
            role: "system",
            content: "Eres un experto en síntesis de información. Tu tarea es resumir esta conversación entre un usuario y un asistente inteligente (Gari). Extrae puntos clave, decisiones tomadas, preferencias del usuario reveladas y el estado actual de cualquier tarea pendiente. Sé conciso y usa viñetas si es necesario. Responde en español."
        },
        {
            role: "user",
            content: `Resume esta conversación:\n\n${formattedThread}`
        }
    ];

    try {
        const response = await llm.chat(prompt);
        return response.message.content;
    } catch (error) {
        logger.error("Failed to summarize thread", { error });
        return null;
    }
}
