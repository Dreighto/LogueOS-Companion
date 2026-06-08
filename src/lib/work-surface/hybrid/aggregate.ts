// src/lib/work-surface/hybrid/aggregate.ts
import type { AggrStatus, SeedWorker } from './hybrid-types';

/** Priority order: higher index = higher priority. 'stopped' is terminal-
 *  neutral, just above 'done'; an active/failed/needs-you worker still wins. */
const PRIORITY: AggrStatus[] = ['done', 'stopped', 'blocked', 'running', 'failed', 'needs-you'];

export function deriveAggr(workers: SeedWorker[]): AggrStatus {
	if (workers.length === 0) return 'done';
	let best: AggrStatus = 'done';
	for (const worker of workers) {
		const s = worker.status as AggrStatus;
		if (PRIORITY.indexOf(s) > PRIORITY.indexOf(best)) best = s;
	}
	return best;
}
