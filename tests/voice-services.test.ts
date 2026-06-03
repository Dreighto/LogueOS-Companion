import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { promisify } from 'node:util';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
	execFile: execFileMock
}));

function mockSystemctl(responses: Record<string, string>) {
	execFileMock.mockImplementation((_cmd, args: string[], _options, callback) => {
		const action = args[2];
		const unit = args[3];
		const key = `${action}:${unit}`;
		const stdout = responses[key] ?? 'ok';
		callback(null, { stdout: `${stdout}\n`, stderr: '' });
	});
}

async function listenOnRandomPort(server: Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
	return address.port;
}

async function loadVoiceServices(sttPort: number, ttsUrl = 'http://127.0.0.1:18771') {
	vi.resetModules();
	process.env.COMPANION_STT_PORT = String(sttPort);
	process.env.COMPANION_TTS_URL = ttsUrl;
	return import('../src/lib/server/voice_services');
}

beforeEach(() => {
	execFileMock.mockReset();
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.COMPANION_STT_PORT;
	delete process.env.COMPANION_TTS_URL;
});

describe('voice_services', () => {
	it('maps systemd status and readiness', async () => {
		mockSystemctl({
			'is-active:logueos-companion-stt.service': 'active',
			'is-active:logueos-companion-tts.service': 'inactive'
		});
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		const { getVoiceServiceStatus } = await loadVoiceServices(9);
		await expect(getVoiceServiceStatus()).resolves.toEqual({
			stt: 'active',
			tts: 'inactive',
			bothReady: false
		});
		expect(execFileMock).toHaveBeenCalledWith(
			'sudo',
			['-n', '/usr/bin/systemctl', 'is-active', 'logueos-companion-stt.service'],
			{ timeout: 15000 },
			expect.any(Function)
		);
	});

	it('starts both services and reports ready once STT and TTS respond', async () => {
		const sttServer = createServer((socket) => socket.end());
		const sttPort = await listenOnRandomPort(sttServer);
		mockSystemctl({
			'start:logueos-companion-stt.service': 'ok',
			'start:logueos-companion-tts.service': 'ok'
		});
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		try {
			const { startVoiceServices } = await loadVoiceServices(sttPort, 'http://tts.test');
			await expect(startVoiceServices(100)).resolves.toEqual({ ready: true, errors: [] });
			expect(execFileMock).toHaveBeenCalledWith(
				'sudo',
				['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-stt.service'],
				{ timeout: 15000 },
				expect.any(Function)
			);
			expect(fetch).toHaveBeenCalledWith('http://tts.test/health', {
				signal: expect.any(AbortSignal)
			});
		} finally {
			await promisify(sttServer.close.bind(sttServer))();
		}
	});

	it('returns a timeout error when readiness probes never pass', async () => {
		mockSystemctl({
			'start:logueos-companion-stt.service': 'ok',
			'start:logueos-companion-tts.service': 'ok'
		});
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

		const { startVoiceServices } = await loadVoiceServices(9);
		await expect(startVoiceServices(5)).resolves.toEqual({
			ready: false,
			errors: ['speech services did not become ready in time']
		});
	});

	it('skipTts:true only starts STT — TTS unit never started and health never probed', async () => {
		const sttServer = createServer((socket) => socket.end());
		const sttPort = await listenOnRandomPort(sttServer);
		mockSystemctl({ 'start:logueos-companion-stt.service': 'ok' });
		// fetch should never be called — if it is, the test will fail because it is not mocked

		try {
			const { startVoiceServices } = await loadVoiceServices(sttPort, 'http://tts.test');
			await expect(startVoiceServices(100, { skipTts: true })).resolves.toEqual({
				ready: true,
				errors: []
			});
			expect(execFileMock).toHaveBeenCalledWith(
				'sudo',
				['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-stt.service'],
				{ timeout: 15000 },
				expect.any(Function)
			);
			expect(execFileMock).not.toHaveBeenCalledWith(
				'sudo',
				['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-tts.service'],
				expect.anything(),
				expect.any(Function)
			);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			await promisify(sttServer.close.bind(sttServer))();
		}
	});

	it('skipTts:true times out when STT port never opens — TTS never touched', async () => {
		mockSystemctl({ 'start:logueos-companion-stt.service': 'ok' });

		const { startVoiceServices } = await loadVoiceServices(9, 'http://tts.test');
		await expect(startVoiceServices(5, { skipTts: true })).resolves.toEqual({
			ready: false,
			errors: ['speech services did not become ready in time']
		});
		expect(execFileMock).not.toHaveBeenCalledWith(
			'sudo',
			['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-tts.service'],
			expect.anything(),
			expect.any(Function)
		);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('remote TTS (Jetson/Kokoro)', () => {
	// When COMPANION_TTS_URL is a non-localhost address, TTS is managed by a
	// remote host (e.g. Kokoro on Jetson). All systemctl TTS ops are skipped;
	// readiness is determined by the health probe instead.

	const REMOTE_URL = 'http://10.10.10.2:18771';

	it('getVoiceServiceStatus: TTS state comes from health probe, not systemctl', async () => {
		mockSystemctl({ 'is-active:logueos-companion-stt.service': 'active' });
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		const { getVoiceServiceStatus } = await loadVoiceServices(9, REMOTE_URL);
		const status = await getVoiceServiceStatus();

		expect(status.tts).toBe('active');
		expect(status.bothReady).toBe(true); // stt active + tts health ok
		expect(execFileMock).not.toHaveBeenCalledWith(
			'sudo',
			['-n', '/usr/bin/systemctl', 'is-active', 'logueos-companion-tts.service'],
			expect.anything(),
			expect.any(Function)
		);
		expect(fetch).toHaveBeenCalledWith(`${REMOTE_URL}/health`, {
			signal: expect.any(AbortSignal)
		});
	});

	it('getVoiceServiceStatus: TTS inactive when health probe fails', async () => {
		mockSystemctl({ 'is-active:logueos-companion-stt.service': 'active' });
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

		const { getVoiceServiceStatus } = await loadVoiceServices(9, REMOTE_URL);
		const status = await getVoiceServiceStatus();

		expect(status.tts).toBe('inactive');
		expect(status.bothReady).toBe(false);
	});

	it('startVoiceServices: skips TTS systemctl start, probes Jetson health for readiness', async () => {
		const sttServer = createServer((socket) => socket.end());
		const sttPort = await listenOnRandomPort(sttServer);
		mockSystemctl({ 'start:logueos-companion-stt.service': 'ok' });
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		try {
			const { startVoiceServices } = await loadVoiceServices(sttPort, REMOTE_URL);
			await expect(startVoiceServices(200)).resolves.toEqual({ ready: true, errors: [] });
			expect(execFileMock).not.toHaveBeenCalledWith(
				'sudo',
				['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-tts.service'],
				expect.anything(),
				expect.any(Function)
			);
			expect(fetch).toHaveBeenCalledWith(`${REMOTE_URL}/health`, {
				signal: expect.any(AbortSignal)
			});
		} finally {
			await promisify(sttServer.close.bind(sttServer))();
		}
	});

	it('startVoiceServices: times out when Jetson health probe fails', async () => {
		mockSystemctl({ 'start:logueos-companion-stt.service': 'ok' });
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

		const { startVoiceServices } = await loadVoiceServices(9, REMOTE_URL);
		await expect(startVoiceServices(5)).resolves.toEqual({
			ready: false,
			errors: ['speech services did not become ready in time']
		});
		expect(execFileMock).not.toHaveBeenCalledWith(
			'sudo',
			['-n', '/usr/bin/systemctl', 'start', 'logueos-companion-tts.service'],
			expect.anything(),
			expect.any(Function)
		);
	});

	it('stopVoiceServices: only stops STT unit, leaves remote TTS alone', async () => {
		mockSystemctl({ 'stop:logueos-companion-stt.service': 'ok' });

		const { stopVoiceServices } = await loadVoiceServices(9, REMOTE_URL);
		await expect(stopVoiceServices()).resolves.toEqual({ stopped: true });
		expect(execFileMock).not.toHaveBeenCalledWith(
			'sudo',
			['-n', '/usr/bin/systemctl', 'stop', 'logueos-companion-tts.service'],
			expect.anything(),
			expect.any(Function)
		);
	});

	it('restartTtsService: returns health probe result without touching systemctl', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

		const { restartTtsService } = await loadVoiceServices(9, REMOTE_URL);
		await expect(restartTtsService(200)).resolves.toBe(true);
		expect(execFileMock).not.toHaveBeenCalled();
		expect(fetch).toHaveBeenCalledWith(`${REMOTE_URL}/health`, {
			signal: expect.any(AbortSignal)
		});
	});

	it('restartTtsService: returns false when remote health probe fails', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

		const { restartTtsService } = await loadVoiceServices(9, REMOTE_URL);
		await expect(restartTtsService(200)).resolves.toBe(false);
		expect(execFileMock).not.toHaveBeenCalled();
	});
});
