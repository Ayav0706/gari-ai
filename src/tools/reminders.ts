// ============================================
// GARI – Reminders Tool
// ============================================
// In-memory reminders with setTimeout scheduling.
// Fires a callback when due; integrates with bot.ts
// for Telegram notifications.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

export interface Reminder {
    id: string;
    message: string;
    trigger_at: number;  // Unix timestamp (ms)
    created_at: number;
    user_id?: number;
}

type ReminderCallback = (reminder: Reminder) => void;

// ── In-memory store (survives within process lifetime) ──
const activeReminders: Map<string, { reminder: Reminder; timer: NodeJS.Timeout }> = new Map();
let nextId = 1;
let onReminderFired: ReminderCallback | null = null;

/**
 * Register a callback for when reminders fire.
 * Called from bot.ts to wire up Telegram notifications.
 */
export function setReminderCallback(cb: ReminderCallback): void {
    onReminderFired = cb;
}

function scheduleReminder(reminder: Reminder): void {
    const delay = Math.max(0, reminder.trigger_at - Date.now());

    const timer = setTimeout(() => {
        logger.info(`⏰ Reminder fired: ${reminder.message}`);
        activeReminders.delete(reminder.id);
        onReminderFired?.(reminder);
    }, delay);

    // Don't block process exit for reminders
    timer.unref();

    activeReminders.set(reminder.id, { reminder, timer });
}

export const remindersTool: ToolDefinition = {
    name: "manage_reminders",
    description:
        "Create, list, or delete reminders. Reminders fire after the specified delay and " +
        "notify the user via Telegram. Use when the user says 'remind me', 'recordar', " +
        "'avísame en X minutos', etc.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                description: "Action to perform.",
                enum: ["create", "list", "delete"],
            },
            minutes: {
                type: "number",
                description: "Minutes from now to fire the reminder (required for 'create').",
            },
            message: {
                type: "string",
                description: "Reminder message text (required for 'create').",
            },
            reminder_id: {
                type: "string",
                description: "ID of the reminder to delete (required for 'delete').",
            },
        },
        required: ["action"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const action = args.action as string;

        switch (action) {
            case "create": {
                const minutes = args.minutes as number;
                const message = args.message as string;

                if (!minutes || minutes <= 0) {
                    return "Error: 'minutes' must be a positive number.";
                }
                if (!message?.trim()) {
                    return "Error: 'message' is required for creating a reminder.";
                }

                const id = `rem_${nextId++}`;
                const now = Date.now();
                const reminder: Reminder = {
                    id,
                    message,
                    trigger_at: now + minutes * 60_000,
                    created_at: now,
                };

                scheduleReminder(reminder);

                const fireTime = new Date(reminder.trigger_at).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                });

                logger.info(`⏰ Reminder created: ${id} — "${message}" in ${minutes}min`);
                return `✅ Recordatorio creado (${id}):\n📝 "${message}"\n⏰ Se activará en ${minutes} minuto(s) (~${fireTime})`;
            }

            case "list": {
                if (activeReminders.size === 0) {
                    return "📋 No tienes recordatorios activos.";
                }

                const lines = Array.from(activeReminders.values()).map(({ reminder }) => {
                    const remaining = Math.max(0, Math.round((reminder.trigger_at - Date.now()) / 60_000));
                    return `• **${reminder.id}**: "${reminder.message}" — en ${remaining} min`;
                });

                return `📋 **Recordatorios activos (${activeReminders.size}):**\n\n${lines.join("\n")}`;
            }

            case "delete": {
                const remId = args.reminder_id as string;
                if (!remId) return "Error: 'reminder_id' is required for deleting.";

                const entry = activeReminders.get(remId);
                if (!entry) return `❌ No se encontró el recordatorio "${remId}".`;

                clearTimeout(entry.timer);
                activeReminders.delete(remId);
                return `🗑️ Recordatorio "${remId}" eliminado.`;
            }

            default:
                return `Error: Unknown action "${action}". Use "create", "list", or "delete".`;
        }
    },
};
