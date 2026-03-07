// ============================================
// GARI – Weather Tool
// ============================================
// Uses wttr.in free API — no API key required.

import { ToolDefinition } from "../types.js";
import { logger } from "../logger.js";

export const weatherTool: ToolDefinition = {
    name: "get_weather",
    description:
        "Get current weather and 3-day forecast for a location. " +
        "Use when the user asks about weather, temperature, or climate conditions.",
    parameters: {
        type: "object",
        properties: {
            location: {
                type: "string",
                description: "City name or location (e.g., 'Bogotá', 'New York', 'Tokyo').",
            },
        },
        required: ["location"],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
        const location = args.location as string;

        logger.info(`🌤️ Getting weather for: ${location}`);

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);

            const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=es`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) {
                return `Error: Could not fetch weather for "${location}" (HTTP ${res.status}).`;
            }

            const data = await res.json() as any;
            const current = data.current_condition?.[0];

            if (!current) {
                return `No weather data found for "${location}".`;
            }

            // Extract readable weather info
            const desc = current.lang_es?.[0]?.value || current.weatherDesc?.[0]?.value || "N/A";
            const tempC = current.temp_C;
            const feelsLike = current.FeelsLikeC;
            const humidity = current.humidity;
            const windKmph = current.windspeedKmph;
            const windDir = current.winddir16Point;
            const visibility = current.visibility;

            let result = `🌍 **Clima en ${location}**\n\n`;
            result += `☁️ ${desc}\n`;
            result += `🌡️ Temperatura: ${tempC}°C (sensación: ${feelsLike}°C)\n`;
            result += `💧 Humedad: ${humidity}%\n`;
            result += `💨 Viento: ${windKmph} km/h (${windDir})\n`;
            result += `👁️ Visibilidad: ${visibility} km\n`;

            // 3-day forecast
            const forecast = data.weather;
            if (forecast && forecast.length > 0) {
                result += "\n📅 **Pronóstico:**\n";
                for (const day of forecast.slice(0, 3)) {
                    const date = day.date;
                    const maxC = day.maxtempC;
                    const minC = day.mintempC;
                    const dayDesc = day.hourly?.[4]?.lang_es?.[0]?.value
                        || day.hourly?.[4]?.weatherDesc?.[0]?.value
                        || "N/A";
                    result += `• ${date}: ${minC}°C – ${maxC}°C, ${dayDesc}\n`;
                }
            }

            return result;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return `Error: Weather request timed out for "${location}".`;
            }
            return `Error getting weather: ${error instanceof Error ? error.message : String(error)}`;
        }
    },
};
