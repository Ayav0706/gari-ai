import { logger } from "./logger.js";
import { ToolRegistry } from "./tools/registry.js";
import { getTimeTool } from "./tools/get-time.js";
import { executeShellCommandTool, readFileTool } from "./tools/system.js";

async function testTools() {
    logger.info("🔧 Building and testing tools functionality...");

    const toolRegistry = new ToolRegistry();

    try {
        // Register a few key tools
        toolRegistry.register(getTimeTool);
        toolRegistry.register(executeShellCommandTool);
        toolRegistry.register(readFileTool);
        
        logger.info(`✅ Registered tools: ${toolRegistry.listNames().join(", ")}`);

        // Test 1: Get Time Tool
        logger.info("\n🧪 Testing get_current_time...");
        const timeResult = await toolRegistry.execute("get_current_time", JSON.stringify({ timezone: "UTC" }));
        logger.info(`Result: ${timeResult}`);

        // Test 2: Execute Shell Command Tool
        logger.info("\n🧪 Testing execute_shell_command (echo test)...");
        const shellResult = await toolRegistry.execute("execute_shell_command", JSON.stringify({ command: "echo Hello from testTools" }));
        logger.info(`Result: ${shellResult}`);
        
        // Final result matching
        if (timeResult.includes("timezone") && shellResult.includes("Hello from testTools")) {
            logger.info("\n🎉 All tests passed successfully!");
        } else {
            logger.warn("\n⚠️ Some tests might not have produced the expected output.");
        }
    } catch (e) {
        logger.error("❌ Test tools failed", { error: String(e) });
        process.exit(1);
    }
}

testTools();
