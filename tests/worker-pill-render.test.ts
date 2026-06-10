// LOS-192 — dispatched-run fixture renders the collapsed WorkerPill.
// SSR-renders the component with a mid-run fixture (the same rows/status
// shape the dispatch stream delivers) and asserts the four pill regions
// (worker / task / stage dots / elapsed) are present, the truth guards hold
// in markup, and none of the legacy card hooks (hybrid-pill, status-dot,
// dispatch card chrome) appear.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import WorkerPill from '$lib/work-surface/pill/WorkerPill.svelte';

const liveRun = {
	traceId: 'sully-fixture-1',
	rows: [
		{ seq: 1, action: 'reading', target: 'src/app.css' },
		{ seq: 2, action: 'edited', target: 'src/app.css' }
	],
	status: 'working',
	worker: 'claude-code',
	brief: 'Audit the docs folder',
	startedAtIso: new Date(Date.now() - 95_000).toISOString(),
	durationLabel: null
};

describe('WorkerPill SSR (dispatched-run fixture)', () => {
	it('renders worker · task · stage dots · elapsed for a live run', () => {
		const { body } = render(WorkerPill, { props: liveRun });
		expect(body).toContain('data-testid="worker-pill"');
		expect(body).toContain('data-aggr="running"');
		expect(body).toContain('data-testid="worker-pill-worker"');
		expect(body).toContain('>CC<'); // worker chip… (whitespace-tolerant below)
		expect(body).toContain('data-testid="worker-pill-task"');
		expect(body).toContain('Audit the docs folder');
		// Six stage dots, Read done / Research skipped / Build active.
		expect(body.match(/data-testid="worker-pill-stage-dot"/g)).toHaveLength(6);
		expect(body).toContain('data-stage="read" data-status="done"');
		expect(body).toContain('data-stage="research" data-status="skipped"');
		expect(body).toContain('data-stage="build" data-status="active"');
		// Elapsed renders mono-tabular from started_at.
		expect(body).toContain('data-testid="worker-pill-elapsed"');
		expect(body).toMatch(/1m3[0-9]s/);
	});

	it('no fake done while running: live run shows no terminal glyph or done aggr', () => {
		const { body } = render(WorkerPill, { props: liveRun });
		expect(body).not.toContain('data-aggr="done"');
		expect(body).not.toContain('✓');
	});

	it('done run dims but persists, with frozen duration', () => {
		const { body } = render(WorkerPill, {
			props: { ...liveRun, status: 'synthesized', durationLabel: '4 min' }
		});
		expect(body).toContain('data-aggr="done"');
		expect(body).toContain('wpill--done');
		expect(body).toContain('4 min');
	});

	it('stopped run reads neutral — not failed', () => {
		const { body } = render(WorkerPill, { props: { ...liveRun, status: 'aborted' } });
		expect(body).toContain('data-aggr="stopped"');
		expect(body).not.toContain('data-aggr="failed"');
		expect(body).not.toContain('data-status="failed"');
	});

	it('renders zero legacy-card chrome', () => {
		const { body } = render(WorkerPill, { props: liveRun });
		for (const legacyHook of ['hybrid-pill', 'status-dot', 'surface-stale', 'dispatch-card']) {
			expect(body).not.toContain(`data-testid="${legacyHook}"`);
		}
	});

	// LOS-196 truth guards: stale state + reconcile-before-trust.
	it('unreconciled run renders "checking…" instead of a live clock', () => {
		const { body } = render(WorkerPill, { props: { ...liveRun, reconciled: false } });
		expect(body).toContain('data-trust="unverified"');
		expect(body).toContain('data-testid="worker-pill-stale"');
		expect(body).toContain('checking…');
		expect(body).not.toContain('data-testid="worker-pill-elapsed"');
		expect(body).toContain('wpill--checking');
	});

	it('past the max-elapsed cap the pill renders the explicit stale state', () => {
		const { body } = render(WorkerPill, {
			props: {
				...liveRun,
				reconciled: true,
				startedAtIso: new Date(Date.now() - 87 * 60 * 1000).toISOString() // the 1h27m case
			}
		});
		expect(body).toContain('data-trust="stale"');
		expect(body).toContain('stale — checking…');
		expect(body).not.toContain('data-testid="worker-pill-elapsed"');
		// Still truthfully non-terminal — stale must not fake done OR failed.
		expect(body).toContain('data-aggr="running"');
	});

	it('terminal runs stay trusted even before any reconcile', () => {
		const { body } = render(WorkerPill, {
			props: { ...liveRun, status: 'failed', reconciled: false, durationLabel: '2h' }
		});
		expect(body).toContain('data-trust="trusted"');
		expect(body).not.toContain('data-testid="worker-pill-stale"');
		expect(body).toContain('data-aggr="failed"');
	});

	it('a reconciled under-cap run keeps the live clock (no behavior change)', () => {
		const { body } = render(WorkerPill, { props: { ...liveRun, reconciled: true } });
		expect(body).toContain('data-trust="trusted"');
		expect(body).toContain('data-testid="worker-pill-elapsed"');
		expect(body).not.toContain('data-testid="worker-pill-stale"');
	});

	it('falls back to trace sniffing + placeholder title before the job row arrives', () => {
		const { body } = render(WorkerPill, {
			props: {
				traceId: 'sully-agy-7',
				rows: [],
				status: 'working',
				worker: null,
				brief: null,
				startedAtIso: null,
				durationLabel: null
			}
		});
		expect(body).toContain('AGY');
		expect(body).toContain('Working on it');
		// Implicit Read-active frontier with zero rows.
		expect(body).toContain('data-stage="read" data-status="active"');
	});
});

describe('feed mount wiring (source-level)', () => {
	it('MessageFeed mounts WorkerPill and none of the legacy surfaces', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/lib/components/MessageFeed.svelte', 'utf-8');
		expect(src).toContain("import WorkerPill from '$lib/work-surface/pill/WorkerPill.svelte'");
		expect(src).toContain('<WorkerPill');
		for (const legacy of ['<HybridSurfaceMount', '<DispatchCard', '<WorkingBubble']) {
			expect(src).not.toContain(legacy);
		}
	});

	it('MessageFeed wires the LOS-196 truth guards into the pill', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/lib/components/MessageFeed.svelte', 'utf-8');
		expect(src).toContain('reconciled={ctrl.reconciled}');
		expect(src).toContain('onstalereconcile');
		expect(src).toContain('ctrl.reconcile()');
	});

	it('chat page no longer mounts the legacy composer chrome', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync('src/routes/chat/+page.svelte', 'utf-8');
		expect(src).not.toContain('<WorkSurfaceComposerChrome');
	});

	it('quarantined module stays on disk (build-then-delete discipline)', async () => {
		const fs = await import('node:fs');
		for (const kept of [
			'src/lib/work-surface/hybrid/HybridSurfaceMount.svelte',
			'src/lib/work-surface/hybrid/HybridDispatchCard.svelte',
			'src/lib/work-surface/WorkSurfaceInlinePanel.svelte',
			'src/lib/work-surface/WorkSurfaceComposerChrome.svelte',
			'src/lib/components/WorkingBubble.svelte'
		]) {
			expect(fs.existsSync(kept), `${kept} must remain on disk`).toBe(true);
		}
	});
});
