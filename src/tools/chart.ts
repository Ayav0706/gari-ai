import type { ToolDefinition } from "../types.js";

function toNumberArray(input: unknown): number[] {
    if (Array.isArray(input)) {
        return input.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    }
    return [];
}

function toStringArray(input: unknown): string[] {
    if (Array.isArray(input)) {
        return input.map((v) => String(v));
    }
    return [];
}

export const chartTool: ToolDefinition = {
    name: "generate_chart",
    description:
        "Genera un gráfico (líneas, barras o pastel) y devuelve una imagen lista para enviar en Telegram.",
    parameters: {
        type: "object",
        properties: {
            chart_type: {
                type: "string",
                enum: ["bar", "line", "pie", "doughnut"],
                description: "Tipo de gráfico.",
            },
            title: {
                type: "string",
                description: "Título del gráfico.",
            },
            labels: {
                type: "array",
                description: "Etiquetas del eje/categorías.",
                items: { type: "string" },
            },
            values: {
                type: "array",
                description: "Valores numéricos.",
                items: { type: "number" },
            },
            dataset_label: {
                type: "string",
                description: "Nombre de la serie de datos.",
                default: "Datos",
            },
        },
        required: ["chart_type", "labels", "values"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const chartType = String(args.chart_type || "bar");
        const title = String(args.title || "Gráfico");
        const datasetLabel = String(args.dataset_label || "Datos");
        const labels = toStringArray(args.labels);
        const values = toNumberArray(args.values);

        if (labels.length === 0 || values.length === 0 || labels.length !== values.length) {
            return "Error: labels y values deben existir y tener la misma longitud.";
        }

        const config = {
            type: chartType,
            data: {
                labels,
                datasets: [
                    {
                        label: datasetLabel,
                        data: values,
                        backgroundColor: [
                            "#2563eb",
                            "#14b8a6",
                            "#f59e0b",
                            "#ef4444",
                            "#8b5cf6",
                            "#22c55e",
                        ],
                    },
                ],
            },
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: title,
                    },
                    legend: {
                        display: chartType !== "bar" && chartType !== "line",
                    },
                },
            },
        };

        const encoded = encodeURIComponent(JSON.stringify(config));
        const url = `https://quickchart.io/chart?width=900&height=500&format=png&c=${encoded}`;
        return `CHART_URL:${url}\nCHART_TITLE:${title}`;
    },
};

