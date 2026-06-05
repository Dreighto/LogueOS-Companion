import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
const DB = '/tmp/sully-mutation-gate-test.db';
vi.mock('$env/dynamic/private', () => ({
	env: {
		LOGUEOS_APP_MODE: 'companion',
		LOGUEOS_MEMORY_DB_PATH: DB,
		COMPANION_DISPATCH_ENABLED: 'true'
	}
}));
beforeEach(() => {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
	new Database(DB).close();
	vi.resetModules();
});
afterEach(() => {
	for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
});

async function seedRunning(threadId: string) {
	const j = await import('$lib/server/dispatchJobs');
	const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
	bootstrapCompanionDb();
	j.createJob({
		traceId: `r-${threadId}`,
		worker: 'claude-code',
		category: 'code',
		brief: 'x',
		fingerprint: 'f',
		predictedTokens: 0,
		threadId
	});
	j.markDispatched(`r-${threadId}`); // RUNNING
}

describe('runMutationGate', () => {
	it('no active task → NO_ACTIVE_TASK', async () => {
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		expect(runMutationGate('t0', 'build me a thing').classification).toBe('NO_ACTIVE_TASK');
	});
	it('running task + plain conversation → CONVERSATIONAL_ONLY', async () => {
		await seedRunning('t1');
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		expect(runMutationGate('t1', 'thanks, that makes sense').classification).toBe(
			'CONVERSATIONAL_ONLY'
		);
		expect(runMutationGate('t1', 'what do you think of the rabbit icon?').classification).toBe(
			'CONVERSATIONAL_ONLY'
		);
	});
	it('running task + work intent → RUNNING_WORK_INTENT (never silently dispatched)', async () => {
		await seedRunning('t2');
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		const r = runMutationGate('t2', 'also audit the console repo and fix the build');
		expect(r.classification).toBe('RUNNING_WORK_INTENT');
		expect(r.activeTaskId).toBe('r-t2');
	});
	it('pre-dispatch (gated) active task → NO_ACTIVE_TASK (left to ask-before-dispatch)', async () => {
		const j = await import('$lib/server/dispatchJobs');
		const { bootstrapCompanionDb } = await import('$lib/server/bootstrap');
		bootstrapCompanionDb();
		j.proposeTask({ taskId: 'g1', threadId: 't3', source: 'chat', category: 'code', brief: 'x' });
		j.markClassified('g1', 'chat', null);
		j.markGatedProposal('g1', {
			worker: 'claude-code',
			category: 'code',
			brief: 'x',
			targetRepo: 'companion',
			task: 'x'
		});
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		expect(runMutationGate('t3', 'also do this other thing').classification).toBe('NO_ACTIVE_TASK');
	});

	// E2 over-gate fix (live audit 2026-06-04): an opinion/advice question that
	// merely MENTIONS the running task (its work-noun, e.g. "audit") must NOT be
	// read as new work-intent. Precision-bias: an opinion signal overrides the
	// work-word match → stay conversational. Real imperatives still gate.
	it('running task + opinion question mentioning the running work → CONVERSATIONAL_ONLY (E2)', async () => {
		await seedRunning('tE2');
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		const r = runMutationGate(
			'tE2',
			'Hey while you are working on that audit, just chatting, what is your read on whether I should offload the voice service to the Jetson?'
		);
		expect(r.classification).toBe('CONVERSATIONAL_ONLY');
	});
	it('running task + "should I refactor X?" advice question → CONVERSATIONAL_ONLY', async () => {
		await seedRunning('tE3');
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		expect(runMutationGate('tE3', 'should I refactor the whole voice module?').classification).toBe(
			'CONVERSATIONAL_ONLY'
		);
		expect(
			runMutationGate('tE3', 'what do you think — is it worth building a separate dashboard?')
				.classification
		).toBe('CONVERSATIONAL_ONLY');
	});
	it('running task + a real imperative still gates as RUNNING_WORK_INTENT (guard)', async () => {
		await seedRunning('tE4');
		const { runMutationGate } = await import('$lib/server/routing/mutation_gate');
		expect(
			runMutationGate(
				'tE4',
				'Actually while that is running, can you also fix the type error in turn_replay.ts for me?'
			).classification
		).toBe('RUNNING_WORK_INTENT');
		expect(runMutationGate('tE4', 'also deploy the console build now').classification).toBe(
			'RUNNING_WORK_INTENT'
		);
	});
});
