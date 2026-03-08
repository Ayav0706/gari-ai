import { google } from "googleapis";
import type { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";
import fs from "fs/promises";
import path from "path";
import process from "process";

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

async function authorize() {
    try {
        const content = await fs.readFile(TOKEN_PATH, "utf-8");
        const credentials = JSON.parse(content);
        const auth = google.auth.fromJSON(credentials) as any;
        return auth;
    } catch (err) {
        throw new Error("No se encontró token.json. Ejecuta 'npx tsx src/tools/auth-google.ts' primero.");
    }
}

export const googleWorkspaceTool: ToolDefinition = {
    name: "google_workspace",
    description:
        "Interactúa con Google Workspace (Gmail, Calendar, Drive). " +
        "Permite buscar correos, leer eventos y buscar archivos usando la API oficial.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["search_emails", "list_events", "search_drive_files"],
                description: "La acción a realizar en Google Workspace.",
            },
            query: {
                type: "string",
                description: "Consulta de búsqueda (ej. 'from:juan' para correos o 'nombre_archivo' para Drive).",
            },
            maxResults: {
                type: "number",
                description: "Cantidad máxima de resultados (por defecto 5).",
                default: 5
            }
        },
        required: ["action"],
    },

    execute: async (args: Record<string, unknown>): Promise<string> => {
        try {
            const auth = await authorize();
            const rawAction = String(args.action || "");
            const action = rawAction
                .toLowerCase()
                .replace(/\s+/g, "_")
                .replace(/-/g, "_");
            const query = args.query as string || "";
            const max = (args.maxResults as number) || 5;

            if (action === "search_emails" || action === "searchemails") {
                const gmail = google.gmail({ version: "v1", auth });
                const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: max });
                
                if (!res.data.messages || res.data.messages.length === 0) return "No se encontraron correos.";
                
                let emails = [];
                for (const msg of res.data.messages) {
                    const msgData = await gmail.users.messages.get({ userId: "me", id: msg.id! });
                    const headers = msgData.data.payload?.headers;
                    const subject = headers?.find(h => h.name === "Subject")?.value;
                    const from = headers?.find(h => h.name === "From")?.value;
                    const snippet = msgData.data.snippet;
                    emails.push(`De: ${from}\nAsunto: ${subject}\nSnippet: ${snippet}`);
                }
                return emails.join("\n\n---\n\n");
            }

            if (action === "list_events" || action === "listevents") {
                const calendar = google.calendar({ version: "v3", auth });
                const res = await calendar.events.list({
                    calendarId: "primary",
                    timeMin: new Date().toISOString(),
                    maxResults: max,
                    singleEvents: true,
                    orderBy: "startTime",
                });
                const events = res.data.items;
                if (!events || events.length === 0) return "No hay eventos próximos.";
                return events.map(e => `${e.start?.dateTime || e.start?.date}: ${e.summary}`).join("\n");
            }

            if (action === "search_drive_files" || action === "searchdrivefiles") {
                const drive = google.drive({ version: "v3", auth });
                let q = "trashed = false";
                if (query) q += ` and name contains '${query}'`;
                
                const res = await drive.files.list({
                    q,
                    fields: "nextPageToken, files(id, name, webViewLink)",
                    spaces: "drive",
                    pageSize: max,
                });
                const files = res.data.files;
                if (!files || files.length === 0) return "No se encontraron archivos.";
                return files.map(f => `Nombre: ${f.name}\nLink: ${f.webViewLink}`).join("\n\n");
            }

            return `Acción no reconocida: ${rawAction}`;
        } catch (error: any) {
            logger.error(`Error en Google Workspace: ${error.message}`);
            return `Ocurrió un error con la API de Google: ${error.message}`;
        }
    },
};
