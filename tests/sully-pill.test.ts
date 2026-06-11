// LOS-204 — SullyPill stage-2 primitive.
// SSR-renders the variant matrix + the live-dot contract (default --live dot
// vs custom snippet dot), and source-checks status-surface discipline: tints
// come ONLY from the --*-bg / --*-line pairs, never ad-hoc alphas.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import SullyPill from '$lib/components/sully/SullyPill.svelte';
import SullyNameTag from '$lib/components/SullyNameTag.svelte';

const label = createRawSnippet(() => ({ render: () => '<span>LOS-204</span>' }));

const styleBlock = () => {
	const src = readFileSync('src/lib/components/sully/SullyPill.svelte', 'utf-8');
	return src.slice(src.indexOf('<style'), src.indexOf('</style>'));
};

describe('SullyPill SSR', () => {
	it('defaults to the neutral thread-pill baseline with no dot', () => {
		const { body } = render(SullyPill, { props: { children: label } });
		expect(body).toContain('<span');
		expect(body).toContain('sully-pill');
		expect(body).toContain('data-variant="neutral"');
		expect(body).not.toContain('data-live');
		expect(body).toContain('LOS-204');
	});

	it('renders each status-surface variant class', () => {
		for (const variant of ['live', 'green', 'amber', 'red', 'blue'] as const) {
			const { body } = render(SullyPill, { props: { variant, children: label } });
			expect(body).toContain(`sully-pill--${variant}`);
			expect(body).toContain(`data-variant="${variant}"`);
		}
	});

	it('dot=true renders the default --live dot (accent budget: live only)', () => {
		const { body } = render(SullyPill, { props: { variant: 'live', dot: true, children: label } });
		expect(body).toContain('sully-pill__dot');
		expect(body).toContain('data-live="true"');
	});

	it('a custom dot snippet replaces the default dot', () => {
		const orbDot = createRawSnippet(() => ({
			render: () => '<span data-testid="orb-dot" style="background: var(--orb-grad);"></span>'
		}));
		const { body } = render(SullyPill, { props: { dot: orbDot, children: label } });
		expect(body).toContain('data-testid="orb-dot"');
		expect(body).not.toContain('sully-pill__dot');
	});

	it('passes through a11y roles and call-site classes', () => {
		const { body } = render(SullyPill, {
			props: { children: label, role: 'status', class: 'mb-1.5 text-[11px]' }
		});
		expect(body).toContain('role="status"');
		expect(body).toContain('mb-1.5 text-[11px]');
	});
});

describe('SullyPill token discipline (source-level)', () => {
	it('tints only via --*-bg / --*-line status-surface pairs + work-object baseline', () => {
		const css = styleBlock();
		for (const token of [
			'var(--thread-pill-bg)',
			'var(--thread-pill-border)',
			'var(--live-bg)',
			'var(--live-line)',
			'var(--green-bg)',
			'var(--green-line)',
			'var(--amber-bg)',
			'var(--amber-line)',
			'var(--red-bg)',
			'var(--red-line)',
			'var(--blue-bg)',
			'var(--blue-line)',
			'var(--r-pill)',
			'var(--live)'
		]) {
			expect(css, `style block must consume ${token}`).toContain(token);
		}
		// No ad-hoc alpha tints or raw colors — the audit's hard rule.
		expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(css).not.toContain('rgba(');
		expect(css).not.toMatch(/border-radius:\s*\d/);
	});
});

describe('SullyNameTag leaf-site proof', () => {
	it('mounts SullyPill (live pair) with the orb-gradient identity dot', () => {
		const { body } = render(SullyNameTag, { props: { label: 'Sully' } });
		expect(body).toContain('sully-pill');
		expect(body).toContain('data-variant="live"');
		expect(body).toContain('var(--orb-grad)');
		expect(body).toContain('var(--shadow-accent)');
		expect(body).toContain('>Sully<');
		// Custom dot rides the snippet — the default --live dot must not double up.
		expect(body).not.toContain('sully-pill__dot');
	});

	it('source no longer carries the ad-hoc brand alpha tints', () => {
		const src = readFileSync('src/lib/components/SullyNameTag.svelte', 'utf-8');
		expect(src).toContain("import SullyPill from './sully/SullyPill.svelte'");
		expect(src).not.toContain('bg-brand/[0.08]');
		expect(src).not.toContain('border-brand/30');
	});
});
