import type { TaskWorker } from '$lib/types/workSurface';

/** Per-identity brand colour (operator-locked 2026-06-06). Identity, not role/status. */
export function workerBrandColor(identity?: string, shortCode?: string): string {
	const id = (identity || '').toLowerCase();
	const code = (shortCode || '').toUpperCase();
	if (id === 'claude-code' || code === 'CC') return '#f97316';
	if (id === 'antigravity' || code === 'AGY') return '#a855f7';
	if (id === 'codex' || code === 'CDX') return '#9ca3af';
	if (id === 'deepseek' || code === 'DPSK') return '#3b82f6';
	if (id === 'gemini' || code === 'GMI') return '#60a5fa';
	if (id === 'cursor' || code === 'CUR') return '#a8a29e';
	return 'var(--color-status-blue)';
}

/** Step text hints wrap-up — faster shared heartbeat across graph / row / registry. */
export function workerBreathFinishing(worker: Pick<TaskWorker, 'status' | 'step'>): boolean {
	if (worker.status !== 'active') return false;
	const step = (worker.step ?? '').toLowerCase();
	return /validat|verif|check|render|test|commit|final|wrapp|audit|confirm|polish/.test(step);
}

export function workerBreathDelay(index: number): string {
	return index % 2 === 0 ? '0s' : '0.35s';
}

/** Packet glide loop duration — TASK land pulse syncs to this. */
export function packetGlideDuration(motionType?: string): string | null {
	switch (motionType) {
		case 'researching':
			return '7.5s';
		case 'building':
			return '2s';
		case 'verifying':
			return '1s';
		default:
			return null;
	}
}
