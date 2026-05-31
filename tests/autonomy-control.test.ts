import { describe, expect, it } from 'vitest';
import { normalizeAutonomy, AUTONOMY_DEFAULT } from '$lib/chat/autonomy';

describe('normalizeAutonomy', () => {
	it('defaults to Ask for unknown/empty values', () => {
		expect(normalizeAutonomy(null)).toBe('ask');
		expect(normalizeAutonomy('garbage')).toBe('ask');
		expect(AUTONOMY_DEFAULT).toBe('ask');
	});
	it('accepts the three valid modes', () => {
		expect(normalizeAutonomy('ask')).toBe('ask');
		expect(normalizeAutonomy('auto-safe')).toBe('auto-safe');
		expect(normalizeAutonomy('full-auto')).toBe('full-auto');
	});
});
