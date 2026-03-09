// ============================================
// GARI – Configuration Layer
// ============================================
// Loads and validates environment variables using Zod.
// Fails fast at startup if anything is missing or invalid.

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    // Telegram
    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    TELEGRAM_ALLOWED_USER_IDS: z
        .string()
        .min(1, "TELEGRAM_ALLOWED_USER_IDS is required")
        .transform((val) =>
            val
                .split(",")
                .map((id) => parseInt(id.trim(), 10))
                .filter((id) => !isNaN(id))
        ),
    TELEGRAM_WEBHOOK_URL: z.string().default(""),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(""),

    // Groq (primary LLM)
    GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
    GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

    // OpenRouter (fallback LLM)
    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_MODEL: z
        .string()
        .default("meta-llama/llama-3.3-70b-instruct:free"),

    // Kimi (another LLM option)
    KIMI_API_KEY: z.string().default(""),
    CRITIC_PASS_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v.trim().toLowerCase() !== "false"),

    // Database
    DB_PATH: z.string().default("./data/memory.db"),

    // Firebase credentials
    GOOGLE_APPLICATION_CREDENTIALS: z.string().default("./service-account.json"),

    // ElevenLabs TTS (optional)
    ELEVENLABS_API_KEY: z.string().default(""),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error("❌ Invalid environment configuration:");
        for (const issue of result.error.issues) {
            console.error(`   • ${issue.path.join(".")}: ${issue.message}`);
        }
        process.exit(1);
    }

    return Object.freeze(result.data) as Config;
}

export const config = loadConfig();
