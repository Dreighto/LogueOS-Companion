// LOS-196 part 2 — clock-driven stale-job reaper. Locks: the sweep runs from a
// server-side interval (no client needs to be open), posts the stalled notice,
// shares one 60s throttle across callers, and does NOT change the
// reapStaleJobs() criterion (proven correct during the design investigation).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';

const DB = '/tmp/sully-stale-sweep-test.db';
const ENV = {
	LOGUEOS_APP_MODE: 'companion',
	LOGUEOS_MEMORY_DB_PATH: DB,
	COMPANION_DISPATCH_ENABLED: 'true',
	ENABLE_WEB_PUSH: 'false'
};
vi.mock('$env/dynamic/private', () => ({ env: ENV }));

function wipe() {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
}

beforeEach(() => {
	wipe();
	new Database(DB).close();
	vi.resetModules();
});
afterEach(() => {
	vi.useRealTimers();
	wipe();
});

/** Mint an in-flight job and backdate started_at past the 15-min reap timeout. */
async function seedStaleJob(traceId: string, threadId = 'thread-reap') {
	const j = await import('$lib/server/dispatchJobs');
	const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
	bootstrapCompanionDb();
	j.createJob({
		traceId,
		worker: 'claude-code',
		category: 'code',
		brief: 'long-lost task',
		fingerprint: 'f',
		predictedTokens: 0,
		threadId
	});
	j.markDispatched(traceId);
	j.markWorking(traceId, 'thinking');
	const db = new Database(DB);
	db.prepare(
		"UPDATE pending_jobs SET started_at = datetime('now', '-20 minutes') WHERE trace_id = ?"
	).run(traceId);
	db.close();
	return j;
}

describe('sweepStaleJobs', () => {
	it('reaps a stale working job and posts the stalled notice to its thread', async () => {
		const j = await seedStaleJob('sully-stale-1');
		const { sweepStaleJobs } = await import('$lib/server/staleJobSweep');
		sweepStaleJobs();
		expect(j.getJob('sully-stale-1')?.status).toBe('failed');
		expect(j.getJob('sully-stale-1')?.current_activity).toBe(
			'stalled: no worker callback within timeout'
		);
		const { getChatMessages } = await import('$lib/server/chat');
		const msgs = getChatMessages(50, 'thread-reap');
		expect(msgs.some((m) => m.message.includes('That task stalled'))).toBe(true);
	});

	it('shares one 60s throttle across callers — a second immediate sweep is a no-op', async () => {
		vi.useFakeTimers();
		const j = await seedStaleJob('sully-stale-2');
		const { sweepStaleJobs } = await import('$lib/server/staleJobSweep');
		sweepStaleJobs();
		expect(j.getJob('sully-stale-2')?.status).toBe('failed');

		// A second stale job appearing right after: the immediate re-sweep is
		// throttled; after 60s it goes through.
		await seedStaleJob('sully-stale-3');
		sweepStaleJobs();
		expect(j.getJob('sully-stale-3')?.status).toBe('working');
		vi.advanceTimersByTime(61_000);
		sweepStaleJobs();
		expect(j.getJob('sully-stale-3')?.status).toBe('failed');
	});

	it('leaves fresh in-flight jobs alone (no criterion change)', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		j.createJob({
			traceId: 'sully-fresh-1',
			worker: 'claude-code',
			category: 'code',
			brief: 'fresh task',
			fingerprint: 'f',
			predictedTokens: 0,
			threadId: 'thread-reap'
		});
		j.markDispatched('sully-fresh-1');
		const { sweepStaleJobs } = await import('$lib/server/staleJobSweep');
		sweepStaleJobs();
		expect(j.getJob('sully-fresh-1')?.status).toBe('dispatched');
	});
});

describe('startStaleJobReaper — the server-side interval', () => {
	it('reaps on the clock with NO client request involved', async () => {
		vi.useFakeTimers();
		const j = await seedStaleJob('sully-clock-1');
		const { startStaleJobReaper } = await import('$lib/server/staleJobSweep');
		startStaleJobReaper();
		expect(j.getJob('sully-clock-1')?.status).toBe('working'); // not yet — interval hasn't fired
		vi.advanceTimersByTime(60_000);
		expect(j.getJob('sully-clock-1')?.status).toBe('failed');
		const { getChatMessages } = await import('$lib/server/chat');
		expect(
			getChatMessages(50, 'thread-reap').some((m) => m.message.includes('That task stalled'))
		).toBe(true);
	});

	it('is idempotent — a double start arms exactly one interval', async () => {
		vi.useFakeTimers();
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		const { startStaleJobReaper } = await import('$lib/server/staleJobSweep');
		startStaleJobReaper();
		startStaleJobReaper();
		expect(setIntervalSpy).toHaveBeenCalledTimes(1);
		setIntervalSpy.mockRestore();
	});
});

describe('hooks + activity-route wiring (source-level)', () => {
	it('hooks.server.ts starts the reaper and the activity GET keeps the piggyback', () => {
		const hooks = fs.readFileSync('src/hooks.server.ts', 'utf-8');
		expect(hooks).toContain('startStaleJobReaper()');
		const route = fs.readFileSync('src/routes/api/chat/activity/+server.ts', 'utf-8');
		expect(route).toContain('sweepStaleJobs()');
	});
});
