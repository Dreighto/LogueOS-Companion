import { describe, it, expect } from 'vitest';
import { padWavTrailingSilence } from '../src/lib/server/wav_pad';

// Build a canonical 44-byte PCM WAV with `samples` frames of mono 16-bit @ rate.
function makeWav(samples: number, rate = 24000): Buffer {
	const dataBytes = samples * 2; // mono 16-bit
	const buf = Buffer.alloc(44 + dataBytes);
	buf.write('RIFF', 0, 'ascii');
	buf.writeUInt32LE(36 + dataBytes, 4);
	buf.write('WAVE', 8, 'ascii');
	buf.write('fmt ', 12, 'ascii');
	buf.writeUInt32LE(16, 16); // fmt chunk size
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // channels
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * 2, 28); // byte rate
	buf.writeUInt16LE(2, 32); // block align
	buf.writeUInt16LE(16, 34); // bits
	buf.write('data', 36, 'ascii');
	buf.writeUInt32LE(dataBytes, 40);
	// fill with non-zero so we can tell padded silence apart from content
	for (let i = 44; i < buf.length; i += 2) buf.writeInt16LE(1000, i);
	return buf;
}

describe('padWavTrailingSilence', () => {
	it('appends the requested silence and keeps RIFF/data sizes consistent', () => {
		const rate = 24000;
		const src = makeWav(rate, rate); // 1.0s of tone
		const out = padWavTrailingSilence(src, 700); // +0.7s
		const addedBytes = Math.floor((rate * 700) / 1000) * 2;

		expect(out.length).toBe(src.length + addedBytes);
		// RIFF size == file - 8
		expect(out.readUInt32LE(4)).toBe(out.length - 8);
		// data chunk size == original data + silence
		expect(out.readUInt32LE(40)).toBe(rate * 2 + addedBytes);
		// the original tone is preserved at the front
		expect(out.readInt16LE(44)).toBe(1000);
		// the appended tail is pure silence
		expect(out.readInt16LE(out.length - 2)).toBe(0);
		expect(out.readInt16LE(out.length - addedBytes)).toBe(0);
	});

	it('returns the input unchanged for non-WAV or zero ms', () => {
		const notWav = Buffer.from('this is not a wav file at all, really');
		expect(padWavTrailingSilence(notWav, 700)).toBe(notWav);
		const wav = makeWav(100);
		expect(padWavTrailingSilence(wav, 0)).toBe(wav);
	});
});
