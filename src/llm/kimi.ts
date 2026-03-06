// ============================================
// GARI – Kimi (Moonshot AI) LLM Provider
// ============================================
// OpenAI-compatible API for Kimi.

import { logger } from "../logger.js";
import type { LLMMessage, LLMProvider, LLMResponse, ToolSchema } from "../types.js";

const KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions";
const KIMI_MODEL = "moonshot-v1-8k"; // Default robust model

export class KimiProvider implements LLMProvider {
    readonly name = "Kimi";
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async chat(messages: LLMMessage[], tools: ToolSchema[] = []): Promise<LLMResponse> {
        try {
            const body: any = {
                model: KIMI_MODEL,
                messages,
                temperature: 0.3,
            };

            if (tools.length > 0) {
                body.tools = tools.map(t => ({
                    type: "function",
                    function: t
                }));
            }

            const response = await fetch(KIMI_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json();
                logger.error(`Kimi API error (${response.status}):`, errorData);
                throw new Error(`KIMI_API_ERROR: ${response.status}`);
            }

            const data = await response.json();
            const choice = data.choices[0];

            return {
                message: choice.message,
                finish_reason: choice.finish_reason,
            };
        } catch (error: any) {
            logger.error(`Kimi chat failed: ${error.message}`);
            throw error;
        }
    }
}
