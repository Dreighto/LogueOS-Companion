// Get / set Sully's active voice. The picker in the Voice Mode overlay POSTs
// here when the operator switches; the choice persists in companion_settings so
// it survives reloads and follows them across devices. Returns the new TTS
// routing so the client can apply the switch live without refetching the whole
// voice-config.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting } from '$lib/server/settings';
import { getVoice, clientVoices, routingFor, DEFAULT_VOICE_ID, VOICES } from '$lib/server/voices';

export const GET: RequestHandler = () => {
	const activeId = getSetting('active_voice') || DEFAULT_VOICE_ID;
	return json({ voice: getVoice(activeId).id, voices: clientVoices() });
};

export const POST: RequestHandler = async ({ request }) => {
	let id: unknown;
	try {
		id = (await request.json())?.voice;
	} catch {
		return json({ error: 'invalid json' }, { status: 400 });
	}
	if (typeof id !== 'string' || !VOICES.some((v) => v.id === id)) {
		return json({ error: 'unknown voice' }, { status: 400 });
	}
	setSetting('active_voice', id);
	const voice = getVoice(id);
	const routing = routingFor(voice);
	return json({
		voice: voice.id,
		ttsPath: routing.ttsPath,
		ttsModel: routing.ttsModel,
		ttsFallbackPath: routing.ttsFallbackPath
	});
};
