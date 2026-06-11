// LOS-193 — run-sheet selectors: pure derivations from the deny-list-filtered
// stream rows. Truth guards under test: absent data = absent row (empty
// selectors), latest gate result wins, structured payloads never leak raw,
// unknown verbs never surface as raw snake_case.
import { describe, expect, it } from 'vitest';
import {
	deriveGateBadges,
	deriveResultFiles,
	buildSheetLog,
	sheetLogText
} from '$lib/work-surface/pill/pillModel';
import type { StreamRow } from '$lib/chat/dispatchReconcile';

const row = (seq: number, action: string, target: string | null = null): StreamRow => ({
	seq,
	action,
	target
});

describe('deriveGateBadges', () => {
	it('returns empty when no gate rows exist (absent data = absent row)', () => {
		expect(deriveGateBadges([row(1, 'reading', 'src/a.ts'), row(2, 'edited', 'src/a.ts')])).toEqual(
			[]
		);
		expect(deriveGateBadges([])).toEqual([]);
	});

	it('maps verification_poll GO / NO_GO / warn-ish / payload-less', () => {
		expect(deriveGateBadges([row(1, 'verification_poll', '{"overall":"GO"}')])).toEqual([
			{ kind: 'verify', verdict: 'go', label: 'Verified — looks good' }
		]);
		expect(deriveGateBadges([row(1, 'verification_poll', '{"overall":"NO_GO"}')])[0]).toMatchObject(
			{ verdict: 'no-go' }
		);
		expect(deriveGateBadges([row(1, 'verification_poll', '{"overall":"warn"}')])[0]).toMatchObject({
			verdict: 'warn'
		});
		expect(deriveGateBadges([row(1, 'verification_poll', null)])[0]).toMatchObject({
			verdict: 'ran'
		});
	});

	it('maps adversary_reviewed counts: clean vs findings vs no payload', () => {
		expect(deriveGateBadges([row(1, 'adversary_reviewed', '{"count":0}')])[0]).toMatchObject({
			kind: 'adversary',
			verdict: 'go',
			label: 'Adversary — no issues'
		});
		expect(deriveGateBadges([row(1, 'adversary_reviewed', '{"count":3}')])[0]).toMatchObject({
			verdict: 'warn',
			label: 'Adversary — 3 findings'
		});
		expect(deriveGateBadges([row(1, 'adversary_reviewed', '{"count":1}')])[0].label).toBe(
			'Adversary — 1 finding'
		);
		expect(deriveGateBadges([row(1, 'adversary_reviewed', null)])[0]).toMatchObject({
			verdict: 'ran'
		});
	});

	it('latest gate result of each kind wins (rows arrive seq-ascending)', () => {
		const badges = deriveGateBadges([
			row(1, 'verification_poll', '{"overall":"NO_GO"}'),
			row(2, 'edited', 'src/a.ts'),
			row(3, 'verification_poll', '{"overall":"GO"}')
		]);
		expect(badges).toHaveLength(1);
		expect(badges[0]).toMatchObject({ kind: 'verify', verdict: 'go' });
	});

	it('carries both kinds when both gates ran', () => {
		const badges = deriveGateBadges([
			row(1, 'verification_poll', '{"overall":"GO"}'),
			row(2, 'adversary_reviewed', '{"count":0}')
		]);
		expect(badges.map((b) => b.kind)).toEqual(['verify', 'adversary']);
	});
});

describe('deriveResultFiles', () => {
	it('returns empty when the worker wrote nothing (truth guard: files row only when files exist)', () => {
		expect(deriveResultFiles([row(1, 'reading', 'src/a.ts'), row(2, 'thinking', 'hmm')])).toEqual(
			[]
		);
		expect(deriveResultFiles([])).toEqual([]);
	});

	it('collects unique write-shaped targets in first-seen order', () => {
		expect(
			deriveResultFiles([
				row(1, 'edited', 'src/a.ts'),
				row(2, 'wrote_file', 'src/b.ts'),
				row(3, 'edited', 'src/a.ts'), // dupe
				row(4, 'write_file', 'src/c.ts'),
				row(5, 'created_artifact', 'out/report.md')
			])
		).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'out/report.md']);
	});

	it('never treats a structured (JSON) target as a path, and skips empty targets', () => {
		expect(deriveResultFiles([row(1, 'edited', '{"foo":"bar"}'), row(2, 'edited', null)])).toEqual(
			[]
		);
	});
});

describe('sheetLogText / buildSheetLog', () => {
	it('humanizes the worker vocabulary with targets interpolated', () => {
		expect(sheetLogText('reading', 'src/app.css')).toBe('Reading src/app.css');
		expect(sheetLogText('edited', 'src/app.css')).toBe('Edited src/app.css');
		expect(sheetLogText('wrote_file', 'src/x.ts')).toBe('Wrote src/x.ts');
		expect(sheetLogText('ran', 'npm test')).toBe('Ran: npm test');
		expect(sheetLogText('thinking', null)).toBe('Thinking it through');
		expect(sheetLogText('finalizing', null)).toBe('Wrapping up');
	});

	it('never leaks a raw JSON payload into a log line', () => {
		const line = sheetLogText('verification_poll', '{"overall":"GO","detail":"secret"}');
		expect(line).toBe('Verified — looks good');
		expect(line).not.toContain('{');
		expect(sheetLogText('adversary_reviewed', '{"count":2}')).toBe(
			'Adversarial review — 2 findings'
		);
	});

	it('unknown verbs Title-Case readably — never raw snake_case', () => {
		expect(sheetLogText('some_new_action', null)).toBe('Some New Action');
		expect(sheetLogText('some_new_action', null)).not.toContain('_');
	});

	it('buildSheetLog keeps chronological order and the raw action for hooks', () => {
		const log = buildSheetLog([row(3, 'reading', 'src/a.ts'), row(7, 'edited', 'src/a.ts')]);
		expect(log).toEqual([
			{ seq: 3, action: 'reading', text: 'Reading src/a.ts' },
			{ seq: 7, action: 'edited', text: 'Edited src/a.ts' }
		]);
	});

	it('truncates an oversized target instead of blowing up the row', () => {
		const long = 'x'.repeat(400);
		const line = sheetLogText('reading', long);
		expect(line.length).toBeLessThan(160);
		expect(line.endsWith('…')).toBe(true);
	});
});
