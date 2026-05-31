import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';

let _activityEnsured = false;
function ensureActivityTable(db: Database.Database): void {
	if (_activityEnsured) return;
	db.exec(`
		CREATE TABLE IF NOT EXISTS chat_activity (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trace_id TEXT NOT NULL,
			action TEXT NOT NULL,
			target TEXT,
			timestamp TEXT DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_chat_activity_trace ON chat_activity(trace_id, timestamp);
	`);
	_activityEnsured = true;
}

/**
 * Write a single activity row into companion.db. The dispatched worker can't
 * reach the DB directly, so it HTTP-calls POST /api/chat/activity which calls
 * this. (The kernel emit_chat_activity.py writes logueos_memory.db, the wrong DB
 * for the companion.) action ∈ {reading,edited,ran,thinking,completed,failed}.
 */
export function writeActivity(traceId: string, action: string, target: string | null): void {
	if (!traceId || !action) return;
	const db = new Database(serverConfig.memoryDbPath);
	try {
		ensureActivityTable(db);
		db.prepare('INSERT INTO chat_activity (trace_id, action, target) VALUES (?, ?, ?)').run(
			traceId,
			action,
			target ?? null
		);
	} finally {
		db.close();
	}
}

export interface ChatActivity {
	id: number;
	trace_id: string;
	action: string;
	target: string | null;
	timestamp: string;
}

function getDb(): Database.Database {
	return new Database(serverConfig.memoryDbPath, { readonly: true });
}

/**
 * Fetch every activity row for a given trace_id, ordered oldest-first so the
 * UI can append to a stack as it polls.
 */
export function getActivityForTrace(traceId: string, limit = 200): ChatActivity[] {
	if (!traceId || !fs.existsSync(serverConfig.memoryDbPath)) {
		return [];
	}
	const db = getDb();
	try {
		const rows = db
			.prepare(
				`SELECT id, trace_id, action, target, timestamp
				 FROM chat_activity
				 WHERE trace_id = ?
				 ORDER BY id ASC
				 LIMIT ?`
			)
			.all(traceId, limit) as ChatActivity[];
		return rows;
	} catch (e: unknown) {
		console.error('getActivityForTrace error:', e);
		return [];
	} finally {
		db.close();
	}
}

/**
 * Fetch the most recent activity row across the most-recent N traces. Used as
 * a "what worker activity exists right now" probe when the UI doesn't know
 * which trace_id to ask about.
 */
export function getRecentActivity(limit = 100): ChatActivity[] {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return [];
	const db = getDb();
	try {
		const rows = db
			.prepare(
				`SELECT id, trace_id, action, target, timestamp
				 FROM chat_activity
				 ORDER BY id DESC
				 LIMIT ?`
			)
			.all(limit) as ChatActivity[];
		// Return chronologically so the UI doesn't have to re-sort.
		return rows.reverse();
	} catch (e: unknown) {
		console.error('getRecentActivity error:', e);
		return [];
	} finally {
		db.close();
	}
}
