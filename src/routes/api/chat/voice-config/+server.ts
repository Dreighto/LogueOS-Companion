// Voice-mode config for the client. Tells the browser where the speech-to-text
// WebSocket lives (the Tailscale Funnel path, resolved relative to the current
// host so no hostname is hardcoded) and the default UI flags. Lets the server
// flip voice on/off and tune defaults without a client rebuild.
//
// TTS provider is env-driven (VOICE_TTS_PROVIDER):
//   • 'elevenlabs' → speak in the operator's chosen "Emma" voice via ElevenLabs
//     Flash (~75ms, cloud). The local Chatterbox path is handed back as a
//     graceful fallback so voice never goes silent if credits/cap run out.
//   • anything else (default) → local Chatterbox only (free, fully local).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = () => {
	const provider = (env.VOICE_TTS_PROVIDER || 'local').toLowerCase();
	const elevenReady = provider === 'elevenlabs' && !!env.ELEVENLABS_API_KEY;

	// Emma (cloud) primary → Chatterbox (local) fallback when configured;
	// otherwise local-only with no fallback path.
	const ttsPath = elevenReady ? '/api/chat/speak' : '/api/chat/speak-local';
	const ttsModel = elevenReady ? 'eleven_flash_v2_5' : undefined;
	const ttsFallbackPath = elevenReady ? '/api/chat/speak-local' : undefined;

	return json({
		voiceEnabled: true,
		// Same-origin path proxied to the STT WS service via Tailscale Funnel.
		// Client builds: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${wsPath}`.
		wsPath: '/companion-voice',
		// Per-sentence TTS endpoint (same origin). Emma/ElevenLabs or local Chatterbox.
		ttsPath,
		// Optional model id forwarded to the TTS endpoint (ElevenLabs Flash for
		// low-latency voice; undefined for the local path, which ignores it).
		ttsModel,
		// Optional same-origin fallback TTS endpoint. The client tries `ttsPath`
		// first and falls forward to this if the primary returns non-OK (cap
		// exhausted / quota / 5xx) so a dead cloud voice degrades to the local one.
		ttsFallbackPath,
		captionsDefault: true, // show streaming assistant text by default; user can toggle voice-only
		// Hands-free is the operator's primary workflow (wireless headphones + in-app
		// mute). Server-side Silero VAD endpoints the turn; the Mute button gates the
		// mic while listening/thinking. PTT stays available via the in-overlay toggle
		// (better for noisy rooms / no headphones / iOS backgrounding).
		pttDefault: false,
		continuousDefault: true
	});
};
