import { describe, it, expect, vi } from 'vitest';

const consult = vi.fn();
vi.mock('$lib/server/chat/consult', () => ({
	runConsultClaude: (...a: unknown[]) => consult(...a)
}));

describe('shouldReview (deterministic stakes gate)', () => {
	it('reviews code/file/state-changing work', async () => {
		const { shouldReview } = await import('$lib/server/routing/adversary');
		expect(shouldReview({ category: 'code' } as never, {})).toBe(true);
		expect(shouldReview({ category: 'general' } as never, { fs_paths: ['x'] })).toBe(true);
		expect(shouldReview({ category: 'general' } as never, { git_ref: 'abc1234' })).toBe(true);
		expect(shouldReview({ category: 'general' } as never, { pr_number: 5 })).toBe(true);
	});
	it('skips low-stakes (no code, no state-change evidence)', async () => {
		const { shouldReview } = await import('$lib/server/routing/adversary');
		expect(shouldReview({ category: 'general' } as never, {})).toBe(false);
		expect(shouldReview({ category: 'general' } as never, { health_url: 'http://x' })).toBe(false);
	});
});

describe('runAdversaryReview (LLM, total)', () => {
	it('parses a JSON array of concerns from the model', async () => {
		consult.mockResolvedValueOnce({
			answer: '[{"concern":"removes error handling","severity":"high"}]'
		});
		const { runAdversaryReview } = await import('$lib/server/routing/adversary');
		const r = await runAdversaryReview({ brief: 'b', result: 'r', matrix: 'm' });
		expect(r.available).toBe(true);
		expect(r.findings[0].concern).toMatch(/error handling/);
		expect(r.findings[0].severity).toBe('high');
	});
	it('empty array when the model finds nothing', async () => {
		consult.mockResolvedValueOnce({ answer: '[]' });
		const { runAdversaryReview } = await import('$lib/server/routing/adversary');
		const r = await runAdversaryReview({ brief: 'b', result: 'r', matrix: 'm' });
		expect(r.available).toBe(true);
		expect(r.findings).toEqual([]);
	});
	it('TOTAL: model error → available:false, no findings, never throws', async () => {
		consult.mockRejectedValueOnce(new Error('boom'));
		const { runAdversaryReview } = await import('$lib/server/routing/adversary');
		const r = await runAdversaryReview({ brief: 'b', result: 'r', matrix: 'm' });
		expect(r.available).toBe(false);
		expect(r.findings).toEqual([]);
	});
	it('TOTAL: unparseable output → available:true, no findings (degrade, never throw)', async () => {
		consult.mockResolvedValueOnce({ answer: 'I think it looks fine honestly' });
		const { runAdversaryReview } = await import('$lib/server/routing/adversary');
		const r = await runAdversaryReview({ brief: 'b', result: 'r', matrix: 'm' });
		expect(r.findings).toEqual([]);
	});
});
