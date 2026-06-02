// Locks chat_messages.quality_signal end-to-end: bootstrap migrates a
// pre-existing schema, addChatMessage/getChatMessages roundtrip the column,
// and setMessageQualitySignal honors the +1 / -1 / null tri-state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';

const DB = '/tmp/sully-quality-signal-test.db';
const ENV = {
	LOGUEOS_APP_MODE: 'companion',
	LOGUEOS_MEMORY_DB_PATH: DB,
	COMPANION_DEFAULT_MODEL: 'companion-v1:latest',
	LOGUEOS_RUN_POLL_MS: '5000',
	LOGUEOS_RUN_FEED_LIMIT: '50',
	ANTHROPIC_DAILY_TOKEN_CAP: '1000000',
	OPENAI_DAILY_TOKEN_CAP: '200000',
	GEMINI_DAILY_TOKEN_CAP: '2000000'
};
vi.mock('$env/dynamic/private', () => ({ env: ENV }));

function wipeDb() {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
}

beforeEach(() => {
	wipeDb();
	vi.resetModules();
});
afterEach(() => {
	wipeDb();
});

describe('quality_signal column', () => {
	it('is populated by bootstrap on a brand-new DB', async () => {
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		const db = new Database(DB);
		const cols = db.pragma('table_info(chat_messages)') as { name: string }[];
		db.close();
		expect(cols.map((c) => c.name)).toContain('quality_signal');
	});

	it('is added in-place to a pre-existing chat_messages table without it', async () => {
		// Simulate an old DB by creating the table WITHOUT the new column
		// before bootstrap runs.
		const db = new Database(DB);
		db.exec(`
			CREATE TABLE chat_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				sender TEXT NOT NULL,
				message TEXT NOT NULL,
				trace_id TEXT,
				ticket_id TEXT,
				interactive_action TEXT,
				status TEXT DEFAULT 'sent',
				timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
				thread_id TEXT NOT NULL DEFAULT 'default'
			);
		`);
		db.close();
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		const db2 = new Database(DB);
		const cols = db2.pragma('table_info(chat_messages)') as { name: string }[];
		db2.close();
		expect(cols.map((c) => c.name)).toContain('quality_signal');
	});

	it('roundtrips +1, -1, and null through addChatMessage -> setMessageQualitySignal -> getChatMessages', async () => {
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		const { addChatMessage, getChatMessages, setMessageQualitySignal } =
			await import('$lib/server/chat');

		const a = addChatMessage('local', 'first reply', null, null, null, 'sent', 'default');
		const b = addChatMessage('local', 'second reply', null, null, null, 'sent', 'default');

		// Fresh inserts have no signal
		expect(a.quality_signal).toBeNull();
		expect(b.quality_signal).toBeNull();

		// Thumbs-up on a, thumbs-down on b
		expect(setMessageQualitySignal(a.id, 1)).toBe(true);
		expect(setMessageQualitySignal(b.id, -1)).toBe(true);
		let rows = getChatMessages(10, 'default');
		expect(rows.find((r) => r.id === a.id)?.quality_signal).toBe(1);
		expect(rows.find((r) => r.id === b.id)?.quality_signal).toBe(-1);

		// Clear a
		expect(setMessageQualitySignal(a.id, null)).toBe(true);
		rows = getChatMessages(10, 'default');
		expect(rows.find((r) => r.id === a.id)?.quality_signal).toBeNull();
		expect(rows.find((r) => r.id === b.id)?.quality_signal).toBe(-1);
	});

	it('returns false when the message id does not exist', async () => {
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		const { setMessageQualitySignal } = await import('$lib/server/chat');
		expect(setMessageQualitySignal(999_999, 1)).toBe(false);
	});
});
