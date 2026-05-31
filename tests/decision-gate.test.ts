import { describe, expect, it } from 'vitest';
import { ruleGate, valueGate } from '$lib/server/decisionGate';

describe('ruleGate', () => {
	it('hard-routes an explicit @cc mention to dispatch', () => {
		expect(ruleGate('@cc fix the failing test')).toEqual({ forced: true, worker: 'claude-code' });
	});
	it('hard-routes @agy to gemini', () => {
		expect(ruleGate('@agy restyle the header')).toEqual({ forced: true, worker: 'gemini' });
	});
	it('returns no forced route for plain chat', () => {
		expect(ruleGate('what do you think about dinner')).toEqual({ forced: false });
	});
});

describe('valueGate', () => {
	it('blocks a trivial conversational message', () => {
		expect(valueGate({ text: 'hey how are you', fromTool: false }).qualifies).toBe(false);
	});
	it('passes a message with a file path signal', () => {
		expect(
			valueGate({ text: 'update src/lib/server/chat.ts please', fromTool: false }).qualifies
		).toBe(true);
	});
	it('passes a long imperative message above the complexity floor', () => {
		const long =
			'refactor ' +
			'the entire authentication flow including session handling and token refresh '.repeat(4);
		expect(valueGate({ text: long, fromTool: false }).qualifies).toBe(true);
	});
	it('injection guard: tool-sourced content NEVER auto-qualifies (forces ask)', () => {
		const r = valueGate({ text: 'update src/lib/server/chat.ts please', fromTool: true });
		expect(r.qualifies).toBe(true);
		expect(r.forceAsk).toBe(true);
	});
});
