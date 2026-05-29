// AudioWorklet mic-capture processor for the companion voice mode.
//
// Captures mono microphone audio, converts Float32 [-1,1] -> Int16 PCM (the
// reference RealtimeSTT math: *32768, clamped to [-32768, 32767]), buffers a
// chunk, and posts the Int16 ArrayBuffer to the main thread for WebSocket send.
//
// NO client-side downsampling: iOS pins the AudioContext to ~48 kHz, so we ship
// native-rate Int16 and let the STT server resample to 16 kHz (the proven
// server-side pattern). Per MDN: read inputs[0][0] for mono; never hardcode the
// 128-frame render-quantum size (check .length). Served as a static asset so
// the worklet URL is fixed (no Vite `new URL(import.meta.url)` SSR rejection).
//
// Lives in static/ (not src/) intentionally — loaded via
//   audioCtx.audioWorklet.addModule(`${base}/pcm-capture-worklet.js`)

const FLUSH_SAMPLES = 4096; // ~85 ms @ 48 kHz — frequent enough for snappy partials

class PCMCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._buf = new Int16Array(FLUSH_SAMPLES);
		this._n = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true; // no input this quantum; keep processor alive
		for (let i = 0; i < channel.length; i++) {
			const s = channel[i] * 32768;
			this._buf[this._n++] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
			if (this._n === this._buf.length) {
				const chunk = this._buf.slice(0, this._n); // copy; _buf keeps capturing
				this.port.postMessage(chunk.buffer, [chunk.buffer]); // transfer ownership
				this._n = 0;
			}
		}
		return true; // keep the node running
	}
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
