import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadRunMode(env: Record<string, string>) {
	vi.resetModules();
	for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
	vi.doMock('$env/dynamic/private', () => ({ env }));
	const { runMode } = await import('$lib/server/config');
	return runMode;
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.doUnmock('$env/dynamic/private');
});

describe('companionDispatchEnabled', () => {
	it('is OFF by default in companion mode (flag unset)', async () => {
		const rm = await loadRunMode({ LOGUEOS_APP_MODE: 'companion' });
		expect(rm.companionDispatchEnabled).toBe(false);
	});

	it('is ON in companion mode when COMPANION_DISPATCH_ENABLED=true', async () => {
		const rm = await loadRunMode({
			LOGUEOS_APP_MODE: 'companion',
			COMPANION_DISPATCH_ENABLED: 'true'
		});
		expect(rm.companionDispatchEnabled).toBe(true);
	});

	it('stays OFF in wired mode even with the flag set (companion-only feature)', async () => {
		const rm = await loadRunMode({
			LOGUEOS_APP_MODE: 'wired',
			COMPANION_DISPATCH_ENABLED: 'true'
		});
		expect(rm.companionDispatchEnabled).toBe(false);
	});

	it('is NOT aliased to the kernel _wired gate', async () => {
		const rm = await loadRunMode({
			LOGUEOS_APP_MODE: 'companion',
			COMPANION_DISPATCH_ENABLED: 'true'
		});
		// kernel dispatch (gateway) must remain OFF in companion mode
		expect(rm.dispatchEnabled).toBe(false);
		expect(rm.kernelWired).toBe(false);
		expect(rm.companionDispatchEnabled).toBe(true);
	});
});
