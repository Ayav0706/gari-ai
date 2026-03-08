import { googleWorkspaceTool } from "./src/tools/google-workspace";
import { logger } from "./src/logger";

async function test() {
    console.log("--- TEST DE GOOGLE WORKSPACE ---");
    
    console.log("\nProbadno 'search_emails'...");
    const emails = await googleWorkspaceTool.execute({ action: "search_emails", maxResults: 2 });
    console.log(emails);

    console.log("\nProbandno 'list_events'...");
    const events = await googleWorkspaceTool.execute({ action: "list_events", maxResults: 2 });
    console.log(events);

    console.log("\nProbandno 'search_drive_files'...");
    const files = await googleWorkspaceTool.execute({ action: "search_drive_files", maxResults: 2 });
    console.log(files);
}

test().catch(err => console.error("Error en el test:", err));
