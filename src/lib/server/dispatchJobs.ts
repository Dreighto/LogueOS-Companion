import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';

export type JobStatus =
	| 'decided'
	| 'dispatched'
	| 'working'
	| 'done'
	| 'failed'
	| 'retry'
	| 'aborted';

export interface PendingJob {
	id: number;
	trace_id: string;
	worker: string;
	status: JobStatus;
	category: string;
	current_activity: string | null;
	seq_cursor: number;
	started_at: string | null;
	ended_at: string | null;
	predicted_tokens: number;
	actual_prompt: number | null;
	actual_completion: number | null;
	actual_cache_read: number | null;
	actual_cache_creation: number | null;
	actual_total: number | null;
	result_ref: string | null;
	brief: string;
	fingerprint: string;
}

// Allowed forward transitions. decided -> dispatched -> working -> terminal;
// retry loops back to dispatched. Terminal states accept no further moves.
// decided also allows direct short-circuit to working/done/failed/aborted for
// cases where the dispatcher resolves immediately without a full lifecycle step.
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
	decided: ['dispatched', 'working', 'done', 'aborted', 'failed'],
	dispatched: ['working', 'done', 'failed', 'retry', 'aborted'],
	working: ['done', 'failed', 'retry', 'aborted'],
	retry: ['dispatched', 'aborted', 'failed'],
	done: [],
	failed: [],
	aborted: []
};

let _ensured = false;
function getDb(): Database.Database {
	const db = new Database(serverConfig.memoryDbPath);
	if (!_ensured) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS pending_jobs (
				id                    INTEGER PRIMARY KEY AUTOINCREMENT,
				trace_id              TEXT UNIQUE NOT NULL,
				worker                TEXT NOT NULL,
				status                TEXT NOT NULL DEFAULT 'decided',
				category              TEXT NOT NULL DEFAULT 'general',
				current_activity      TEXT,
				seq_cursor            INTEGER NOT NULL DEFAULT 0,
				started_at            TEXT DEFAULT CURRENT_TIMESTAMP,
				ended_at              TEXT,
				predicted_tokens      INTEGER NOT NULL DEFAULT 0,
				actual_prompt         INTEGER,
				actual_completion     INTEGER,
				actual_cache_read     INTEGER,
				actual_cache_creation INTEGER,
				actual_total          INTEGER,
				result_ref            TEXT,
				brief                 TEXT NOT NULL DEFAULT '',
				fingerprint           TEXT NOT NULL DEFAULT ''
			);
			CREATE INDEX IF NOT EXISTS idx_pending_jobs_status ON pending_jobs(status);
			CREATE INDEX IF NOT EXISTS idx_pending_jobs_fp ON pending_jobs(fingerprint);
		`);
		_ensured = true;
	}
	return db;
}

export function createJob(opts: {
	traceId: string;
	worker: string;
	category: string;
	brief: string;
	fingerprint: string;
	predictedTokens: number;
}): void {
	const db = getDb();
	try {
		db.prepare(
			`INSERT INTO pending_jobs (trace_id, worker, status, category, brief, fingerprint, predicted_tokens)
			 VALUES (?, ?, 'decided', ?, ?, ?, ?)`
		).run(
			opts.traceId,
			opts.worker,
			opts.category,
			opts.brief,
			opts.fingerprint,
			opts.predictedTokens
		);
	} finally {
		db.close();
	}
}

export function getJob(traceId: string): PendingJob | undefined {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return undefined;
	const db = getDb();
	try {
		return db.prepare('SELECT * FROM pending_jobs WHERE trace_id = ?').get(traceId) as
			| PendingJob
			| undefined;
	} finally {
		db.close();
	}
}

function transition(traceId: string, to: JobStatus, patch: Partial<PendingJob> = {}): void {
	const db = getDb();
	try {
		const row = db.prepare('SELECT status FROM pending_jobs WHERE trace_id = ?').get(traceId) as
			| { status: JobStatus }
			| undefined;
		if (!row) throw new Error(`no job for trace_id ${traceId}`);
		if (!TRANSITIONS[row.status].includes(to)) {
			throw new Error(`illegal transition ${row.status} -> ${to} for ${traceId}`);
		}
		const cols = ['status = ?'];
		const vals: unknown[] = [to];
		for (const [k, v] of Object.entries(patch)) {
			cols.push(`${k} = ?`);
			vals.push(v);
		}
		vals.push(traceId);
		db.prepare(`UPDATE pending_jobs SET ${cols.join(', ')} WHERE trace_id = ?`).run(...vals);
	} finally {
		db.close();
	}
}

export function markDispatched(traceId: string): void {
	transition(traceId, 'dispatched');
}
export function markWorking(traceId: string, activity: string | null): void {
	transition(traceId, 'working', { current_activity: activity });
}
export function markDone(traceId: string, resultRef: string | null): void {
	transition(traceId, 'done', { result_ref: resultRef, ended_at: new Date().toISOString() });
}
export function markFailed(traceId: string, reason: string | null): void {
	transition(traceId, 'failed', { current_activity: reason, ended_at: new Date().toISOString() });
}
export function markRetry(traceId: string): void {
	transition(traceId, 'retry');
}
export function markAborted(traceId: string): void {
	transition(traceId, 'aborted', { ended_at: new Date().toISOString() });
}

/** In-flight jobs the kill switch must cancel. */
export function listInFlight(): PendingJob[] {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return [];
	const db = getDb();
	try {
		return db
			.prepare(
				`SELECT * FROM pending_jobs WHERE status IN ('decided','dispatched','working','retry')`
			)
			.all() as PendingJob[];
	} finally {
		db.close();
	}
}
