// ============================================
// GARI – Logger
// ============================================
// Simple colored timestamped logger.
// Levels: debug, info, warn, error
// Debug only shows in NODE_ENV=development.

type LogLevel = "debug" | "info" | "warn" | "error";

const COLORS = {
    debug: "\x1b[36m",  // Cyan
    info: "\x1b[32m",   // Green
    warn: "\x1b[33m",   // Yellow
    error: "\x1b[31m",  // Red
    reset: "\x1b[0m",
} as const;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

class Logger {
    private minLevel: LogLevel;

    constructor() {
        this.minLevel = process.env.NODE_ENV === "production" ? "info" : "debug";
    }

    private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const timestamp = new Date().toISOString();
        const color = COLORS[level];
        const prefix = `${color}[${timestamp}] [${level.toUpperCase()}]${COLORS.reset}`;

        if (meta && Object.keys(meta).length > 0) {
            console.log(`${prefix} ${message}`, meta);
        } else {
            console.log(`${prefix} ${message}`);
        }
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        this.log("debug", message, meta);
    }

    info(message: string, meta?: Record<string, unknown>): void {
        this.log("info", message, meta);
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        this.log("warn", message, meta);
    }

    error(message: string, meta?: Record<string, unknown>): void {
        this.log("error", message, meta);
    }
}

export const logger = new Logger();
