// Actual-token capture (spec §4.11). The dispatched worker posts its result-
// marker telemetry (usage_capture.js unified shape) in the final callback; we
// write it into pending_jobs.actual_*. agy has no actuals -> usage:null ->
// columns stay NULL (predicted-only). Also exposes the Phase-1 dispatch meter
// (count + wall-clock today) — countable + honest, no predicted-cost guesswork.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { serverConfig } from './config';

export interface MarkerUsage {
	prompt: number;
	completion: number;
	cache_read: number;
	cache_creation: number;
	total: number;
}
export interface ResultMarker {
	worker: string;
	model: string;
	usage: MarkerUsage | null;
}

export function captureActualTokens(traceId: string, marker: ResultMarker): void {
	if (!marker || !marker.usage) return; // agy / failed-before-first-call: leave NULL
	const u = marker.usage;
	const db = new Database(serverConfig.memoryDbPath);
	try {
		db.prepare(
			`UPDATE pending_jobs
			 SET actual_prompt = ?, actual_completion = ?, actual_cache_read = ?,
			     actual_cache_creation = ?, actual_total = ?
			 WHERE trace_id = ?`
		).run(u.prompt, u.completion, u.cache_read, u.cache_creation, u.total, traceId);
	} finally {
		db.close();
	}
}

export interface DispatchMeter {
	count: number;
	wallClockSeconds: number;
}

/** Today's dispatch count + summed wall-clock (started_at..ended_at) seconds. */
export function getMeter(): DispatchMeter {
	if (!fs.existsSync(serverConfig.memoryDbPath)) return { count: 0, wallClockSeconds: 0 };
	const db = new Database(serverConfig.memoryDbPath, { readonly: true });
	try {
		const today = new Date().toISOString().slice(0, 10);
		const row = db
			.prepare(
				`SELECT COUNT(*) AS count,
				        COALESCE(SUM(
				          CASE WHEN ended_at IS NOT NULL
				               THEN (julianday(ended_at) - julianday(started_at)) * 86400
				               ELSE 0 END
				        ), 0) AS secs
				 FROM pending_jobs
				 WHERE substr(started_at, 1, 10) = ?`
			)
			.get(today) as { count: number; secs: number };
		return { count: row.count, wallClockSeconds: Math.round(row.secs) };
	} catch {
		return { count: 0, wallClockSeconds: 0 };
	} finally {
		db.close();
	}
}
