// ============================================
// GARI – ElevenLabs Text-to-Speech
// ============================================
// Converts text responses to audio using ElevenLabs API.
// Returns a Buffer with the audio data (mp3).

import { config } from "../config.js";
import { logger } from "../logger.js";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export function isTTSAvailable(): boolean {
    return !!config.ELEVENLABS_API_KEY;
}

export async function textToSpeech(text: string): Promise<Buffer | null> {
    if (!config.ELEVENLABS_API_KEY) {
        return null;
    }
    const truncatedText = text.length > 4500 ? text.slice(0, 4500) + "..." : text;
    try {
        const res = await fetch(`${ELEVENLABS_API_URL}/${DEFAULT_VOICE_ID}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "xi-api-key": config.ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
                text: truncatedText,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true,
                },
            }),
        });
        if (!res.ok) {
            const errorText = await res.text();
            logger.error(`ElevenLabs API error (${res.status}):`, { error: errorText });
            return null;
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        logger.error("ElevenLabs TTS failed:", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
