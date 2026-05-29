// Local TTS proxy. Streams Chatterbox-synthesized speech from the companion
// speech service (127.0.0.1:18771) back to the browser. Called per-sentence as
// companion-v1's reply streams. Sits alongside the cloud ElevenLabs /api/chat/speak.
//
// Server-to-server: the TTS service is bound to localhost and is NOT publicly
// exposed; the browser only ever talks to this same-origin route. The incoming
// request's abort signal is propagated to the upstream fetch so a barge-in
// (client aborts) cancels the in-flight synthesis.

import type { RequestHandler } from './$types';

const TTS_URL = (process.env.COMPANION_TTS_URL || 'http://127.0.0.1:18771').replace(/\/+$/, '');

export const POST: RequestHandler = async ({ request }) => {
	let body: { text?: string; voice_ref?: string };
	try {
		body = await request.json();
	} catch {
		return new Response('invalid json', { status: 400 });
	}
	const text = (body.text || '').trim();
	if (!text) return new Response('empty text', { status: 400 });

	try {
		const upstream = await fetch(`${TTS_URL}/tts`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, voice_ref: body.voice_ref }),
			signal: request.signal // barge-in: client abort cancels upstream synthesis
		});
		if (!upstream.ok || !upstream.body) {
			return new Response('tts unavailable', { status: 502 });
		}
		// Stream the WAV straight through.
		return new Response(upstream.body, {
			headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }
		});
	} catch (e) {
		// AbortError (barge-in) is expected; everything else is a real failure.
		if (e instanceof Error && e.name === 'AbortError') {
			return new Response(null, { status: 499 });
		}
		return new Response('tts service unreachable', { status: 502 });
	}
};
