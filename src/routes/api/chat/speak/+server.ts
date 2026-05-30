// ElevenLabs text-to-speech proxy.
// POST {text: string, voice_id?: string}
//   → calls ElevenLabs /v1/text-to-speech/<voice_id> → streams MP3 back
// Voice locked to Emma (56bWURjYFHyYyVf490Dp) when voice_id omitted.
// Cap: ELEVENLABS_DAILY_CHAR_CAP env var (default 50000) via chat_tts_usage table.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getTodayTtsUsage, addTtsUsage } from '$lib/server/voice_usage';
import { getVoice } from '$lib/server/voices';

const EMMA_VOICE_ID = '56bWURjYFHyYyVf490Dp';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw error(503, { message: 'TTS not configured' });
	}

	const dailyCharCap = Number(env.ELEVENLABS_DAILY_CHAR_CAP ?? 50_000);

	const body = await request.json().catch(() => null);
	if (!body || typeof body.text !== 'string' || !body.text.trim()) {
		throw error(400, { message: 'Missing text' });
	}

	const text: string = body.text.trim();
	// Resolve the requested voice server-side by opaque id. No `voice` → legacy
	// default (Emma + the body.model override or turbo), keeping read-aloud
	// unchanged. Voice mode sends voice:'emma' → Emma + flash. A non-ElevenLabs
	// voice id (e.g. a local-only voice) routes here only as a mistake — fall back
	// to the Emma default rather than 502.
	const reqModel =
		typeof body.model === 'string' && body.model.startsWith('eleven_') ? body.model : null;
	let voiceId: string = EMMA_VOICE_ID; // locked default per design §2D.2
	let modelId: string = reqModel ?? 'eleven_turbo_v2_5';
	if (typeof body.voice === 'string') {
		const v = getVoice(body.voice);
		if (v.engine === 'elevenlabs') {
			voiceId = v.voiceId ?? EMMA_VOICE_ID;
			modelId = v.model ?? modelId;
		}
	}

	// Cap check
	const usedToday = getTodayTtsUsage();
	if (usedToday + text.length > dailyCharCap) {
		return new Response(
			JSON.stringify({ error: 'cap_exhausted', chars_used_today: usedToday, cap: dailyCharCap }),
			{ status: 429, headers: { 'content-type': 'application/json' } }
		);
	}

	const ttsRes = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
		method: 'POST',
		headers: {
			'xi-api-key': apiKey,
			'content-type': 'application/json',
			accept: 'audio/mpeg'
		},
		body: JSON.stringify({
			text,
			model_id: modelId,
			voice_settings: { stability: 0.5, similarity_boost: 0.75 }
		})
	});

	if (!ttsRes.ok) {
		const errBody = await ttsRes.text();
		console.error('ElevenLabs TTS error:', ttsRes.status, errBody);
		throw error(502, { message: 'TTS request failed' });
	}

	// Record usage before streaming so the cap is updated even if client drops
	addTtsUsage(text.length);

	return new Response(ttsRes.body, {
		status: 200,
		headers: {
			'content-type': 'audio/mpeg',
			'cache-control': 'no-store'
		}
	});
};
