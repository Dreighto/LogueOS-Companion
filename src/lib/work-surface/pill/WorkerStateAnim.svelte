<!--
  WorkerStateAnim.svelte — working-state Lottie host for the worker pill
  (icon-wiring pass; operator-approved set under static/anim/).

  Props are PRIMITIVES (file/loop) on purpose: the pill derives them from the
  dispatch stream, and primitive deps keep this $effect from tearing the
  player down on every SSE row when only array/object identities churn.

  Ash discipline + truth guards live UPSTREAM in pillAnimFor (no animation
  unless the run is trusted-live); this component only renders what it is
  handed. prefers-reduced-motion renders nothing — the pill's tint and stage
  dots already carry the state. Player loads lazily (lottie_light, svg
  renderer) and pauses offscreen via IntersectionObserver.
-->
<script lang="ts">
	import { base } from '$app/paths';

	let {
		file,
		loop = true,
		size = 18
	}: {
		file: string | null;
		loop?: boolean;
		size?: number;
	} = $props();

	let el: HTMLSpanElement | undefined = $state();
	let reduced = $state(false);

	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (reduced = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	$effect(() => {
		const target = el;
		const f = file;
		const l = loop;
		if (!target || !f || reduced) return;
		let inst: { destroy(): void; play(): void; pause(): void } | null = null;
		let io: IntersectionObserver | null = null;
		let cancelled = false;
		import('lottie-web/build/player/lottie_light').then((m) => {
			if (cancelled || !target.isConnected) return;
			inst = m.default.loadAnimation({
				container: target,
				renderer: 'svg',
				loop: l,
				autoplay: true,
				path: `${base}/anim/${f}`
			});
			io = new IntersectionObserver(([entry]) => {
				if (!inst) return;
				if (entry.isIntersecting) inst.play();
				else inst.pause();
			});
			io.observe(target);
		});
		return () => {
			cancelled = true;
			io?.disconnect();
			inst?.destroy();
			inst = null;
			target.replaceChildren();
		};
	});
</script>

{#if file && !reduced}
	<span
		bind:this={el}
		class="wanim"
		style="width:{size}px;height:{size}px"
		aria-hidden="true"
		data-testid="worker-state-anim"
		data-anim={file}
	></span>
{/if}

<style>
	.wanim {
		flex: none;
		display: inline-block;
	}
	.wanim :global(svg) {
		display: block;
	}
</style>
