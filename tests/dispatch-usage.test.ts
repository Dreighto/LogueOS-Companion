import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';

const DB = '/tmp/sully-dispatch-usage-test.db';
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
	new Database(DB).close();
	vi.resetModules();
});
afterEach(() => {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

describe('captureActualTokens', () => {
	it('writes the unified marker usage into pending_jobs.actual_* columns', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { captureActualTokens } = await import('$lib/server/dispatchUsage');
		j.createJob({
			traceId: 's1',
			worker: 'claude-code',
			category: 'code',
			brief: 'x',
			fingerprint: 'f',
			predictedTokens: 0
		});
		captureActualTokens('s1', {
			worker: 'claude-code',
			model: 'claude-sonnet-4-6',
			usage: { prompt: 100, completion: 50, cache_read: 200, cache_creation: 10, total: 360 }
		});
		const row = j.getJob('s1')!;
		expect(row.actual_prompt).toBe(100);
		expect(row.actual_completion).toBe(50);
		expect(row.actual_cache_read).toBe(200);
		expect(row.actual_cache_creation).toBe(10);
		expect(row.actual_total).toBe(360);
	});

	it('agy marker with null usage leaves actual columns NULL (predicted-only)', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { captureActualTokens } = await import('$lib/server/dispatchUsage');
		j.createJob({
			traceId: 's2',
			worker: 'gemini',
			category: 'ui',
			brief: 'x',
			fingerprint: 'g',
			predictedTokens: 0
		});
		captureActualTokens('s2', { worker: 'agy', model: 'gemini', usage: null });
		const row = j.getJob('s2')!;
		expect(row.actual_total).toBeNull();
	});
});

describe('getMeter', () => {
	it('reports dispatch count + wall-clock-seconds today', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { getMeter } = await import('$lib/server/dispatchUsage');
		j.createJob({
			traceId: 's3',
			worker: 'claude-code',
			category: 'code',
			brief: 'x',
			fingerprint: 'h',
			predictedTokens: 0
		});
		j.markDispatched('s3');
		j.markWorking('s3', 'editing');
		j.markDone('s3', null);
		const m = getMeter();
		expect(m.count).toBeGreaterThanOrEqual(1);
		expect(m.wallClockSeconds).toBeGreaterThanOrEqual(0);
	});
});
