// Append trailing silence to a PCM WAV buffer.
//
// Why: iOS/WebKit ends WAV playback a few hundred ms early (a long-standing
// quirk), which clips the last word of a read-aloud reply even though the file
// itself is complete and ends in silence. Padding extra trailing silence means
// the bit iOS drops is silence, not speech. Talkback-only (the realtime voice
// path streams per-sentence and must not be buffered).
//
// Canonical 44-byte PCM WAV layout is assumed (Chatterbox output). If the buffer
// isn't a parseable RIFF/WAVE with a final `data` chunk, the original is
// returned unchanged — never throws, never corrupts.

export function padWavTrailingSilence(buf: Buffer, ms: number): Buffer {
	if (ms <= 0 || buf.length < 44) return buf;
	if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
		return buf;
	}
	let off = 12;
	let dataOff = -1;
	let dataSize = 0;
	let channels = 1;
	let rate = 24000;
	let bits = 16;
	while (off + 8 <= buf.length) {
		const id = buf.toString('ascii', off, off + 4);
		const sz = buf.readUInt32LE(off + 4);
		if (id === 'fmt ' && off + 24 <= buf.length) {
			channels = buf.readUInt16LE(off + 10);
			rate = buf.readUInt32LE(off + 12);
			bits = buf.readUInt16LE(off + 22);
		} else if (id === 'data') {
			dataOff = off + 8;
			dataSize = sz;
			break;
		}
		off += 8 + sz + (sz & 1); // chunks are word-aligned
	}
	if (dataOff < 0 || rate <= 0 || bits <= 0 || channels <= 0) return buf;
	// Only safe to append at EOF when `data` is the final chunk (tolerate a
	// single word-align padding byte). Otherwise leave it alone.
	const dataEnd = dataOff + dataSize;
	if (dataEnd !== buf.length && dataEnd + 1 !== buf.length) return buf;

	const bytesPerSample = (bits / 8) * channels;
	const silenceBytes = Math.floor((rate * ms) / 1000) * bytesPerSample;
	if (silenceBytes <= 0) return buf;

	const out = Buffer.concat([
		buf.subarray(0, dataEnd),
		Buffer.alloc(silenceBytes), // zeros = silence
		buf.subarray(dataEnd)
	]);
	out.writeUInt32LE(dataSize + silenceBytes, dataOff - 4); // data chunk size
	out.writeUInt32LE(out.length - 8, 4); // RIFF chunk size
	return out;
}
