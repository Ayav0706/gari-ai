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
