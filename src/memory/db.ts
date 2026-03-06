// ============================================
// GARI – Memory Layer (Firebase Firestore)
// ============================================
// Persistent memory using Firebase Firestore.
// Uses paths like: users/{userId}/memories/{key}
// and: users/{userId}/conversations/{autoId}

import admin from "firebase-admin";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { MemoryEntry } from "../types.js";
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

export async function saveMemory(userId: number, key: string, value: string): Promise<void> {
    const docRef = db.collection('users').doc(userId.toString())
        .collection('memories').doc(key);

    await docRef.set({
        key,
        value,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    logger.debug(`Memory saved to Firebase: [${userId}] ${key}`);
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
 */
export async function getMemorySummary(userId: number): Promise<string> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('memories')
        .orderBy('updated_at', 'desc')
        .limit(20)
        .get();

    if (snapshot.empty) return "";

    return snapshot.docs
        .map(doc => {
            const data = doc.data();
            return `• ${data.key}: ${data.value}`;
        })
        .join("\n");
}

// ── Conversation History ────────────────────

export async function saveConversationMessage(userId: number, role: string, content: string): Promise<void> {
    await db.collection('users').doc(userId.toString())
        .collection('conversations')
        .add({
            role,
            content,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
}

export async function getRecentMessages(
    userId: number,
    limit: number = 20
): Promise<{ role: string; content: string }[]> {
    const snapshot = await db.collection('users').doc(userId.toString())
        .collection('conversations')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

    // Read them in desc order from DB, but we need asc order for the LLM prompt.
    const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            role: data.role,
            content: data.content
        };
    });

    return messages.reverse();
}

export async function clearConversation(userId: number): Promise<void> {
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
 * Close database connection.
 */
export async function closeDatabase(): Promise<void> {
    try {
        await admin.app().delete();
        logger.info("🗄️  Firebase connection closed.");
    } catch (e) {
        // App might not have been initialized or already deleted
    }
}
