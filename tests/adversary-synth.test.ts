import { describe, it, expect, vi } from 'vitest';
const calls: { system?: string }[] = [];
vi.mock('$lib/server/chat/consult', () => ({
	runConsultClaude: vi.fn(async (_q: string, _m: string, system?: string) => {
		calls.push({ system });
		return { answer: 'ok' };
	})
}));
describe('synthesizeWorkerResult concerns', () => {
	it('concerns add a judgment-framed reviewer-concern instruction', async () => {
		const { synthesizeWorkerResult } = await import('$lib/server/routing/synthesize');
		await synthesizeWorkerResult({
			brief: 'b',
			result: 'r',
			concerns: ['may weaken error handling']
		});
		const s = (calls.at(-1)!.system || '').toLowerCase();
		expect(s).toMatch(/reviewer|concern|opinion|judgment|not a verified fact|flagged/);
		expect(s).toContain('may weaken error handling');
	});
	it('no concerns → no reviewer-concern instruction', async () => {
		const { synthesizeWorkerResult } = await import('$lib/server/routing/synthesize');
		await synthesizeWorkerResult({ brief: 'b', result: 'r' });
		expect(calls.at(-1)!.system || '').not.toMatch(/Reviewer concern|a reviewer flagged/i);
	});
});
