import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getVoiceServiceStatus,
	startVoiceServices,
	stopVoiceServices
} from '$lib/server/voice_services';
import { cloudAvailable } from '$lib/server/voices';

export const POST: RequestHandler = async ({ request }) => {
	let action: string;
	try {
		action = (await request.json()).action;
	} catch {
		return json({ error: 'invalid json' }, { status: 400 });
	}

	if (action === 'status') {
		const status = await getVoiceServiceStatus();
		// When ElevenLabs is primary, Chatterbox was intentionally skipped on start —
		// gate readiness on STT only so the voice session isn't blocked on a service
		// that was never launched.
		const ready = cloudAvailable() ? status.stt === 'active' : status.bothReady;
		return json({ ...status, ready });
	}

	if (action === 'stop') {
		return json(await stopVoiceServices());
	}

	if (action === 'start') {
		// Skip Chatterbox startup when ElevenLabs is the active TTS provider — it
		// saves 3.2 GB of VRAM and the 21-second GPU cold-start. If ElevenLabs caps
		// out mid-session, speak-local cold-starts Chatterbox on demand.
		const result = await startVoiceServices(undefined, { skipTts: cloudAvailable() });
		if (result.ready) return json({ ready: true });
		const error = result.errors[0] || 'failed to start speech services';
		const status = error.startsWith('failed to start speech services') ? 500 : 504;
		return json({ ready: false, error, errors: result.errors }, { status });
	}

	return json({ error: 'unknown action' }, { status: 400 });
};
