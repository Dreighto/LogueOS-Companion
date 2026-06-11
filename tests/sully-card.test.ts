// LOS-204 — SullyCard stage-2 primitive.
// SSR-renders base/raised/enter states and source-checks the full-width panel
// rule: NO .sully-smooth (no property transitions on large surfaces) — the
// only entrance is the compositor-only .sully-panel-enter keyframe.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import SullyCard from '$lib/components/sully/SullyCard.svelte';
import ProofCard from '$lib/components/ProofCard.svelte';
import type { WorkSurfaceTask } from '$lib/types/workSurface';

const content = createRawSnippet(() => ({ render: () => '<p>Card body</p>' }));

const styleBlock = () => {
	const src = readFileSync('src/lib/components/sully/SullyCard.svelte', 'utf-8');
	return src.slice(src.indexOf('<style'), src.indexOf('</style>'));
};

describe('SullyCard SSR', () => {
	it('defaults to the surface-card shell, not raised, no enter animation', () => {
		const { body } = render(SullyCard, { props: { children: content } });
		expect(body).toContain('sully-card');
		expect(body).not.toContain('sully-card--raised');
		expect(body).not.toContain('data-raised');
		expect(body).not.toContain('sully-panel-enter');
		expect(body).toContain('Card body');
	});

	it('raised variant steps up to surface-raised + shadow-float', () => {
		const { body } = render(SullyCard, { props: { raised: true, children: content } });
		expect(body).toContain('sully-card--raised');
		expect(body).toContain('data-raised="true"');
	});

	it('enter opts into the global .sully-panel-enter pattern', () => {
		const { body } = render(SullyCard, { props: { enter: true, children: content } });
		expect(body).toContain('sully-panel-enter');
	});

	it('passes through a11y roles and call-site layout classes', () => {
		const { body } = render(SullyCard, {
			props: {
				children: content,
				role: 'region',
				'aria-label': 'Proof',
				class: 'p-3 md:col-span-2'
			}
		});
		expect(body).toContain('role="region"');
		expect(body).toContain('aria-label="Proof"');
		expect(body).toContain('p-3 md:col-span-2');
	});
});

describe('SullyCard token + panel-motion discipline (source-level)', () => {
	it('consumes only the locked surface/elevation tokens', () => {
		const css = styleBlock();
		for (const token of [
			'var(--surface-card)',
			'var(--line)',
			'var(--r-lg)',
			'var(--shadow-card)',
			'var(--surface-raised)',
			'var(--shadow-float)'
		]) {
			expect(css, `style block must consume ${token}`).toContain(token);
		}
		expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(css).not.toContain('rgba(');
	});

	it('full-width panel rule: no .sully-smooth, no transitions in the card', () => {
		const src = readFileSync('src/lib/components/sully/SullyCard.svelte', 'utf-8');
		expect(src).not.toContain('class="sully-card sully-smooth');
		expect(src).not.toContain('class:sully-smooth');
		expect(styleBlock()).not.toContain('transition');
	});
});

describe('ProofCard leaf-site proof', () => {
	const task = {
		proof: {
			verdict: 'go',
			score: 96,
			evidenceRef: 'abc1234',
			checks: [
				{ name: 'build', status: 'pass' },
				{ name: 'vitest', status: 'pending', detail: 'running' }
			]
		}
	} as unknown as WorkSurfaceTask;

	it('renders the proof inside a SullyCard shell', () => {
		const { body } = render(ProofCard, { props: { task } });
		expect(body).toContain('sully-card');
		expect(body).toContain('data-testid="proof-card"');
		expect(body).toContain('md:col-span-2');
		expect(body).toContain('go');
		expect(body).toContain('Score: 96%');
		expect(body).toContain('Evidence ref: abc1234');
		expect(body).toContain('build');
	});

	it('renders nothing when the task has no proof', () => {
		const { body } = render(ProofCard, {
			props: { task: { proof: null } as unknown as WorkSurfaceTask }
		});
		expect(body).not.toContain('sully-card');
	});

	it('source drops the old dashed ad-hoc shell for the SullyCard primitive', () => {
		const src = readFileSync('src/lib/components/ProofCard.svelte', 'utf-8');
		expect(src).toContain("import SullyCard from './sully/SullyCard.svelte'");
		expect(src).toContain('<SullyCard');
		expect(src).not.toContain('border-dashed');
	});
});
