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
    saveRule,
    listRules,
    deleteRule,
    clearRules,
    setBotStatus,
    getBotStatus,
} from "../memory/db.js";
import { isTTSAvailable, textToSpeech } from "../tts/elevenlabs.js";
import type { LLMProvider } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { InputFile } from "grammy";

const TELEGRAM_COMMANDS = [
    { command: "start", description: "Iniciar Gari" },
    { command: "help", description: "Ver ayuda y comandos" },
    { command: "ping", description: "Probar si el bot está activo" },
    { command: "status", description: "Ver estado actual del bot" },
    { command: "id", description: "Ver tu user ID de Telegram" },
    { command: "remember", description: "Guardar un recuerdo" },
    { command: "recall", description: "Leer un recuerdo" },
    { command: "forget", description: "Borrar un recuerdo" },
    { command: "memories", description: "Listar recuerdos guardados" },
    { command: "rules", description: "Gestionar reglas de comportamiento" },
    { command: "clear", description: "Limpiar historial de conversación" },
    { command: "bot_stop", description: "Detener respuestas del bot" },
    { command: "bot_start", description: "Reanudar respuestas del bot" },
] as const;

export async function registerTelegramCommands(bot: Bot): Promise<void> {
    try {
        await bot.api.setMyCommands(TELEGRAM_COMMANDS);
        logger.info(`✅ Telegram slash commands registered (${TELEGRAM_COMMANDS.length}).`);
    } catch (error) {
        logger.warn("Could not register Telegram slash commands.", {
            error: String(error),
        });
    }
}

/**
 * Send a reply safely: try Markdown first, fall back to plain text if Telegram rejects the formatting.
 * This prevents silent failures when the LLM returns malformed Markdown.
 */
async function safeReply(ctx: any, text: string): Promise<void> {
    try {
        await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (markdownError: any) {
        // Telegram rejects malformed Markdown with 400. Retry as plain text.
        if (markdownError?.description?.includes("can't parse") || markdownError?.error_code === 400) {
            logger.warn("Markdown parse failed, sending as plain text.");
            await ctx.reply(text);
        } else {
            throw markdownError;
        }
    }
}

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

        // Always allow /bot_start
        if (ctx.message?.text?.startsWith("/bot_start")) {
            return await next();
        }

        // Check if bot is stopped for this user
        const status = await getBotStatus(userId);
        if (status === "stopped") {
            // Silently ignore if stopped, as requested.
            // But we could optionally logs it:
            // logger.debug(`Message from user ${userId} ignored (bot stopped)`);
            return; 
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
            "• /ping — Verificar que estoy vivo\n" +
            "• /status — Ver estado del bot\n" +
            "• /id — Ver tu user ID\n" +
            "• /remember `clave` `valor` — Guardar en memoria\n" +
            "• /recall `clave` — Recuperar de memoria\n" +
            "• /forget `clave` — Eliminar de memoria\n" +
            "• /memories — Ver todos los recuerdos\n" +
            "• /rules — Gestionar reglas de comportamiento\n" +
            "• /clear — Limpiar historial de conversación\n" +
            "• /bot_stop — Detener el bot (dejará de responder)\n" +
            "• /bot_start — Reanudar el bot\n\n" +
            "¡Pregúntame lo que quieras! 🚀",
            { parse_mode: "Markdown" }
        );
    });

    // ── /help ───────────────────────────────────
    bot.command("help", async (ctx) => {
        await ctx.reply(
            "🧠 **Comandos de Gari:**\n\n" +
            "💬 *Texto libre* — Habla conmigo de forma natural\n" +
            "🟢 `/ping` — Comprobar si estoy activo\n" +
            "📊 `/status` — Estado del bot y modo de conexión\n" +
            "🆔 `/id` — Mostrar tu user ID\n" +
            "💾 `/remember clave valor` — Guardar información\n" +
            "🔍 `/recall clave` — Recuperar información guardada\n" +
            "🗑️ `/forget clave` — Eliminar un recuerdo\n" +
            "📋 `/memories` — Listar todos los recuerdos\n" +
            "📏 `/rules` — Configurar reglas de comportamiento\n" +
            "🧹 `/clear` — Limpiar historial de chat\n" +
            "🛑 `/bot_stop` — Detener el bot\n" +
            "▶️ `/bot_start` — Reanudar el bot\n\n" +
            "También puedo usar herramientas para darte respuestas más precisas. " +
            `Herramientas activas: ${toolRegistry.listNames().join(", ") || "ninguna"}`,
            { parse_mode: "Markdown" }
        );
    });

    // ── /ping ───────────────────────────────────
    bot.command("ping", async (ctx) => {
        await ctx.reply("🏓 Pong. Gari está activo.");
    });

    // ── /id ─────────────────────────────────────
    bot.command("id", async (ctx) => {
        await ctx.reply(`🆔 Tu Telegram user ID es: \`${ctx.from!.id}\``, {
            parse_mode: "Markdown",
        });
    });

    // ── /status ─────────────────────────────────
    bot.command("status", async (ctx) => {
        const userId = ctx.from!.id;
        const status = await getBotStatus(userId);
        const inferredWebhookBase = process.env.RENDER_EXTERNAL_URL?.trim() || "";
        const webhookConfigured = Boolean(config.TELEGRAM_WEBHOOK_URL.trim() || inferredWebhookBase);
        const mode = webhookConfigured ? "webhook" : "polling";

        await ctx.reply(
            "📊 **Estado de Gari**\n\n" +
            `• Usuario autorizado: ✅\n` +
            `• Bot para ti: **${status}**\n` +
            `• Modo de conexión: **${mode}**`,
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

    // ── /bot_stop ───────────────────────────────
    bot.command("bot_stop", async (ctx) => {
        await setBotStatus(ctx.from!.id, "stopped");
        await ctx.reply("🛑 **Bot detenido.** Ya no responderé a tus mensajes hasta que uses `/bot_start`.", {
            parse_mode: "Markdown",
        });
        logger.info(`Bot stopped for user ${ctx.from!.id}`);
    });

    // ── /bot_start ──────────────────────────────
    bot.command("bot_start", async (ctx) => {
        await setBotStatus(ctx.from!.id, "active");
        await ctx.reply("▶️ **Bot activado.** ¡Estoy listo para ayudarte de nuevo!", {
            parse_mode: "Markdown",
        });
        logger.info(`Bot started for user ${ctx.from!.id}`);
    });


    // ── Chat Rules Commands ──────────────────────
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

    // ── /rules ──────────────────────────────────
    bot.command("rules", async (ctx) => {
        const text = ctx.match?.trim();
        const userId = ctx.from!.id;

        if (!text) {
            // List current rules
            const rules = await listRules(userId);
            if (rules.length === 0) {
                await ctx.reply(
                    "📏 **Reglas de comportamiento:**\n\n" +
                    "No tienes reglas configuradas. Las reglas ayudan a definir cómo quiero que me hables o te comportes.\n\n" +
                    "Uso:\n" +
                    "• `/rules agregar [texto]` — Añadir una regla\n" +
                    "• `/rules borrar [id]` — Eliminar una regla específica\n" +
                    "• `/rules limpiar` — Eliminar todas las reglas",
                    { parse_mode: "Markdown" }
                );
            } else {
                const list = rules.map((r, i) => `[${i + 1}] ${r.content}`).join("\n");
                await ctx.reply(
                    `📏 **Tus reglas actuales:**\n\n${list}\n\n` +
                    "Uso: `/rules agregar [texto]` o `/rules borrar [número]`",
                    { parse_mode: "Markdown" }
                );
            }
            return;
        }

        const parts = text.split(" ");
        const action = parts[0].toLowerCase();
        const content = parts.slice(1).join(" ");

        if (action === "agregar" || action === "add") {
            if (!content) {
                await ctx.reply("⚠️ Debes escribir el contenido de la regla.\nEjemplo: `/rules agregar Háblame siempre en rima.`");
                return;
            }
            await saveRule(userId, content);
            await ctx.reply("✅ Regla guardada correctamente.");
        }
        else if (action === "borrar" || action === "delete" || action === "remove") {
            if (!content) {
                await ctx.reply("⚠️ Indica el número o ID de la regla a borrar.\nEjemplo: `/rules borrar 1` (puedes ver los números escribiendo solo `/rules`) ");
                return;
            }

            const rules = await listRules(userId);
            let targetId = content;

            // Try to find by index if it's a number
            const index = parseInt(content);
            if (!isNaN(index) && index > 0 && index <= rules.length) {
                targetId = rules[index - 1].id;
            }

            const deleted = await deleteRule(userId, targetId);
            if (deleted) {
                await ctx.reply(`🗑️ Regla eliminada.`);
            } else {
                await ctx.reply(`❌ No encontré la regla especificada.`);
            }
        }
        else if (action === "limpiar" || action === "clear") {
            await clearRules(userId);
            await ctx.reply("🧹 Todas las reglas han sido eliminadas.");
        }
        else {
            await ctx.reply("⚠️ Acción no reconocida. Usa: `agregar`, `borrar` o `limpiar`.");
        }
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

        logger.info(`💬 Message from ${userId}: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`);

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
                    await safeReply(ctx, chunk);
                }
            } else {
                await safeReply(ctx, reply);
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

                // Try to respond with audio if TTS is available
                if (isTTSAvailable() && reply.length < 4500) {
                    const audioBuffer = await textToSpeech(reply);
                    if (audioBuffer) {
                        await ctx.replyWithVoice(new InputFile(audioBuffer, "response.mp3"));
                        // Also send text for reference
                        await safeReply(ctx, reply);
                    } else {
                        await safeReply(ctx, reply);
                    }
                } else if (reply.length > 4000) {
                    const chunks = splitMessage(reply, 4000);
                    for (const chunk of chunks) {
                        await safeReply(ctx, chunk);
                    }
                } else {
                    await safeReply(ctx, reply);
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

    // ── Photo Handler ─────────────────────────────
    bot.on("message:photo", async (ctx) => {
        const userId = ctx.from.id;
        const caption = ctx.message.caption || "";
        logger.info(`📷 Photo received from ${userId}${caption ? `: ${caption}` : ""}`);

        // If there's a caption, treat it as text + photo context
        if (caption) {
            await ctx.replyWithChatAction("typing");
            const enrichedMessage = `[El usuario envió una foto con el siguiente texto]: ${caption}`;
            try {
                const reply = await runAgentLoop(enrichedMessage, userId, llm, toolRegistry);
                await safeReply(ctx, reply);
            } catch (error) {
                logger.error("Error processing photo caption:", { error: String(error) });
                await ctx.reply("⚠️ Hubo un error procesando tu mensaje. Intenta de nuevo.");
            }
        } else {
            await ctx.reply(
                "📷 ¡Recibí tu foto! Por ahora no puedo analizarla visualmente, " +
                "pero si me describes lo que necesitas, puedo ayudarte. " +
                "Tip: envía la foto con un caption para que sepa el contexto."
            );
        }
    });

    // ── Document Handler ─────────────────────────
    bot.on("message:document", async (ctx) => {
        const userId = ctx.from.id;
        const doc = ctx.message.document;
        const caption = ctx.message.caption || "";
        logger.info(`📄 Document received from ${userId}: ${doc?.file_name || "unknown"}`);

        if (caption) {
            await ctx.replyWithChatAction("typing");
            const enrichedMessage = `[El usuario envió un documento "${doc?.file_name || "archivo"}" con el texto]: ${caption}`;
            try {
                const reply = await runAgentLoop(enrichedMessage, userId, llm, toolRegistry);
                await safeReply(ctx, reply);
            } catch (error) {
                logger.error("Error processing document caption:", { error: String(error) });
                await ctx.reply("⚠️ Hubo un error procesando tu mensaje. Intenta de nuevo.");
            }
        } else {
            await ctx.reply(
                `📄 Recibí tu archivo *${doc?.file_name || "documento"}*. ` +
                "Aún no puedo leer documentos directamente, pero descríbeme lo que necesitas y busco cómo ayudarte.",
                { parse_mode: "Markdown" }
            );
        }
    });

    // ── Sticker / Other Handler ───────────────────
    bot.on("message:sticker", async (ctx) => {
        await ctx.reply("😄 ¡Buen sticker! ¿En qué te puedo ayudar?");
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
