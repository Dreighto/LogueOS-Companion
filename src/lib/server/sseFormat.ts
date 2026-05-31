// Pure SSE wire-format helpers (spec §4.5). id: <trace_id>:<seq> per row so the
// client can resume with Last-Event-ID and replay seq > cursor.
export function sseEvent(traceId: string, seq: number, data: unknown): string {
	return `id: ${traceId}:${seq}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Parse the numeric seq out of a `trace:seq` Last-Event-ID; 0 when absent. */
export function parseLastEventId(header: string | null): number {
	if (!header) return 0;
	const idx = header.lastIndexOf(':');
	if (idx < 0) return 0;
	const n = Number.parseInt(header.slice(idx + 1), 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}
