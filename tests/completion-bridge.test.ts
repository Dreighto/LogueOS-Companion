// LOS-196 — terminal bridge: kernel completion-log markers reconcile in-flight
// pending_jobs. Locks the marker→status mapping (fixtures, NOT live rows — the
// case-study row was consumed during the design investigation), the honest
// operator copy (marker status verbatim + summary first line, no invented
// status text), and the idempotency contract against late worker callbacks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = '/tmp/sully-completion-bridge-test.db';
const LOG_PATH = path.join(os.tmpdir(), 'sully-completion-bridge-test.jsonl');
const ENV = {
	LOGUEOS_APP_MODE: 'companion',
	LOGUEOS_MEMORY_DB_PATH: DB,
	LOGUEOS_COMPLETION_LOG_PATH: LOG_PATH,
	COMPANION_DISPATCH_ENABLED: 'true',
	ENABLE_WEB_PUSH: 'false'
};
vi.mock('$env/dynamic/private', () => ({ env: ENV }));

// LLM + verification legs of closeOutTask are external calls — mock them so
// the bridge tests stay deterministic. synthesize → null forces the raw-result
// fallback copy the assertions read.
vi.mock('$lib/server/routing/synthesize', () => ({
	synthesizeWorkerResult: vi.fn(async () => null)
}));
vi.mock('$lib/server/routing/adversary', () => ({
	shouldReview: vi.fn(() => false),
	runAdversaryReview: vi.fn(async () => ({ available: false, findings: [] }))
}));
vi.mock('$lib/server/verifyPoll', () => ({
	runPoll: vi.fn(async () => ({
		posture: 'confirmed',
		needs_review: false,
		channels: [],
		ledger: []
	}))
}));
vi.mock('$lib/server/web_push', () => ({
	sendPushToAll: vi.fn(async () => {})
}));
vi.mock('$lib/server/apns', () => ({
	sendApnsToAll: vi.fn(async () => {})
}));

function wipe() {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`, LOG_PATH]) if (fs.existsSync(f)) fs.unlinkSync(f);
}

beforeEach(() => {
	wipe();
	new Database(DB).close();
	vi.resetModules();
});
afterEach(() => {
	wipe();
});

/** Mint an in-flight (working) job the bridge can reconcile. */
async function seedWorkingJob(traceId: string, threadId = 'thread-bridge') {
	const j = await import('$lib/server/dispatchJobs');
	const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
	bootstrapCompanionDb();
	j.createJob({
		traceId,
		worker: 'claude-code',
		category: 'code',
		brief: 'fix the build',
		fingerprint: 'f',
		predictedTokens: 0,
		threadId
	});
	j.markDispatched(traceId);
	j.markWorking(traceId, 'reading src/foo.ts');
	return j;
}

describe('isSuccessMarkerStatus', () => {
	it('accepts CONFIRMED_WORKING incl. the space variant seen in the log', async () => {
		const { isSuccessMarkerStatus } = await import('$lib/server/completion_poller');
		expect(isSuccessMarkerStatus('CONFIRMED_WORKING')).toBe(true);
		expect(isSuccessMarkerStatus('CONFIRMED WORKING')).toBe(true);
		expect(isSuccessMarkerStatus('confirmed_working')).toBe(true);
	});

	it('rejects every non-success status — INCONCLUSIVE/FAILED/ABANDONED/ESCALATE/missing', async () => {
		const { isSuccessMarkerStatus } = await import('$lib/server/completion_poller');
		for (const s of ['INCONCLUSIVE', 'FAILED', 'ABANDONED', 'ESCALATE: HUMAN-REQUIRED', '', null]) {
			expect(isSuccessMarkerStatus(s), `status=${s}`).toBe(false);
		}
	});
});

describe('markerFailureCopy — honest copy, no invented status text', () => {
	it('is the marker status verbatim + first summary line', async () => {
		const { markerFailureCopy } = await import('$lib/server/completion_poller');
		expect(
			markerFailureCopy({ status: 'INCONCLUSIVE', summary: 'DPSK round 2 still streaming\nmore' })
		).toBe('INCONCLUSIVE — DPSK round 2 still streaming');
	});

	it('is the status alone when the summary is empty', async () => {
		const { markerFailureCopy } = await import('$lib/server/completion_poller');
		expect(markerFailureCopy({ status: 'FAILED', summary: '' })).toBe('FAILED');
	});

	it('describes a missing status factually', async () => {
		const { markerFailureCopy } = await import('$lib/server/completion_poller');
		expect(markerFailureCopy({ summary: 'exit 1' })).toBe(
			'worker exited without a status marker — exit 1'
		);
	});
});

describe('bridgeTerminalEntry — marker→status mapping (fixtures)', () => {
	it('INCONCLUSIVE marker → markFailed with status + reason, snag message posted', async () => {
		const j = await seedWorkingJob('sully-br-1');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		const claimed = await bridgeTerminalEntry({
			trace_id: 'sully-br-1',
			status: 'INCONCLUSIVE',
			summary: 'DPSK round 2 still streaming — holding until then.\nsecond line'
		});
		expect(claimed).toBe(true);
		const job = j.getJob('sully-br-1');
		expect(job?.status).toBe('failed');
		expect(job?.ended_at).toBeTruthy();
		expect(job?.current_activity).toBe(
			'INCONCLUSIVE — DPSK round 2 still streaming — holding until then.'
		);
		const { getChatMessages } = await import('$lib/server/chat');
		const msgs = getChatMessages(50, 'thread-bridge');
		expect(
			msgs.some((m) => m.message.includes('INCONCLUSIVE — DPSK round 2 still streaming'))
		).toBe(true);
	});

	it('FAILED marker → markFailed', async () => {
		const j = await seedWorkingJob('rtr-br-2');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		await bridgeTerminalEntry({ trace_id: 'rtr-br-2', status: 'FAILED', summary: 'no PR found' });
		expect(j.getJob('rtr-br-2')?.status).toBe('failed');
		expect(j.getJob('rtr-br-2')?.current_activity).toBe('FAILED — no PR found');
	});

	it('marker with no status → markFailed, factual copy', async () => {
		const j = await seedWorkingJob('sully-br-3');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		await bridgeTerminalEntry({ trace_id: 'sully-br-3', summary: 'killed by listener restart' });
		expect(j.getJob('sully-br-3')?.status).toBe('failed');
		expect(j.getJob('sully-br-3')?.current_activity).toBe(
			'worker exited without a status marker — killed by listener restart'
		);
	});

	it('CONFIRMED_WORKING marker → markDone with the summary as result, message posted', async () => {
		const j = await seedWorkingJob('sully-br-4');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		await bridgeTerminalEntry({
			trace_id: 'sully-br-4',
			status: 'CONFIRMED_WORKING',
			summary: 'PR #9 opened and merged'
		});
		// done → synthesized: closeOutTask links the completion message.
		expect(['done', 'synthesized']).toContain(j.getJob('sully-br-4')?.status);
		expect(j.getJob('sully-br-4')?.result_ref).toBe('PR #9 opened and merged');
		const { getChatMessages } = await import('$lib/server/chat');
		const msgs = getChatMessages(50, 'thread-bridge');
		expect(msgs.some((m) => m.message.includes('PR #9 opened and merged'))).toBe(true);
	});

	it('ignores markers for unknown traces and non-companion prefixes', async () => {
		const j = await seedWorkingJob('sully-br-5');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		expect(await bridgeTerminalEntry({ trace_id: 'sully-unknown', status: 'FAILED' })).toBe(false);
		expect(await bridgeTerminalEntry({ trace_id: 'supervisor-x1', status: 'FAILED' })).toBe(false);
		expect(await bridgeTerminalEntry({ status: 'FAILED' })).toBe(false);
		expect(j.getJob('sully-br-5')?.status).toBe('working'); // untouched
	});

	it('skips a job that already went terminal — no double close-out', async () => {
		const j = await seedWorkingJob('sully-br-6');
		j.markAborted('sully-br-6');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		expect(await bridgeTerminalEntry({ trace_id: 'sully-br-6', status: 'FAILED' })).toBe(false);
		expect(j.getJob('sully-br-6')?.status).toBe('aborted');
	});

	it('late worker completed callback after a bridge-failed: FSM blocks the flip, close-out does not double-message', async () => {
		const j = await seedWorkingJob('sully-br-7');
		const { bridgeTerminalEntry } = await import('$lib/server/completion_poller');
		await bridgeTerminalEntry({ trace_id: 'sully-br-7', status: 'INCONCLUSIVE', summary: 'x' });
		expect(j.getJob('sully-br-7')?.status).toBe('failed');
		const { getChatMessages } = await import('$lib/server/chat');
		const before = getChatMessages(50, 'thread-bridge').length;

		// The activity route's late-callback path: markDone throws (failed is a
		// sink — the route catches+warns), and closeOutTask is absorbed by its
		// synthesis_completed guard.
		expect(() => j.markDone('sully-br-7', 'late result')).toThrow(/illegal transition/);
		const { closeOutTask } = await import('$lib/server/completionClose');
		await closeOutTask('sully-br-7', 'done', 'late result');
		expect(getChatMessages(50, 'thread-bridge').length).toBe(before);
		expect(j.getJob('sully-br-7')?.status).toBe('failed');
	});
});

describe('poll() end-to-end over a fixture log', () => {
	it('tails fixture markers and reconciles each matching in-flight job', async () => {
		const j = await seedWorkingJob('sully-poll-1');
		j.createJob({
			traceId: 'rtr-poll-2',
			worker: 'claude-code',
			category: 'code',
			brief: 'second job',
			fingerprint: 'f2',
			predictedTokens: 0,
			threadId: 'thread-bridge'
		});
		j.markDispatched('rtr-poll-2');

		const lines = [
			JSON.stringify({ trace_id: 'sully-poll-1', status: 'INCONCLUSIVE', summary: 'stalled' }),
			JSON.stringify({ trace_id: 'rtr-poll-2', status: 'CONFIRMED_WORKING', summary: 'merged' }),
			JSON.stringify({ trace_id: 'unrelated-trace', status: 'FAILED', summary: 'ignored' }),
			'not json at all'
		];
		fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf8');

		const { poll } = await import('$lib/server/completion_poller');
		await poll();

		expect(j.getJob('sully-poll-1')?.status).toBe('failed');
		expect(j.getJob('sully-poll-1')?.current_activity).toBe('INCONCLUSIVE — stalled');
		expect(['done', 'synthesized']).toContain(j.getJob('rtr-poll-2')?.status);
	});
});
