import { describe, expect, it } from 'vitest';

import { GET } from '../src/routes/api/health/+server';

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
