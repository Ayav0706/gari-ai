// ============================================
// GARI – Tool: get_current_time
// ============================================
// Returns the current date and time in a specified timezone.

import type { ToolDefinition } from "../types.js";

export const getTimeTool: ToolDefinition = {
    name: "get_current_time",
    description:
        "Returns the current date and time. " +
        "Use this when the user asks what time it is, the current date, or anything related to the current moment.",
    parameters: {
        type: "object",
        properties: {
            timezone: {
                type: "string",
                description:
                    'IANA timezone identifier (e.g. "America/New_York", "Europe/Madrid", "UTC"). ' +
                    "Defaults to the system local timezone if not provided.",
                default: "local",
            },
        },
        required: [],
    },

    execute: async (args: Record<string, unknown>): Promise<string> => {
        const tz = (args.timezone as string) || "local";

        try {
            const now = new Date();

            if (tz === "local") {
                return JSON.stringify({
                    datetime: now.toLocaleString("es-ES", {
                        dateStyle: "full",
                        timeStyle: "long",
                    }),
                    iso: now.toISOString(),
                    timestamp: now.getTime(),
                });
            }

            return JSON.stringify({
                datetime: now.toLocaleString("es-ES", {
                    timeZone: tz,
                    dateStyle: "full",
                    timeStyle: "long",
                }),
                timezone: tz,
                iso: now.toISOString(),
                timestamp: now.getTime(),
            });
        } catch {
            return JSON.stringify({
                error: `Invalid timezone: "${tz}". Use IANA format like "America/New_York".`,
            });
        }
    },
};
