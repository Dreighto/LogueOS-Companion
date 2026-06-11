// LOS-204 — SullyButton stage-2 primitive.
// SSR-renders the component (variant/size class matrix, a11y pass-through)
// and source-checks that the style block consumes locked Sully tokens only —
// no ad-hoc hex/rgba colors, no raw radii or durations.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import SullyButton from '$lib/components/sully/SullyButton.svelte';

const label = createRawSnippet(() => ({ render: () => '<span>Send it</span>' }));

const styleBlock = () => {
	const src = readFileSync('src/lib/components/sully/SullyButton.svelte', 'utf-8');
	return src.slice(src.indexOf('<style'), src.indexOf('</style>'));
};

describe('SullyButton SSR', () => {
	it('defaults to a primary md native button with .sully-smooth', () => {
		const { body } = render(SullyButton, { props: { children: label } });
		expect(body).toContain('<button');
		expect(body).toContain('type="button"');
		expect(body).toContain('sully-btn');
		expect(body).toContain('sully-btn--primary');
		expect(body).toContain('sully-btn--md');
		expect(body).toContain('sully-smooth');
		expect(body).toContain('data-variant="primary"');
		expect(body).toContain('data-size="md"');
		expect(body).toContain('Send it');
	});

	it('renders the quiet and destructive variant classes', () => {
		const quiet = render(SullyButton, { props: { variant: 'quiet', children: label } }).body;
		expect(quiet).toContain('sully-btn--quiet');
		expect(quiet).toContain('data-variant="quiet"');
		expect(quiet).not.toContain('sully-btn--primary');

		const destructive = render(SullyButton, {
			props: { variant: 'destructive', children: label }
		}).body;
		expect(destructive).toContain('sully-btn--destructive');
		expect(destructive).toContain('data-variant="destructive"');
	});

	it('renders the sm size class', () => {
		const { body } = render(SullyButton, { props: { size: 'sm', children: label } });
		expect(body).toContain('sully-btn--sm');
		expect(body).toContain('data-size="sm"');
		expect(body).not.toContain('sully-btn--md');
	});

	it('passes through a11y and native button attributes', () => {
		const { body } = render(SullyButton, {
			props: {
				children: label,
				disabled: true,
				'aria-label': 'Toggle Sessions Sidebar',
				title: 'Toggle Sessions Sidebar'
			}
		});
		expect(body).toContain('disabled');
		expect(body).toContain('aria-label="Toggle Sessions Sidebar"');
		expect(body).toContain('title="Toggle Sessions Sidebar"');
	});

	it('merges call-site classes after the primitive classes', () => {
		const { body } = render(SullyButton, {
			props: { children: label, class: 'h-11 w-11 lg:hidden' }
		});
		expect(body).toContain('h-11 w-11 lg:hidden');
	});
});

describe('SullyButton token discipline (source-level)', () => {
	it('consumes only locked tokens for color/radius/motion', () => {
		const css = styleBlock();
		for (const token of [
			'var(--grad)',
			'var(--on-accent)',
			'var(--ui)',
			'var(--line)',
			'var(--red-bg)',
			'var(--red-line)',
			'var(--red)',
			'var(--focus)',
			'var(--r-sm)',
			'var(--r-md)',
			'var(--dur-instant)',
			'var(--font-body)',
			'var(--weight-semibold)'
		]) {
			expect(css, `style block must consume ${token}`).toContain(token);
		}
		// No ad-hoc colors, radii, shadows, or durations.
		expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(css).not.toContain('rgba(');
		expect(css).not.toMatch(/border-radius:\s*\d/);
		expect(css).not.toMatch(/\d+ms/);
	});

	it('press acknowledgment is transform-only (compositor-safe)', () => {
		const css = styleBlock();
		const active = css.slice(css.indexOf(':active'));
		const activeRule = active.slice(0, active.indexOf('}'));
		expect(activeRule).toContain('transform: scale(');
		expect(activeRule).toContain('var(--dur-instant)');
		expect(activeRule).not.toContain('width');
		expect(activeRule).not.toContain('height');
		expect(activeRule).not.toContain('margin');
	});
});

describe('ChatHeader leaf-site proof (source-level)', () => {
	it('mounts SullyButton for the sidebar toggle', () => {
		const src = readFileSync('src/lib/components/ChatHeader.svelte', 'utf-8');
		expect(src).toContain("import SullyButton from './sully/SullyButton.svelte'");
		expect(src).toContain('<SullyButton');
		expect(src).toContain('--sully-btn-r: var(--r-pill)');
	});
});
