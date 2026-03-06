// ============================================
// GARI – Logger
// ============================================
// Simple timestamped logger. NEVER logs secrets or sensitive data.

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: "\x1b[90m", // gray
    info: "\x1b[36m",  // cyan
    warn: "\x1b[33m",  // yellow
    error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

class Logger {
    private minLevel: LogLevel;

    constructor(minLevel: LogLevel = "info") {
        this.minLevel = minLevel;
    }

    private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const timestamp = new Date().toISOString();
        const color = LEVEL_COLORS[level];
        const prefix = `${color}[${timestamp}] [${level.toUpperCase()}]${RESET}`;

        if (meta) {
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

export const logger = new Logger(
    (process.env.LOG_LEVEL as LogLevel) ?? "info"
);
