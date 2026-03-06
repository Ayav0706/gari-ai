const RENDER_API_KEY = "rnd_Mvcz4TvloakmthSqcrY5XTuVu6Mi";
const GITHUB_REPO = "https://github.com/Ayav0706/gari-ai";

import { readFileSync } from "node:fs";

async function createRenderService() {
    console.log("Fetching owner info...");
    const ownersRes = await fetch("https://api.render.com/v1/owners", {
        headers: {
            "Authorization": `Bearer ${RENDER_API_KEY}`,
            "Accept": "application/json"
        }
    });
    const ownersData = await ownersRes.json();
    if (!ownersRes.ok) {
        console.error("Failed to fetch owners:", ownersData);
        process.exit(1);
    }

    // Pick the first owner (usually the user's personal account)
    const ownerId = ownersData[0].owner.id;
    console.log("Owner ID:", ownerId);

    // Read the database credentials to inject as an ENV var
    // Since we created the code to read it from `FIREBASE_CREDENTIALS`
    let firebaseCreds = "";
    try {
        firebaseCreds = readFileSync("./service-account.json", "utf-8");
    } catch (e) {
        console.error("Could not read service-account.json", e);
        process.exit(1);
    }

    // We also need the other env vars from .env
    const envVars = [
        { key: "FIREBASE_CREDENTIALS", value: firebaseCreds }
    ];

    try {
        const envContent = readFileSync("./.env", "utf-8");
        envContent.split("\n").forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                const parts = trimmed.split("=");
                const k = parts[0].trim();
                let v = parts.slice(1).join("=").trim();
                // strip quotes if existing
                if (v.startsWith('"') && v.endsWith('"')) {
                    v = v.slice(1, -1);
                }
                envVars.push({ key: k, value: v });
            }
        });
    } catch (e) {
        console.error("Could not read .env", e);
    }

    const payload = {
        name: "gari-ai",
        ownerId: ownerId,
        type: "web_service",
        repo: GITHUB_REPO,
        autoDeploy: "yes",
        branch: "main",
        serviceDetails: {
            plan: "free",
            env: "node",
            envSpecificDetails: {
                buildCommand: "npm install && npm run build",
                startCommand: "npm run start"
            },
            envVars: envVars
        }
    };

    console.log("Creating service on Render...");
    const res = await fetch("https://api.render.com/v1/services", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${RENDER_API_KEY}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
        console.error("Failed to create service:", JSON.stringify(data, null, 2));
    } else {
        console.log("SUCCESS! Service created.");
        console.log("Service URL:", data.service.serviceDetails.url);
        console.log("Dashboard URL:", data.service.dashboardUrl);
    }
}

createRenderService();
