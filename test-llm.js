import { GroqProvider } from "./src/llm/groq.js";
import { config } from "./src/config.js";

async function testGroq() {
    console.log("Testing Groq API with your key...");
    const provider = new GroqProvider(config.GROQ_API_KEY);
    try {
        const response = await provider.chat([
            { role: "user", content: "Hola, ¿quién eres?" }
        ], []);
        console.log("Success! Groq replied:", response.message.content);
    } catch (error) {
        console.error("Groq Test Failed!");
        console.error("Status:", error.status);
        console.error("Message:", error.message);
    }
}

testGroq();
