<script lang="ts">
	import type { PipelineStage } from '$lib/types/workSurface';
	import {
		BookOpen,
		Search,
		Hammer,
		ClipboardCheck,
		ShieldCheck,
		MessageCircle,
		type Icon
	} from 'lucide-svelte';

	let {
		stage,
		pulse = false,
		size = 13
	}: {
		stage: PipelineStage;
		pulse?: boolean;
		size?: number;
	} = $props();

	const STAGE_ICONS: Record<PipelineStage, typeof Icon> = {
		Read: BookOpen,
		Research: Search,
		Build: Hammer,
		Check: ClipboardCheck,
		Approve: ShieldCheck,
		Reply: MessageCircle
	};

	const IconCmp = $derived(STAGE_ICONS[stage]);
</script>

<span class="stage-act-icon" class:stage-act-icon--pulse={pulse} aria-hidden="true">
	{#if IconCmp}
		<IconCmp {size} strokeWidth={2} />
	{/if}
</span>

<style lang="postcss">
	/* Locked tokens (icon-wiring pass): quiet --t2 chrome at rest; the pulse is
	   a LIVE moment, so it brightens to --t1 with the indigo glow per the
	   operator's 2026-06-11 running-is-indigo ruling. */
	.stage-act-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: var(--r-xs);
		border: 1px solid var(--line2);
		background: var(--line);
		color: var(--t2);
		box-shadow: inset 0 1px 0 var(--line);
		transition:
			transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
			box-shadow 0.28s ease,
			border-color 0.28s ease,
			color 0.28s ease;
	}

	.stage-act-icon--pulse {
		animation: stage-act-pop 0.85s cubic-bezier(0.22, 1, 0.36, 1);
		border-color: var(--live-line);
		color: var(--t1);
		box-shadow:
			inset 0 1px 0 var(--line2),
			0 0 16px var(--accent-glow);
	}

	@keyframes stage-act-pop {
		0% {
			transform: scale(0.82);
			opacity: 0.55;
		}
		45% {
			transform: scale(1.08);
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}
</style>
