import type { ToolDefinition } from "../types.js";

type ChartDatasetInput = {
    label?: string;
    values?: unknown;
    borderColor?: string;
    backgroundColor?: string;
    fill?: boolean;
    yAxisID?: string;
    lineTension?: number;
    pointRadius?: number;
    borderWidth?: number;
};

type ChartRegionInput = {
    start_label?: string;
    end_label?: string;
    color?: string;
    label?: string;
    draw_label?: boolean;
};

type ChartPointAnnotationInput = {
    label?: string;
    x_label?: string;
    y?: number;
    color?: string;
};

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

function toDatasetArray(input: unknown): ChartDatasetInput[] {
    if (!Array.isArray(input)) return [];
    return input.map((item) => (typeof item === "object" && item !== null ? item as ChartDatasetInput : {}));
}

function toRegionsArray(input: unknown): ChartRegionInput[] {
    if (!Array.isArray(input)) return [];
    return input.map((item) => (typeof item === "object" && item !== null ? item as ChartRegionInput : {}));
}

function toPointAnnotationsArray(input: unknown): ChartPointAnnotationInput[] {
    if (!Array.isArray(input)) return [];
    return input.map((item) => (typeof item === "object" && item !== null ? item as ChartPointAnnotationInput : {}));
}

function fallbackPalette(index: number): string {
    const colors = ["#2563eb", "#b91c1c", "#0f766e", "#7c3aed", "#f59e0b", "#059669"];
    return colors[index % colors.length];
}

function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return `rgba(37,99,235,${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export const chartTool: ToolDefinition = {
    name: "generate_chart",
    description:
        "Genera un gráfico (simple o avanzado) y devuelve una imagen lista para enviar en Telegram.",
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
            datasets: {
                type: "array",
                description: "Series avanzadas (opcional). Si se envía, reemplaza values/dataset_label.",
                items: { type: "object" },
            },
            dataset_label: {
                type: "string",
                description: "Nombre de la serie de datos.",
                default: "Datos",
            },
            subtitle: {
                type: "string",
                description: "Subtítulo opcional.",
            },
            y_axis_label: {
                type: "string",
                description: "Etiqueta del eje Y.",
            },
            style_preset: {
                type: "string",
                enum: ["default", "economic_report"],
                description: "Preset visual del gráfico.",
                default: "default",
            },
            regions: {
                type: "array",
                description: "Franjas de periodo para sombrear secciones del gráfico.",
                items: { type: "object" },
            },
            point_annotations: {
                type: "array",
                description: "Anotaciones puntuales tipo etiqueta.",
                items: { type: "object" },
            },
        },
        required: ["chart_type", "labels"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const chartType = String(args.chart_type || "bar");
        const title = String(args.title || "Gráfico");
        const datasetLabel = String(args.dataset_label || "Datos");
        const subtitle = String(args.subtitle || "");
        const yAxisLabel = String(args.y_axis_label || "");
        const stylePreset = String(args.style_preset || "default");
        const labels = toStringArray(args.labels);
        const values = toNumberArray(args.values);
        const advancedDatasets = toDatasetArray(args.datasets);
        const regions = toRegionsArray(args.regions);
        const pointAnnotations = toPointAnnotationsArray(args.point_annotations);

        if (labels.length === 0) {
            return "Error: labels debe existir y tener al menos un elemento.";
        }

        const datasets = advancedDatasets.length > 0
            ? advancedDatasets
                .map((d, i) => {
                    const dsValues = toNumberArray(d.values);
                    if (dsValues.length === 0 || dsValues.length !== labels.length) return null;
                    const borderColor = typeof d.borderColor === "string" ? d.borderColor : fallbackPalette(i);
                    return {
                        type: chartType,
                        label: String(d.label || `Serie ${i + 1}`),
                        data: dsValues,
                        borderColor,
                        backgroundColor: typeof d.backgroundColor === "string" ? d.backgroundColor : hexToRgba(borderColor, chartType === "line" ? 0.2 : 0.75),
                        borderWidth: Number.isFinite(d.borderWidth) ? Number(d.borderWidth) : (chartType === "line" ? 2.2 : 1.5),
                        fill: typeof d.fill === "boolean" ? d.fill : false,
                        lineTension: Number.isFinite(d.lineTension) ? Number(d.lineTension) : 0.12,
                        pointRadius: Number.isFinite(d.pointRadius) ? Number(d.pointRadius) : (chartType === "line" ? 1.8 : 0),
                        yAxisID: typeof d.yAxisID === "string" ? d.yAxisID : "y-axis-0",
                    };
                })
                .filter((d): d is NonNullable<typeof d> => Boolean(d))
            : [];

        if (datasets.length === 0) {
            if (values.length === 0 || labels.length !== values.length) {
                return "Error: labels y values deben existir y tener la misma longitud.";
            }
            datasets.push({
                type: chartType,
                label: datasetLabel,
                data: values,
                borderColor: "#2563eb",
                backgroundColor: chartType === "line" ? "rgba(37,99,235,0.2)" : "rgba(37,99,235,0.75)",
                borderWidth: chartType === "line" ? 2.2 : 1.5,
                fill: false,
                lineTension: 0.12,
                pointRadius: chartType === "line" ? 1.8 : 0,
                yAxisID: "y-axis-0",
            });
        }

        const annotationEntries: any[] = [];

        for (const region of regions) {
            if (!region.start_label || !region.end_label) continue;
            annotationEntries.push({
                type: "box",
                xScaleID: "x-axis-0",
                xMin: String(region.start_label),
                xMax: String(region.end_label),
                backgroundColor: typeof region.color === "string" ? region.color : "rgba(148,163,184,0.18)",
                borderWidth: 0,
                label: region.draw_label && region.label
                    ? {
                        enabled: true,
                        content: String(region.label),
                        position: "top",
                        yAdjust: -8,
                        backgroundColor: "rgba(15,23,42,0.75)",
                        fontColor: "#ffffff",
                        fontSize: 10,
                    }
                    : undefined,
            });
        }

        for (const note of pointAnnotations) {
            if (!note.x_label || !Number.isFinite(note.y)) continue;
            annotationEntries.push({
                type: "label",
                xScaleID: "x-axis-0",
                yScaleID: "y-axis-0",
                xValue: String(note.x_label),
                yValue: Number(note.y),
                content: [String(note.label || "")],
                backgroundColor: typeof note.color === "string" ? note.color : "rgba(30,41,59,0.82)",
                fontColor: "#ffffff",
                fontSize: 10,
                borderRadius: 4,
                yAdjust: -14,
            });
        }

        const useEconomicPreset = stylePreset === "economic_report";

        const config = {
            type: chartType,
            data: {
                labels,
                datasets,
            },
            options: {
                elements: {
                    line: { tension: useEconomicPreset ? 0.08 : 0.12 },
                },
                scales: {
                    xAxes: [
                        {
                            gridLines: {
                                color: useEconomicPreset ? "rgba(15,23,42,0.08)" : "rgba(148,163,184,0.2)",
                                zeroLineColor: "rgba(148,163,184,0.3)",
                            },
                            ticks: { fontSize: 10 },
                        },
                    ],
                    yAxes: [
                        {
                            gridLines: {
                                color: useEconomicPreset ? "rgba(15,23,42,0.08)" : "rgba(148,163,184,0.2)",
                                zeroLineColor: "rgba(148,163,184,0.3)",
                            },
                            ticks: { beginAtZero: true, fontSize: 10 },
                            scaleLabel: {
                                display: Boolean(yAxisLabel),
                                labelString: yAxisLabel || undefined,
                            },
                        },
                    ],
                },
                plugins: {
                    title: {
                        display: true,
                        text: subtitle ? [title, subtitle] : title,
                        fontSize: useEconomicPreset ? 18 : 15,
                    },
                    legend: {
                        display: datasets.length > 1 || (chartType !== "bar" && chartType !== "line"),
                        position: "top",
                        labels: { boxWidth: 14, fontSize: 11 },
                    },
                },
                annotation: annotationEntries.length > 0 ? { annotations: annotationEntries } : undefined,
                layout: {
                    padding: useEconomicPreset
                        ? { top: 18, right: 16, bottom: 12, left: 12 }
                        : { top: 8, right: 8, bottom: 8, left: 8 },
                },
            },
        };

        const encoded = encodeURIComponent(JSON.stringify(config));
        const width = useEconomicPreset ? 1400 : 900;
        const height = useEconomicPreset ? 760 : 500;
        const url = `https://quickchart.io/chart?width=${width}&height=${height}&format=png&c=${encoded}`;
        return `CHART_URL:${url}\nCHART_TITLE:${title}`;
    },
};
