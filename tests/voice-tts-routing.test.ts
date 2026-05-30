// Lock the voice-mode TTS provider routing. The realtime voice controller reads
// ttsPath / ttsModel / ttsFallbackPath from /api/chat/voice-config to decide
// whether Sully speaks in Emma (ElevenLabs Flash, cloud) or the local Chatterbox
// voice — and where to fall forward when the cloud voice caps out. If this
// contract drifts, voice mode silently speaks in the wrong voice (or none), so
// it's worth pinning.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const ENV: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: ENV }));

beforeEach(() => {
	vi.resetModules();
	for (const k of Object.keys(ENV)) delete ENV[k];
});

async function getConfig(): Promise<Record<string, unknown>> {
	const { GET } = await import('../src/routes/api/chat/voice-config/+server');
	// GET ignores its RequestEvent (pure env read), so an empty object is fine.
	const res = await (GET as unknown as (e: unknown) => Promise<Response>)({});
	return res.json();
}

describe('voice-config TTS routing', () => {
	it('routes to Emma (ElevenLabs Flash) + local fallback when provider=elevenlabs and key present', async () => {
		ENV.VOICE_TTS_PROVIDER = 'elevenlabs';
		ENV.ELEVENLABS_API_KEY = 'xi-test-key';
		const cfg = await getConfig();
		expect(cfg.ttsPath).toBe('/api/chat/speak');
		expect(cfg.ttsModel).toBe('eleven_flash_v2_5');
		expect(cfg.ttsFallbackPath).toBe('/api/chat/speak-local');
	});

	it('is case-insensitive on the provider value', async () => {
		ENV.VOICE_TTS_PROVIDER = 'ElevenLabs';
		ENV.ELEVENLABS_API_KEY = 'xi-test-key';
		const cfg = await getConfig();
		expect(cfg.ttsPath).toBe('/api/chat/speak');
	});

	it('stays local-only (no Emma, no fallback) when provider=elevenlabs but the key is missing', async () => {
		ENV.VOICE_TTS_PROVIDER = 'elevenlabs'; // key absent
		const cfg = await getConfig();
		expect(cfg.ttsPath).toBe('/api/chat/speak-local');
		expect(cfg.ttsModel).toBeUndefined();
		expect(cfg.ttsFallbackPath).toBeUndefined();
	});

	it('defaults to local Chatterbox when the provider is unset', async () => {
		const cfg = await getConfig();
		expect(cfg.ttsPath).toBe('/api/chat/speak-local');
		expect(cfg.ttsModel).toBeUndefined();
		expect(cfg.ttsFallbackPath).toBeUndefined();
	});

	it('always exposes the STT socket path + hands-free defaults', async () => {
		ENV.VOICE_TTS_PROVIDER = 'elevenlabs';
		ENV.ELEVENLABS_API_KEY = 'xi-test-key';
		const cfg = await getConfig();
		expect(cfg.voiceEnabled).toBe(true);
		expect(cfg.wsPath).toBe('/companion-voice');
		expect(cfg.continuousDefault).toBe(true);
	});
});
