import { describe, it, expect } from 'vitest';
import { extractSentences } from '$lib/server/chat/voice_stream';

// voice_stream's streaming caller flushes the trailing remainder as the final
// sentence, so apply that here for realistic single-call assertions.
function splitAll(s: string): string[] {
	const { sentences, rest } = extractSentences(s);
	return rest.trim() ? [...sentences, rest.trim()] : sentences;
}

describe('extractSentences — list enumerators (PRO-967 fix)', () => {
	it('does NOT emit bare "9." / "10." for line-start list markers', () => {
		const out = splitAll('Here are the steps:\n9. Do this thing.\n10. Do that thing.');
		expect(out).not.toContain('9.');
		expect(out).not.toContain('10.');
		expect(out.join(' ')).toContain('9. Do this thing.');
		expect(out.join(' ')).toContain('10. Do that thing.');
	});
});

describe('extractSentences — regressions hold', () => {
	it('splits normal prose into two', () => {
		expect(splitAll('First sentence. Second sentence.')).toEqual([
			'First sentence.',
			'Second sentence.'
		]);
	});
	it('keeps a decimal (3.5) as one sentence', () => {
		expect(splitAll('It costs 3.5 dollars total.')).toEqual(['It costs 3.5 dollars total.']);
	});
	it('keeps an abbreviation (Dr.) as one sentence', () => {
		expect(splitAll('Dr. Smith arrived.')).toEqual(['Dr. Smith arrived.']);
	});
});
