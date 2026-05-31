import { describe, expect, it } from 'vitest';
import { sseEvent, parseLastEventId } from '$lib/server/sseFormat';

describe('sseEvent', () => {
	it('formats id: trace:seq + data per the SSE wire format', () => {
		const out = sseEvent('sully-1', 5, { action: 'reading', target: 'src/a.ts' });
		expect(out).toBe('id: sully-1:5\ndata: {"action":"reading","target":"src/a.ts"}\n\n');
	});
});

describe('parseLastEventId', () => {
	it('extracts the numeric seq from a trace:seq Last-Event-ID', () => {
		expect(parseLastEventId('sully-1:42')).toBe(42);
	});
	it('returns 0 for a missing/garbage header', () => {
		expect(parseLastEventId(null)).toBe(0);
		expect(parseLastEventId('nonsense')).toBe(0);
	});
});
