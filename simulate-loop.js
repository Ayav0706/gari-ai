import { runAgentLoop } from "./src/agent/loop.js";
import { createLLMProvider } from "./src/llm/provider.js";
import { ToolRegistry } from "./src/tools/registry.js";
import { getTimeTool } from "./src/tools/get-time.js";
import { searchWebTool } from "./src/tools/search.js";
import { initDatabase } from "./src/memory/db.js";

async function simulate() {
    console.log("Starting local simulation...");
    await initDatabase();

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(getTimeTool);
    toolRegistry.register(searchWebTool);

    const llm = createLLMProvider();
    const userId = 1652942077; // Anthony's ID
    const userMessage = "Ya puedes buscar en internet gari ?";

    console.log(`User says: ${userMessage}`);
    try {
        const reply = await runAgentLoop(userMessage, userId, llm, toolRegistry);
        console.log("Gari replies:", reply);
    } catch (e) {
        console.error("SIMULATION CRASHED:", e);
    }
}

simulate();
