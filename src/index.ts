// ============================================
// GARI – Entry Point
// ============================================
// Initializes all modules and starts the bot.
// Order: Config → DB → Tools → LLM → Bot → Go!

import { config } from "./config.js";
import { logger } from "./logger.js";
import { initDatabase, closeDatabase } from "./memory/db.js";
import { createLLMProvider } from "./llm/provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { getTimeTool } from "./tools/get-time.js";
import { searchWebTool } from "./tools/search.js";
import { webSearchTool } from "./tools/web-search.js";
import { googleWorkspaceTool } from "./tools/google-workspace.js";
import { codingSkillsTool } from "./tools/coding-skills.js";
import { readUrlTool } from "./tools/read-url.js";
import { runCodeTool } from "./tools/run-code.js";
import { weatherTool } from "./tools/weather.js";
import { generateImageTool } from "./tools/generate-image.js";
import { deepResearchTool } from "./tools/deep-research.js";
import { remindersTool, setReminderCallback } from "./tools/reminders.js";
import { createBot, registerTelegramCommands } from "./telegram/bot.js";
import { saveUserFactTool } from "./tools/save-user-fact.js";
import { executeShellCommandTool, readFileTool, writeFileTool, restartTool } from "./tools/system.js";
import { chartTool } from "./tools/chart.js";
import { webhookCallback } from "grammy";
import { createServer } from "node:http";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTelegramPollingConflict(error: unknown): boolean {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.toLowerCase();
    return (
        message.includes("getupdates") &&
        message.includes("409") &&
        message.includes("terminated by other getupdates request")
    );
}

async function startPollingWithRetry(bot: ReturnType<typeof createBot>, shouldStop: () => boolean): Promise<void> {
    let attempt = 0;

    while (!shouldStop()) {
        try {
            await bot.start();
            if (!shouldStop()) {
                logger.warn("Polling loop stopped unexpectedly. Retrying...");
            }
        } catch (error) {
            if (isTelegramPollingConflict(error)) {
                logger.warn(
                    "Telegram polling conflict (409). Another instance is using this bot token. Retrying without exiting."
                );
            } else {
                logger.error("Polling loop crashed.", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (shouldStop()) {
            break;
        }

        attempt += 1;
        const delayMs = Math.min(1000 * Math.pow(2, Math.min(attempt - 1, 5)), 30000);
        logger.info(`Retrying Telegram polling in ${delayMs} ms (attempt ${attempt}).`);
        await sleep(delayMs);
    }
}

async function main(): Promise<void> {
    logger.info("🚀 Starting Gari...");
    let shuttingDown = false;

    // 1. Database
    await initDatabase();

    // 2. Tool Registry
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(getTimeTool);
    toolRegistry.register(searchWebTool);
    toolRegistry.register(webSearchTool);
    toolRegistry.register(googleWorkspaceTool);
    toolRegistry.register(codingSkillsTool);
    toolRegistry.register(readUrlTool);
    toolRegistry.register(runCodeTool);
    toolRegistry.register(weatherTool);
    toolRegistry.register(generateImageTool);
    toolRegistry.register(deepResearchTool);
    toolRegistry.register(remindersTool);
    toolRegistry.register(saveUserFactTool);
    toolRegistry.register(executeShellCommandTool);
    toolRegistry.register(readFileTool);
    toolRegistry.register(writeFileTool);
    toolRegistry.register(restartTool);
    toolRegistry.register(chartTool);
    logger.info(`🔧 ${toolRegistry.size} tool(s) registered: ${toolRegistry.listNames().join(", ")}`);

    // 3. LLM Provider
    const llm = createLLMProvider();

    // 4. Telegram Bot
    const bot = createBot(llm, toolRegistry);
    await registerTelegramCommands(bot);

    // Wire reminders to send Telegram messages when they fire
    setReminderCallback(async (reminder) => {
        try {
            for (const userId of config.TELEGRAM_ALLOWED_USER_IDS) {
                await bot.api.sendMessage(
                    userId,
                    `⏰ **¡Recordatorio!**\n\n📝 ${reminder.message}`,
                    { parse_mode: "Markdown" }
                );
            }
        } catch (e) {
            logger.error("Failed to send reminder notification:", { error: String(e) });
        }
    });

    // 5. Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info(`\n📴 Received ${signal}. Shutting down gracefully...`);
        shuttingDown = true;
        bot.stop();
        await closeDatabase();
        logger.info("👋 Gari stopped. ¡Hasta pronto!");
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    // 6. Start!
    logger.info("──────────────────────────────────────");
    logger.info("🤖 Gari is online and listening on Telegram!");
    logger.info(`👤 Allowed users: ${config.TELEGRAM_ALLOWED_USER_IDS.join(", ")}`);
    logger.info("──────────────────────────────────────");

    const configuredWebhookUrl = config.TELEGRAM_WEBHOOK_URL.trim();
    const inferredWebhookUrl = process.env.RENDER_EXTERNAL_URL?.trim()
        ? `${process.env.RENDER_EXTERNAL_URL.trim().replace(/\/+$/, "")}/telegram/webhook`
        : "";
    const webhookUrl = config.TELEGRAM_FORCE_POLLING
        ? ""
        : configuredWebhookUrl || inferredWebhookUrl;
    const webhookSecret = config.TELEGRAM_WEBHOOK_SECRET.trim();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    const host = "0.0.0.0";

    if (webhookUrl) {
        await bot.init();
        await bot.api.setWebhook(webhookUrl, webhookSecret ? { secret_token: webhookSecret } : {});
        logger.info(`🔗 Webhook mode enabled: ${webhookUrl}`);

        const handleUpdate = webhookCallback(bot, "http", {
            // Avoid crashing the process when a response takes >10s.
            // Telegram can retry updates; we keep the bot alive and continue processing.
            onTimeout: "return",
            timeoutMilliseconds: 30000,
        });
        const server = createServer((req, res) => {
            const requestPath = req.url?.split("?")[0] || "/";

            if (req.method === "POST" && requestPath === "/telegram/webhook") {
                if (webhookSecret) {
                    const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
                    if (receivedSecret !== webhookSecret) {
                        res.writeHead(401, { "Content-Type": "text/plain" });
                        res.end("Unauthorized");
                        return;
                    }
                }
                handleUpdate(req, res);
                return;
            }

            if (requestPath === "/" || requestPath === "/health") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("Gari is running!");
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
        });

        server.on("error", (err: unknown) => {
            const error = err as NodeJS.ErrnoException;
            logger.error("❌ Failed to start webhook HTTP server.", {
                code: error?.code,
                message: error?.message,
                port,
            });
            process.exit(1);
        });

        server.listen(port, host, () => {
            logger.info(`🌐 HTTP server listening on http://${host}:${port}`);
        });
    } else {
        if (config.TELEGRAM_FORCE_POLLING) {
            logger.info("ℹ️ TELEGRAM_FORCE_POLLING=true. Usando polling para mayor estabilidad.");
        } else if (process.env.RENDER_EXTERNAL_URL?.trim()) {
            logger.info("ℹ️ RENDER_EXTERNAL_URL detectado, pero webhook deshabilitado. Usando polling para mayor estabilidad.");
        }
        await bot.api.deleteWebhook({ drop_pending_updates: false });
        logger.info("📡 Polling mode enabled (no webhook URL configured).");

        const server = createServer((req, res) => {
            const requestPath = req.url?.split("?")[0] || "/";
            if (requestPath === "/" || requestPath === "/health") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("Gari is running!");
                return;
            }
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
        });

        void startPollingWithRetry(bot, () => shuttingDown);

        server.on("error", (err: unknown) => {
            const error = err as NodeJS.ErrnoException;
            if (error?.code === "EADDRINUSE") {
                logger.warn(`⚠️ Health server port ${port} is already in use. Continuing in polling mode without local HTTP health endpoint.`);
                return;
            }
            logger.error("❌ Failed to start local health check server.", {
                code: error?.code,
                message: error?.message,
                port,
            });
        });

        server.listen(port, host, () => {
            logger.info(`🌐 Health check server listening on http://${host}:${port}`);
        });
    }
}

main().catch((error) => {
    logger.error("Fatal error during startup:", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
