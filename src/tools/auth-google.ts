import fs from "fs/promises";
import path from "path";
import process from "process";
import { google } from "googleapis";
import http from "http";
import url from "url";
import readline from "readline";

// Define the scopes required by Gari (Gmail, Calendar, Drive read-only for now or full if needed)
const SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.readonly",
];

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH, "utf-8");
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

async function saveCredentials(client: any) {
    let keys;
    try {
        const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
        keys = JSON.parse(content);
    } catch {
       return;
    }
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
    console.log(`✅ ¡Token guardado exitosamente en ${TOKEN_PATH}!`);
}

async function getCodeFromLocalServer(oAuth2Client: any, authorizeUrl: string) {
    return new Promise<string>((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                if (req.url && req.url.indexOf("code=") > -1) {
                    const qs = new url.URL(req.url, "http://localhost").searchParams;
                    const code = qs.get("code");
                    console.log(`✅ ¡Código recibido desde el navegador!`);

                    res.end("¡Autenticación exitosa! Ya puedes cerrar esta ventana y volver a Gari en la terminal.");
                    server.close();

                    if (code) {
                        resolve(code);
                    }
                }
            } catch (e) {
                reject(e);
            }
        });

        server.listen(3000, () => {
             console.log("-----------------------------------------");
             console.log("ESPERANDO AUTENTICACIÓN...");
             console.log("1. Abre esta URL:");
             console.log(authorizeUrl);
             console.log("2. Si la página no carga después de aceptar, copia el código que aparece en la barra de direcciones.");
             console.log("-----------------------------------------");
        });
        
        // Timeout para cerrar el servidor si el usuario elige el método manual
        setTimeout(() => server.close(), 120000);
    });
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function authenticateManually() {
    return new Promise<string>((resolve) => {
        rl.question("Introduce el código de verificación aquí (o la URL de redirección completa): ", (input: string) => {
            let code = input;
            try {
                // Si pega la URL completa, extraemos solo el code
                if (input.includes("code=")) {
                    const params = new URLSearchParams(input.split("?")[1]);
                    code = params.get("code") || input;
                }
            } catch (e) {}
            resolve(code);
        });
    });
}

async function authorize() {
    let client: any = await loadSavedCredentialsIfExist();
    if (client) {
        console.log("✅ Gari ya está autenticado con Google.");
        return client;
    }
    
    console.log("⚠️ No se encontró 'token.json'. Iniciando flujo de autenticación...");
    
    const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        "http://localhost" // Usamos el que está en credentials.json exactamente
    );

    const authorizeUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
    });

    await fs.writeFile("AUTH_URL.txt", authorizeUrl);

    try {
        // Intentamos automático (carreras paralelas: servidor local vs entrada manual)
        const codePromise = getCodeFromLocalServer(oAuth2Client, authorizeUrl);
        const manualPromise = authenticateManually();
        
        const code = await Promise.any([codePromise, manualPromise]);
        
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        if (oAuth2Client.credentials) {
            await saveCredentials(oAuth2Client);
        }
        return oAuth2Client;
    } catch (err) {
        console.error("❌ Error durante la autenticación:", err);
        return null;
    }
}

authorize().then(() => {
    console.log("🚀 ¡Todo listo! Gari ya puede usar tu cuenta de Google.");
    process.exit(0);
}).catch(console.error);
