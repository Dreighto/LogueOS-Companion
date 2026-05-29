// Voice-mode config for the client. Tells the browser where the speech-to-text
// WebSocket lives (the Tailscale Funnel path, resolved relative to the current
// host so no hostname is hardcoded) and the default UI flags. Lets the server
// flip voice on/off and tune defaults without a client rebuild.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json({
		voiceEnabled: true,
		// Same-origin path proxied to the STT WS service via Tailscale Funnel.
		// Client builds: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${wsPath}`.
		wsPath: '/companion-voice',
		// Per-sentence TTS endpoint (same origin, server-proxied to Chatterbox).
		ttsPath: '/api/chat/speak-local',
		captionsDefault: true, // show streaming assistant text by default; user can toggle voice-only
		// iOS continuous hands-free is foreground-only; push-to-talk is the reliable default.
		pttDefault: true
	});
};
