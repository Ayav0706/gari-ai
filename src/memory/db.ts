// ============================================
// GARI – Memory Layer (Firebase Firestore)
// ============================================
// Persistent memory using Firebase Firestore.
// Uses paths like: users/{userId}/memories/{key}
// and: users/{userId}/conversations/{autoId}

import admin from "firebase-admin";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { MemoryEntry, LLMMessage, LLMToolCall } from "../types.js";
import { readFileSync, existsSync } from "node:fs";

let db: admin.firestore.Firestore;

/**
 * Initialize the Firebase Firestore database.
 */
export async function initDatabase(): Promise<void> {
    try {
        let serviceAccount: any;

        // Render/Cloud friendly: read from stringified JSON in ENV var
        if (process.env.FIREBASE_CREDENTIALS) {
            serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        }
        // Local dev fallback: read from file
        else if (existsSync(config.GOOGLE_APPLICATION_CREDENTIALS)) {
            serviceAccount = JSON.parse(readFileSync(config.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8'));
        } else {
            logger.error(`❌ No Firebase credentials found. Provide FIREBASE_CREDENTIALS env var or a local file at ${config.GOOGLE_APPLICATION_CREDENTIALS}`);
            process.exit(1);
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        db = admin.firestore();
        // Ignoring undefined fields is highly recommended for Firestore in TS
        db.settings({ ignoreUndefinedProperties: true });

        logger.info("🗄️  Firebase Firestore connected successfully.");
    } catch (error) {
        logger.error("Failed to initialize Firebase:", { error: String(error) });
        process.exit(1);
    }
}

// ── Memory CRUD ─────────────────────────────

export async function saveMemory(userId: number, key: string, value: string, category?: string, tags?: string[]): Promise<void> {
    const docRef = db.collection('users').doc(userId.toString())
        .collection('memories').doc(key);

    await docRef.set({
        key,
        value,
        category,
        tags,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }); // Merge correctly updates the timestamp without wiping other fields

    logger.debug(`Memory saved to Firebase: [${userId}] ${key} (${category || 'no-cat'})`);
}

export async function getMemory(userId: number, key: string): Promise<MemoryEntry | undefined> {
    const docRef = db.collection('users').doc(userId.toString())
        .collection('memories').doc(key);

    const doc = await docRef.get();

    if (doc.exists) {
        const data = doc.data();
        return {
            id: doc.id,
            user_id: userId,
            key: data?.key,
            value: data?.value,
            category: data?.category,
            tags: data?.tags,
            created_at: data?.created_at?.toDate()?.toISOString() || new Date().toISOString(),
            updated_at: data?.updated_at?.toDate()?.toISOString() || new Date().toISOString()
        };
    }
    return undefined;
}

export async function listMemories(userId: number): Promise<MemoryEntry[]> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('memories')
        .orderBy('updated_at', 'desc')
        .get();

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            user_id: userId,
            key: data.key,
            value: data.value,
            category: data.category,
            tags: data.tags,
            created_at: data.created_at?.toDate()?.toISOString() || new Date().toISOString(),
            updated_at: data.updated_at?.toDate()?.toISOString() || new Date().toISOString()
        };
    });
}

export async function deleteMemory(userId: number, key: string): Promise<boolean> {
    const docRef = db.collection('users').doc(userId.toString())
        .collection('memories').doc(key);

    const doc = await docRef.get();
    if (!doc.exists) return false;

    await docRef.delete();
    return true;
}

/**
 * Get a summary string of all memories for injection into the system prompt.
 * Grouped by category if possible.
 */
export async function getMemorySummary(userId: number): Promise<string> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('memories')
        .orderBy('updated_at', 'desc')
        .limit(30)
        .get();

    if (snapshot.empty) return "";

    const memories = snapshot.docs.map(doc => doc.data());
    
    // Grouping logic
    const categories: Record<string, string[]> = {};
    const misc: string[] = [];

    memories.forEach(m => {
        const line = `${m.key}: ${m.value}`;
        if (m.category) {
            if (!categories[m.category]) categories[m.category] = [];
            categories[m.category].push(line);
        } else {
            misc.push(line);
        }
    });

    let summary = "### LONG-TERM MEMORY (CONCISO)\n";
    
    for (const [cat, items] of Object.entries(categories)) {
        summary += `[${cat}]\n• ` + items.join("\n• ") + "\n";
    }

    if (misc.length > 0) {
        summary += `[MISC]\n• ` + misc.join("\n• ") + "\n";
    }

    return summary.trim();
}

type SemanticMemoryMatch = {
    id: string;
    content: string;
    source: string;
    score: number;
};

const STOPWORDS = new Set([
    "de", "la", "el", "los", "las", "un", "una", "y", "o", "que", "en", "con", "por", "para", "del",
    "al", "se", "es", "su", "sus", "mi", "mis", "tu", "tus", "the", "a", "an", "is", "are", "to", "of", "and"
]);

function tokenizeForSemanticSearch(text: string): string[] {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function semanticScore(queryTokens: string[], targetTokens: string[], targetText: string, queryText: string): number {
    if (queryTokens.length === 0 || targetTokens.length === 0) return 0;
    const q = new Set(queryTokens);
    const t = new Set(targetTokens);
    let common = 0;
    q.forEach((token) => {
        if (t.has(token)) common++;
    });
    const overlapQ = common / q.size;
    const overlapT = common / t.size;
    const phraseBonus = targetText.toLowerCase().includes(queryText.toLowerCase()) ? 0.2 : 0;
    return overlapQ * 0.65 + overlapT * 0.35 + phraseBonus;
}

/**
 * Save an unstructured semantic memory snippet for later similarity retrieval.
 */
export async function saveSemanticMemory(
    userId: number,
    content: string,
    source: string = "conversation"
): Promise<void> {
    const normalized = content.trim();
    if (normalized.length < 12) return;

    const tokens = tokenizeForSemanticSearch(normalized).slice(0, 40);
    if (tokens.length === 0) return;

    await db.collection("users").doc(userId.toString())
        .collection("semantic_memories")
        .add({
            content: normalized.slice(0, 1200),
            source,
            tokens,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
}

/**
 * Search semantically similar memory snippets using token-overlap scoring.
 * This is a lightweight semantic layer without external vector dependencies.
 */
export async function searchSemanticMemories(
    userId: number,
    query: string,
    limit: number = 5
): Promise<SemanticMemoryMatch[]> {
    const queryTokens = tokenizeForSemanticSearch(query);
    if (queryTokens.length === 0) return [];

    const snapshot = await db.collection("users").doc(userId.toString())
        .collection("semantic_memories")
        .orderBy("updated_at", "desc")
        .limit(200)
        .get();

    if (snapshot.empty) return [];

    const scored = snapshot.docs.map((doc) => {
        const data = doc.data();
        const content = String(data.content || "");
        const source = String(data.source || "conversation");
        const tokens = Array.isArray(data.tokens) ? data.tokens.map((t: unknown) => String(t)) : tokenizeForSemanticSearch(content);
        const score = semanticScore(queryTokens, tokens, content, query);
        return { id: doc.id, content, source, score };
    });

    return scored
        .filter((row) => row.score >= 0.22)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Build semantic context block for prompt injection.
 */
export async function getSemanticContext(userId: number, query: string, limit: number = 5): Promise<string> {
    const matches = await searchSemanticMemories(userId, query, limit);
    if (matches.length === 0) return "";

    const lines = matches.map((m, i) => `${i + 1}. (${m.source}, score=${m.score.toFixed(2)}) ${m.content}`);
    return [
        "### MEMORIA SEMANTICA RELACIONADA",
        "Usa este contexto solo si aporta valor a la respuesta actual.",
        ...lines,
    ].join("\n");
}

function normalizeErrorSignature(raw: string): string {
    return raw
        .toLowerCase()
        // IDs/timestamps/random-like chunks
        .replace(/\b[0-9a-f]{8,}\b/g, "<hex>")
        .replace(/\b\d{6,}\b/g, "<num>")
        // URLs and file paths
        .replace(/https?:\/\/\S+/g, "<url>")
        .replace(/[a-z]:\\[^\s]+/gi, "<path>")
        .replace(/\/[^\s]+/g, "<path>")
        // Collapse whitespace
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
}

function signatureDocId(signature: string): string {
    return Buffer.from(signature, "utf8").toString("base64url").slice(0, 180);
}

/**
 * Store or increment a recurrent runtime error pattern for a user.
 * Useful to inject "known failures" into the system prompt and avoid repeating them.
 */
export async function recordRecurrentError(
    userId: number,
    rawError: string,
    context?: string,
    requestId?: string
): Promise<void> {
    const signature = normalizeErrorSignature(rawError);
    if (!signature) return;

    const docId = signatureDocId(signature);
    const docRef = db.collection("users").doc(userId.toString())
        .collection("error_patterns").doc(docId);

    await docRef.set({
        signature,
        sample: rawError.slice(0, 500),
        context: context?.slice(0, 500),
        request_id: requestId?.slice(0, 100),
        count: admin.firestore.FieldValue.increment(1),
        first_seen: admin.firestore.FieldValue.serverTimestamp(),
        last_seen: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

/**
 * Summarize recent recurrent errors to help the agent avoid known failure loops.
 */
export async function getRecentErrorPatternsSummary(userId: number, limit: number = 5): Promise<string> {
    const snapshot = await db.collection("users").doc(userId.toString())
        .collection("error_patterns")
        .orderBy("last_seen", "desc")
        .limit(limit)
        .get();

    if (snapshot.empty) return "";

    const lines = snapshot.docs.map((doc, i) => {
        const data = doc.data();
        const signature = String(data.signature || "error desconocido");
        const count = Number(data.count || 1);
        const context = data.context ? ` | contexto: ${String(data.context)}` : "";
        return `${i + 1}. (${count}x) ${signature}${context}`;
    });

    return [
        "### ERRORES RECURRENTES A EVITAR",
        "Si un intento previo falló con estos patrones, cambia de estrategia y usa herramientas.",
        ...lines,
    ].join("\n");
}

// ── User Rules ──────────────────────────────

/**
 * Persist a user rule.
 */
export async function saveRule(userId: number, content: string): Promise<void> {
    const rulesCollection = db.collection('users').doc(userId.toString())
        .collection('rules');

    await rulesCollection.add({
        content,
        created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.debug(`Rule saved for user ${userId}`);
}

/**
 * List all rules for a user.
 */
export async function listRules(userId: number): Promise<{ id: string, content: string }[]> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('rules')
        .orderBy('created_at', 'asc')
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        content: doc.data().content
    }));
}

/**
 * Delete a specific rule by ID.
 */
export async function deleteRule(userId: number, ruleId: string): Promise<boolean> {
    const docRef = db.collection('users').doc(userId.toString())
        .collection('rules').doc(ruleId);

    const doc = await docRef.get();
    if (!doc.exists) return false;

    await docRef.delete();
    return true;
}

/**
 * Clear all rules for a user.
 */
export async function clearRules(userId: number): Promise<void> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('rules').get();

    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
}

/**
 * Get rules as a formatted string for the system prompt.
 */
export async function getRulesSummary(userId: number): Promise<string> {
    const rules = await listRules(userId);
    if (rules.length === 0) return "";

    let summary = "### USER PERMANENT RULES (STRICT ADHERENCE REQUIRED)\n";
    rules.forEach((r, i) => {
        summary += `${i + 1}. ${r.content}\n`;
    });
    return summary.trim() + "\n";
}

// ── Conversation History ────────────────────

export async function saveConversationMessage(
    userId: number, 
    role: string, 
    content: string | null,
    tool_calls?: LLMToolCall[],
    tool_call_id?: string,
    order: number = 0
): Promise<void> {
    const data: any = {
        role,
        content,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        order
    };
    if (tool_calls) data.tool_calls = tool_calls;
    if (tool_call_id) data.tool_call_id = tool_call_id;

    await db.collection('users').doc(userId.toString())
        .collection('conversations')
        .add(data);
}

export async function getRecentMessages(
    userId: number,
    limit: number = 20
): Promise<LLMMessage[]> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('conversations')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

    // Read them in desc order from DB, but we need asc order for the LLM prompt.
    const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        const msg: LLMMessage = {
            role: data.role as any,
            content: data.content
        };
        if (data.tool_calls) msg.tool_calls = data.tool_calls;
        if (data.tool_call_id) msg.tool_call_id = data.tool_call_id;
        return msg;
    });

    return messages.reverse();
}

/**
 * Count the total number of messages in the conversation history for a user.
 */
export async function countConversationMessages(userId: number): Promise<number> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('conversations')
        .count()
        .get();
    
    return snapshot.data().count;
}

/**
 * Delete old messages from the conversation history, keeping only the most recent N.
 */
export async function pruneConversation(userId: number, keepLastN: number): Promise<void> {
    const collectionRef = db.collection('users').doc(userId.toString())
        .collection('conversations');

    const snapshot = await collectionRef
        .orderBy('timestamp', 'desc')
        .offset(keepLastN)
        .get();

    if (snapshot.empty) return;

    logger.info(`🧹 Pruning ${snapshot.size} old messages from user ${userId} history.`);

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
}


export async function clearConversation(userId: number): Promise<void> {
    // Note: Deleting a collection in Firestore from the client requires deleting docs one by one.
    const collectionRef = db.collection('users').doc(userId.toString())
        .collection('conversations');

    const snapshot = await collectionRef.get();

    // Batch delete
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    logger.debug(`Conversation cleared for user ${userId} in Firebase`);
}



/**
 * Set the bot status for a user (active/stopped).
 */
export async function setBotStatus(userId: number, status: 'active' | 'stopped'): Promise<void> {
    const docRef = db.collection('users').doc(userId.toString());
    await docRef.set({ status }, { merge: true });
    logger.debug(`Bot status updated for user ${userId}: ${status}`);
}

/**
 * Get the current bot status for a user. Defaults to 'active'.
 */
export async function getBotStatus(userId: number): Promise<'active' | 'stopped'> {
    const docRef = db.collection('users').doc(userId.toString());
    const doc = await docRef.get();
    
    if (doc.exists) {
        return doc.data()?.status || 'active';
    }
    return 'active';
}


/**
 * Close database connection - Firebase admin SDK handles its own connection pooling,
 * but you can optionally terminate the app if you really need to.
 */
export async function closeDatabase(): Promise<void> {
    try {
        await admin.app().delete();
        logger.info("🗄️  Firebase connection closed.");
    } catch (e) {
        // App might not have been initialized or already deleted
    }
}
