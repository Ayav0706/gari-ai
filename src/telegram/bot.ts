// ============================================
// GARI – Telegram Bot
// ============================================
// grammY bot with long polling. No webhook, no web server.
// Auth middleware whitelists user IDs.
// Commands: /start, /help, /remember, /recall, /forget, /clear

import { Bot } from "grammy";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { runAgentLoop } from "../agent/loop.js";
import {
    saveMemory,
    getMemory,
    deleteMemory,
    listMemories,
    clearConversation,
} from "../memory/db.js";
import type { LLMProvider } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";

/**
 * Create and configure the Telegram bot.
 * Returns the bot instance ready to start.
 */
export function createBot(llm: LLMProvider, toolRegistry: ToolRegistry): Bot {
    const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    // ── Auth Middleware ──────────────────────────
    // Silently ignores messages from unauthorized users.
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId || !config.TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
            logger.warn(`🚫 Unauthorized access attempt from user ${userId ?? "unknown"}`);
            return; // Silent rejection — don't reveal bot exists
        }
        await next();
    });

    // ── /start ──────────────────────────────────
    bot.command("start", async (ctx) => {
        await ctx.reply(
            "👋 ¡Hola! Soy **Gari**, tu agente de IA personal.\n\n" +
            "Puedes hablarme de forma natural y te ayudaré con lo que necesites.\n\n" +
            "Comandos disponibles:\n" +
            "• /help — Ver todos los comandos\n" +
            "• /remember `clave` `valor` — Guardar en memoria\n" +
            "• /recall `clave` — Recuperar de memoria\n" +
            "• /forget `clave` — Eliminar de memoria\n" +
            "• /memories — Ver todos los recuerdos\n" +
            "• /clear — Limpiar historial de conversación\n\n" +
            "¡Pregúntame lo que quieras! 🚀",
            { parse_mode: "Markdown" }
        );
    });

    // ── /help ───────────────────────────────────
    bot.command("help", async (ctx) => {
        await ctx.reply(
            "🧠 **Comandos de Gari:**\n\n" +
            "💬 *Texto libre* — Habla conmigo de forma natural\n" +
            "💾 `/remember clave valor` — Guardar información\n" +
            "🔍 `/recall clave` — Recuperar información guardada\n" +
            "🗑️ `/forget clave` — Eliminar un recuerdo\n" +
            "📋 `/memories` — Listar todos los recuerdos\n" +
            "🧹 `/clear` — Limpiar historial de chat\n\n" +
            "También puedo usar herramientas para darte respuestas más precisas. " +
            `Herramientas activas: ${toolRegistry.listNames().join(", ") || "ninguna"}`,
            { parse_mode: "Markdown" }
        );
    });

    // ── /remember ───────────────────────────────
    bot.command("remember", async (ctx) => {
        const text = ctx.match;
        if (!text) {
            await ctx.reply("Uso: `/remember clave valor`\nEjemplo: `/remember nombre Anthony`", {
                parse_mode: "Markdown",
            });
            return;
        }

        const parts = text.split(" ");
        const key = parts[0];
        const value = parts.slice(1).join(" ");

        if (!key || !value) {
            await ctx.reply("⚠️ Necesito tanto la clave como el valor.\nEjemplo: `/remember nombre Anthony`", {
                parse_mode: "Markdown",
            });
            return;
        }

        await saveMemory(ctx.from!.id, key, value);
        await ctx.reply(`✅ Guardado: **${key}** = "${value}"`, { parse_mode: "Markdown" });
    });

    // ── /recall ─────────────────────────────────
    bot.command("recall", async (ctx) => {
        const key = ctx.match?.trim();
        if (!key) {
            await ctx.reply("Uso: `/recall clave`\nEjemplo: `/recall nombre`", {
                parse_mode: "Markdown",
            });
            return;
        }

        const memory = await getMemory(ctx.from!.id, key);
        if (memory) {
            await ctx.reply(`🔍 **${key}**: ${memory.value}`, { parse_mode: "Markdown" });
        } else {
            await ctx.reply(`❌ No tengo nada guardado con la clave "${key}".`);
        }
    });

    // ── /forget ─────────────────────────────────
    bot.command("forget", async (ctx) => {
        const key = ctx.match?.trim();
        if (!key) {
            await ctx.reply("Uso: `/forget clave`", { parse_mode: "Markdown" });
            return;
        }

        const deleted = await deleteMemory(ctx.from!.id, key);
        if (deleted) {
            await ctx.reply(`🗑️ Eliminado: **${key}**`, { parse_mode: "Markdown" });
        } else {
            await ctx.reply(`❌ No encontré nada con la clave "${key}".`);
        }
    });

    // ── /memories ───────────────────────────────
    bot.command("memories", async (ctx) => {
        const memories = await listMemories(ctx.from!.id);
        if (memories.length === 0) {
            await ctx.reply("📋 No tienes recuerdos guardados aún.");
            return;
        }

        const list = memories
            .map((m) => `• **${m.key}**: ${m.value}`)
            .join("\n");
        await ctx.reply(`📋 **Tus recuerdos:**\n\n${list}`, { parse_mode: "Markdown" });
    });

    // ── /clear ──────────────────────────────────
    bot.command("clear", async (ctx) => {
        await clearConversation(ctx.from!.id);
        await ctx.reply("🧹 Historial de conversación limpiado. ¡Empezamos de nuevo!");
    });

    // ── Text Handler (Agent Loop) ───────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;

        logger.info(`💬 Message from ${userId}: ${userMessage.slice(0, 100)}...`);

        // Show typing indicator while processing
        await ctx.replyWithChatAction("typing");

        // Set up a typing interval (Telegram typing indicator lasts ~5s)
        const typingInterval = setInterval(async () => {
            try {
                await ctx.replyWithChatAction("typing");
            } catch {
                // Ignore errors from typing action
            }
        }, 4000);

        try {
            const reply = await runAgentLoop(userMessage, userId, llm, toolRegistry);

            // Split long messages (Telegram limit: 4096 chars)
            if (reply.length > 4000) {
                const chunks = splitMessage(reply, 4000);
                for (const chunk of chunks) {
                    await ctx.reply(chunk, { parse_mode: "Markdown" });
                }
            } else {
                await ctx.reply(reply, { parse_mode: "Markdown" });
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error("Error in agent loop:", { error: errMsg, userId });
            await ctx.reply("⚠️ Hubo un error procesando tu mensaje. Intenta de nuevo.");
        } finally {
            clearInterval(typingInterval);
        }
    });

    // ── Voice / Audio Handler ─────────────────
    bot.on(["message:voice", "message:audio"], async (ctx) => {
        const userId = ctx.from.id;

        await ctx.replyWithChatAction("typing");

        try {
            const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;
            if (!fileId) return;

            if (!llm.transcribeAudio) {
                await ctx.reply("❌ Mi modelo actual no soporta transcripción de audio.");
                return;
            }

            const file = await ctx.api.getFile(fileId);
            const filePath = file.file_path;
            if (!filePath) throw new Error("No file path");

            const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${filePath}`;
            const res = await fetch(fileUrl);
            if (!res.ok) throw new Error("Failed to download audio file");

            const arrayBuffer = await res.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const ext = filePath.split('.').pop() || "ogg";
            const filename = `audio.${ext}`;

            logger.info(`🎤 Transcribing audio from ${userId}...`);
            const transcription = await llm.transcribeAudio(buffer, filename);

            logger.info(`📝 Transcription: ${transcription}`);
            await ctx.reply(`_Me dijiste:_ "${transcription}"\n\n💭 Procesando...`, { parse_mode: "Markdown" });

            const typingInterval = setInterval(async () => {
                try { await ctx.replyWithChatAction("typing"); } catch { }
            }, 4000);

            try {
                const reply = await runAgentLoop(transcription, userId, llm, toolRegistry);

                if (reply.length > 4000) {
                    const chunks = splitMessage(reply, 4000);
                    for (const chunk of chunks) {
                        await ctx.reply(chunk, { parse_mode: "Markdown" });
                    }
                } else {
                    await ctx.reply(reply, { parse_mode: "Markdown" });
                }
            } finally {
                clearInterval(typingInterval);
            }

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error("Error processing audio:", { error: errMsg, userId });
            await ctx.reply("⚠️ Hubo un error procesando tu audio. ¿Puedes escribirlo?");
        }
    });

    // ── Error Handler ───────────────────────────
    bot.catch((err) => {
        logger.error("Bot error:", { error: err.message ?? String(err) });
    });

    return bot;
}

/**
 * Split a long message into chunks, trying to break at newlines.
 */
function splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to break at a newline
        let breakPoint = remaining.lastIndexOf("\n", maxLength);
        if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
            // No good newline found, break at space
            breakPoint = remaining.lastIndexOf(" ", maxLength);
        }
        if (breakPoint === -1) {
            breakPoint = maxLength;
        }

        chunks.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
    }

    return chunks;
}
