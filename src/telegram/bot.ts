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
import { isTTSAvailable, textToSpeech } from "../tts/elevenlabs.js";
import type { LLMProvider } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { InputFile } from "grammy";

export function createBot(llm: LLMProvider, toolRegistry: ToolRegistry): Bot {
    const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    // Auth Middleware
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId || !config.TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
            logger.warn(`\ud83d\udeab Unauthorized access attempt from user ${userId ?? "unknown"}`);
            return;
        }
        await next();
    });

    // /start
    bot.command("start", async (ctx) => {
        await ctx.reply(
            "\ud83d\udc4b \u00a1Hola! Soy **Gari**, tu agente de IA personal.\n\n" +
            "Puedes hablarme de forma natural y te ayudar\u00e9 con lo que necesites.\n\n" +
            "Comandos disponibles:\n" +
            "\u2022 /help \u2014 Ver todos los comandos\n" +
            "\u2022 /remember `clave` `valor` \u2014 Guardar en memoria\n" +
            "\u2022 /recall `clave` \u2014 Recuperar de memoria\n" +
            "\u2022 /forget `clave` \u2014 Eliminar de memoria\n" +
            "\u2022 /memories \u2014 Ver todos los recuerdos\n" +
            "\u2022 /clear \u2014 Limpiar historial de conversaci\u00f3n\n\n" +
            "\u00a1Preg\u00fantame lo que quieras! \ud83d\ude80",
            { parse_mode: "Markdown" }
        );
    });

    // /help
    bot.command("help", async (ctx) => {
        await ctx.reply(
            "\ud83e\udde0 **Comandos de Gari:**\n\n" +
            "\ud83d\udcac *Texto libre* \u2014 Habla conmigo de forma natural\n" +
            "\ud83d\udcbe `/remember clave valor` \u2014 Guardar informaci\u00f3n\n" +
            "\ud83d\udd0d `/recall clave` \u2014 Recuperar informaci\u00f3n guardada\n" +
            "\ud83d\uddd1\ufe0f `/forget clave` \u2014 Eliminar un recuerdo\n" +
            "\ud83d\udccb `/memories` \u2014 Listar todos los recuerdos\n" +
            "\ud83e\uddf9 `/clear` \u2014 Limpiar historial de chat\n\n" +
            "Tambi\u00e9n puedo usar herramientas para darte respuestas m\u00e1s precisas. " +
            `Herramientas activas: ${toolRegistry.listNames().join(", ") || "ninguna"}`,
            { parse_mode: "Markdown" }
        );
    });

    // /remember
    bot.command("remember", async (ctx) => {
        const text = ctx.match;
        if (!text) {
            await ctx.reply("Uso: `/remember clave valor`\nEjemplo: `/remember nombre Anthony`", { parse_mode: "Markdown" });
            return;
        }
        const parts = text.split(" ");
        const key = parts[0];
        const value = parts.slice(1).join(" ");
        if (!key || !value) {
            await ctx.reply("\u26a0\ufe0f Necesito tanto la clave como el valor.\nEjemplo: `/remember nombre Anthony`", { parse_mode: "Markdown" });
            return;
        }
        await saveMemory(ctx.from!.id, key, value);
        await ctx.reply(`\u2705 Guardado: **${key}** = \"${value}\"`, { parse_mode: "Markdown" });
    });

    // /recall
    bot.command("recall", async (ctx) => {
        const key = ctx.match?.trim();
        if (!key) {
            await ctx.reply("Uso: `/recall clave`\nEjemplo: `/recall nombre`", { parse_mode: "Markdown" });
            return;
        }
        const memory = await getMemory(ctx.from!.id, key);
        if (memory) {
            await ctx.reply(`\ud83d\udd0d **${key}**: ${memory.value}`, { parse_mode: "Markdown" });
        } else {
            await ctx.reply(`\u274c No tengo nada guardado con la clave \"${key}\".`);
        }
    });

    // /forget
    bot.command("forget", async (ctx) => {
        const key = ctx.match?.trim();
        if (!key) {
            await ctx.reply("Uso: `/forget clave`", { parse_mode: "Markdown" });
            return;
        }
        const deleted = await deleteMemory(ctx.from!.id, key);
        if (deleted) {
            await ctx.reply(`\ud83d\uddd1\ufe0f Eliminado: **${key}**`, { parse_mode: "Markdown" });
        } else {
            await ctx.reply(`\u274c No encontr\u00e9 nada con la clave \"${key}\".`);
        }
    });

    // /memories
    bot.command("memories", async (ctx) => {
        const memories = await listMemories(ctx.from!.id);
        if (memories.length === 0) {
            await ctx.reply("\ud83d\udccb No tienes recuerdos guardados a\u00fan.");
            return;
        }
        const list = memories.map((m) => `\u2022 **${m.key}**: ${m.value}`).join("\n");
        await ctx.reply(`\ud83d\udccb **Tus recuerdos:**\n\n${list}`, { parse_mode: "Markdown" });
    });

    // /clear
    bot.command("clear", async (ctx) => {
        await clearConversation(ctx.from!.id);
        await ctx.reply("\ud83e\uddf9 Historial de conversaci\u00f3n limpiado. \u00a1Empezamos de nuevo!");
    });

    // Text Handler (Agent Loop)
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;
        logger.info(`\ud83d\udcac Message from ${userId}: ${userMessage.slice(0, 100)}...`);
        await ctx.replyWithChatAction("typing");
        const typingInterval = setInterval(async () => {
            try { await ctx.replyWithChatAction("typing"); } catch { }
        }, 4000);
        try {
            const reply = await runAgentLoop(userMessage, userId, llm, toolRegistry);
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
            await ctx.reply("\u26a0\ufe0f Hubo un error procesando tu mensaje. Intenta de nuevo.");
        } finally {
            clearInterval(typingInterval);
        }
    });

    // Voice / Audio Handler
    bot.on(["message:voice", "message:audio"], async (ctx) => {
        const userId = ctx.from.id;
        await ctx.replyWithChatAction("typing");
        try {
            const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;
            if (!fileId) return;
            if (!llm.transcribeAudio) {
                await ctx.reply("\u274c Mi modelo actual no soporta transcripci\u00f3n de audio.");
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
            logger.info(`\ud83c\udfa4 Transcribing audio from ${userId}...`);
            const transcription = await llm.transcribeAudio(buffer, filename);
            logger.info(`\ud83d\udcdd Transcription: ${transcription}`);
            await ctx.reply(`_Me dijiste:_ \"${transcription}\"\n\n\ud83d\udcad Procesando...`, { parse_mode: "Markdown" });
            const typingInterval = setInterval(async () => {
                try { await ctx.replyWithChatAction("typing"); } catch { }
            }, 4000);
            try {
                const reply = await runAgentLoop(transcription, userId, llm, toolRegistry);
                if (isTTSAvailable() && reply.length < 4500) {
                    const audioBuffer = await textToSpeech(reply);
                    if (audioBuffer) {
                        await ctx.replyWithVoice(new InputFile(audioBuffer, "response.mp3"));
                        await ctx.reply(reply, { parse_mode: "Markdown" });
                    } else {
                        await ctx.reply(reply, { parse_mode: "Markdown" });
                    }
                } else if (reply.length > 4000) {
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
            await ctx.reply("\u26a0\ufe0f Hubo un error procesando tu audio. \u00bfPuedes escribirlo?");
        }
    });

    // Error Handler
    bot.catch((err) => {
        logger.error("Bot error:", { error: err.message ?? String(err) });
    });

    return bot;
}

function splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }
        let breakPoint = remaining.lastIndexOf("\n", maxLength);
        if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
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
