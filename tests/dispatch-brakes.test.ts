import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';

const DB = '/tmp/sully-dispatch-brakes-test.db';
const ENV = {
	LOGUEOS_APP_MODE: 'companion',
	LOGUEOS_MEMORY_DB_PATH: DB,
	COMPANION_DEFAULT_MODEL: 'companion-v1:latest',
	COMPANION_DISPATCH_CAP: '2',
	COMPANION_DISPATCH_WINDOW_MIN: '1440',
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

describe('fingerprint', () => {
	it('hashes brief|category|target_repo stably', async () => {
		const { fingerprintFor } = await import('$lib/server/dispatchBrakes');
		const a = fingerprintFor('fix build', 'code', 'companion');
		const b = fingerprintFor('fix build', 'code', 'companion');
		expect(a).toBe(b);
		expect(a).not.toBe(fingerprintFor('fix build', 'code', 'miru'));
	});
});

describe('daily cap', () => {
	it('allows up to the cap then HARD-stops', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { checkDailyCap } = await import('$lib/server/dispatchBrakes');
		expect(checkDailyCap().allowed).toBe(true);
		j.createJob({
			traceId: 's1',
			worker: 'claude-code',
			category: 'code',
			brief: 'a',
			fingerprint: 'f1',
			predictedTokens: 0
		});
		j.createJob({
			traceId: 's2',
			worker: 'claude-code',
			category: 'code',
			brief: 'b',
			fingerprint: 'f2',
			predictedTokens: 0
		});
		expect(checkDailyCap().allowed).toBe(false); // cap=2 reached
	});

	it('does NOT count self-handled (sully) turns or expired proposals toward the cap', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { checkDailyCap } = await import('$lib/server/dispatchBrakes');
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		// 5 self-handled chat/voice turns that reached 'synthesized' (worker='sully').
		for (let i = 0; i < 5; i++) {
			j.proposeTask({
				taskId: `self-${i}`,
				threadId: 't1',
				source: 'chat',
				category: 'general',
				brief: 'x'
			});
			j.markClassified(`self-${i}`, 'chat', null);
			j.markSelfHandled(`self-${i}`);
		}
		// 1 expired ask-before-dispatch proposal (worker set on the gated row, then aborted).
		j.proposeTask({
			taskId: 'prop-1',
			threadId: 't1',
			source: 'chat',
			category: 'general',
			brief: 'x'
		});
		j.markGatedProposal('prop-1', {
			worker: 'claude-code',
			category: 'code',
			brief: 'x',
			targetRepo: 'companion',
			task: 'x'
		});
		j.markAborted('prop-1');
		// None of the above are REAL worker dispatches — the cap (2) must see 0.
		const r = checkDailyCap();
		expect(r.used).toBe(0);
		expect(r.allowed).toBe(true);
	});
});

describe('429 circuit breaker', () => {
	it('trips, halts all, and never permits a retry while open', async () => {
		const cb = await import('$lib/server/dispatchBrakes');
		expect(cb.breakerOpen()).toBe(false);
		cb.trip429();
		expect(cb.breakerOpen()).toBe(true);
		expect(cb.canRetryAfter(429)).toBe(false);
	});
	it('permits bounded retry for transient (non-429) errors', async () => {
		const cb = await import('$lib/server/dispatchBrakes');
		expect(cb.canRetryAfter(503)).toBe(true);
	});
});

describe('token bucket', () => {
	it('drains then refuses until refill', async () => {
		const { TokenBucket } = await import('$lib/server/dispatchBrakes');
		const tb = new TokenBucket(2, 0); // capacity 2, no refill
		expect(tb.take()).toBe(true);
		expect(tb.take()).toBe(true);
		expect(tb.take()).toBe(false);
	});
});

describe('fingerprint re-escalation guard (windowed + thread-scoped)', () => {
	it('refuses the same fingerprint twice in the SAME thread within the window', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { fingerprintFor, checkFingerprint } = await import('$lib/server/dispatchBrakes');
		const fp = fingerprintFor('fix build', 'code', 'companion');
		expect(checkFingerprint(fp, 'thread-A').allowed).toBe(true);
		j.createJob({
			traceId: 's9',
			worker: 'claude-code',
			category: 'code',
			brief: 'fix build',
			fingerprint: fp,
			predictedTokens: 0,
			threadId: 'thread-A'
		});
		// A fresh identical dispatch in the same thread, seconds later, is still held.
		expect(checkFingerprint(fp, 'thread-A').allowed).toBe(false);
	});

	it('ALLOWS the same fingerprint in a DIFFERENT thread', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { fingerprintFor, checkFingerprint } = await import('$lib/server/dispatchBrakes');
		const fp = fingerprintFor('speed test', 'code', 'companion');
		j.createJob({
			traceId: 's10',
			worker: 'claude-code',
			category: 'code',
			brief: 'speed test',
			fingerprint: fp,
			predictedTokens: 0,
			threadId: 'thread-A'
		});
		// Same brief, different conversation → legitimate new request, not a loop.
		expect(checkFingerprint(fp, 'thread-B').allowed).toBe(true);
	});

	it('ALLOWS the same fingerprint once the prior dispatch is OUTSIDE the 10-min window', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { fingerprintFor, checkFingerprint } = await import('$lib/server/dispatchBrakes');
		const { serverConfig } = await import('$lib/server/config');
		const fp = fingerprintFor('nightly report', 'code', 'companion');
		j.createJob({
			traceId: 's11',
			worker: 'claude-code',
			category: 'code',
			brief: 'nightly report',
			fingerprint: fp,
			predictedTokens: 0,
			threadId: 'thread-A'
		});
		// Backdate the prior dispatch's started_at to 11 minutes ago (UTC, matching
		// the CURRENT_TIMESTAMP format the guard compares against).
		const db = new Database(serverConfig.memoryDbPath);
		db.prepare(
			"UPDATE pending_jobs SET started_at = datetime('now', '-11 minutes') WHERE trace_id = ?"
		).run('s11');
		db.close();
		// The identical brief run 11 min ago is a legitimate new request now.
		expect(checkFingerprint(fp, 'thread-A').allowed).toBe(true);
	});
});
