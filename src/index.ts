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
import { createBot } from "./telegram/bot.js";

async function main(): Promise<void> {
    logger.info("🚀 Starting Gari...");

    // 1. Database
    await initDatabase();

    // 2. Tool Registry
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(getTimeTool);
    logger.info(`🔧 ${toolRegistry.size} tool(s) registered: ${toolRegistry.listNames().join(", ")}`);

    // 3. LLM Provider
    const llm = createLLMProvider();

    // 4. Telegram Bot
    const bot = createBot(llm, toolRegistry);

    // 5. Graceful shutdown
    const shutdown = async (signal: string) => {
        logger.info(`\n📴 Received ${signal}. Shutting down gracefully...`);
        bot.stop();
        closeDatabase();
        logger.info("👋 Gari stopped. ¡Hasta pronto!");
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    // 5.5 Dummy HTTP Server for Cloud Providers (Render, Koyeb, etc.)
    // Cloud platforms require an HTTP server to bind to a port to keep the container alive.
    import("node:http").then(({ createServer }) => {
        const port = process.env.PORT || 3000;
        const server = createServer((req, res) => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Gari is running!");
        });
        server.listen(port, () => {
            logger.info(`🌐 Health check server listening on port ${port}`);
        });
    });

    // 6. Start!
    logger.info("──────────────────────────────────────");
    logger.info("🤖 Gari is online and listening on Telegram!");
    logger.info(`👤 Allowed users: ${config.TELEGRAM_ALLOWED_USER_IDS.join(", ")}`);
    logger.info("──────────────────────────────────────");

    bot.start();
}

main().catch((error) => {
    logger.error("Fatal error during startup:", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
