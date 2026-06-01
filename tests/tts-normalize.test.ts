import { describe, it, expect } from 'vitest';
import { speakableText } from '../src/lib/server/tts_normalize';

describe('speakableText — spoken-number normalization for TTS', () => {
	it('speaks clock times naturally (the "5:02 -> five oh two" fix)', () => {
		expect(speakableText("It's 5:02 PM")).toBe("It's five oh two PM");
		expect(speakableText('at 5:30')).toBe('at five thirty');
		expect(speakableText('12:00 noon')).toBe("twelve o'clock noon");
		expect(speakableText('13:05')).toBe('one oh five');
	});

	it('speaks dates and years', () => {
		expect(speakableText('Sunday, May 31, 2026')).toBe(
			'Sunday, May thirty-first, twenty twenty-six'
		);
		expect(speakableText('2000')).toBe('two thousand');
		expect(speakableText('1999')).toBe('nineteen ninety-nine');
	});

	it('speaks ordinals, integers and decimals', () => {
		expect(speakableText('the 31st')).toBe('the thirty-first');
		expect(speakableText('I have 3 things')).toBe('I have three things');
		expect(speakableText('3.5 hours')).toBe('three point five hours');
	});

	it('leaves alphanumeric tokens alone', () => {
		expect(speakableText('16GB of RAM')).toBe('16GB of RAM');
		expect(speakableText('v2 of the app')).toBe('v2 of the app');
	});
});
