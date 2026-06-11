import { describe, expect, it, vi } from 'vitest';

// The health payload's identity fields come from $lib/server/config, which
// reads LOGUEOS_APP_MODE at module load and falls back to 'wired' (Console
// identity) when unset — true in CI, where no .env exists. Pin the mode
// BEFORE the route (and config) is imported, or this test asserts Companion
// identity against a Console payload and fails CI while passing locally.
vi.stubEnv('LOGUEOS_APP_MODE', 'companion');
const { GET } = await import('../src/routes/api/health/+server');

describe('/api/health', () => {
	it('returns a stable health payload for the Companion app', async () => {
		const response = await GET({} as never);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			app: 'LogueOS Companion',
			base_path: '/companion',
			route: '/companion/api/health'
		});
	});
});
