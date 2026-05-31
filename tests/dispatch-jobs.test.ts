import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';

const DB = '/tmp/sully-dispatch-jobs-test.db';
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

beforeEach(() => {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
	new Database(DB).close(); // create empty file so existsSync passes
	vi.resetModules();
});
afterEach(() => {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('writeActivity', () => {
	it('creates the table on first write and reads back by trace_id', async () => {
		const { writeActivity } = await import('$lib/server/chatActivity');
		const { getActivityForTrace } = await import('$lib/server/chatActivity');
		writeActivity('sully-1', 'reading', 'src/foo.ts');
		writeActivity('sully-1', 'edited', 'src/foo.ts');
		const rows = getActivityForTrace('sully-1');
		expect(rows.map((r) => r.action)).toEqual(['reading', 'edited']);
		expect(rows[0].target).toBe('src/foo.ts');
	});

	it('accepts a null target (e.g. thinking/completed)', async () => {
		const { writeActivity, getActivityForTrace } = await import('$lib/server/chatActivity');
		writeActivity('sully-2', 'thinking', null);
		expect(getActivityForTrace('sully-2')[0].target).toBeNull();
	});
});
