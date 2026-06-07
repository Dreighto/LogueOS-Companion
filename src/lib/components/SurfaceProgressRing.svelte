<script lang="ts">
	let {
		percent = 0,
		stage = '',
		state = 'Working'
	}: {
		percent: number;
		stage: string;
		state: 'Working' | 'Waiting' | 'Complete' | 'Failed';
	} = $props();

	const r = 60;
	const cx = 70;
	const cy = 70;
	const circumference = $derived(2 * Math.PI * r);
	const strokeDasharray = $derived.by(() => {
		const p = Math.min(100, Math.max(0, percent)) / 100;
		const activeLength = p * circumference;
		const remainingLength = circumference - activeLength;
		return `${activeLength} ${remainingLength}`;
	});

	const strokeColor = $derived.by(() => {
		switch (state) {
			case 'Working':
				return 'var(--color-st-run)';
			case 'Waiting':
				return 'var(--color-st-needs)';
			case 'Complete':
				return 'var(--color-st-done)';
			case 'Failed':
				return 'var(--color-st-fail)';
			default:
				return 'var(--color-st-run)';
		}
	});
</script>

<div class="relative mx-auto flex h-[140px] w-[140px] items-center justify-center">
	<svg
		width="140"
		height="140"
		viewBox="0 0 140 140"
		class="select-none"
		role="img"
		aria-label={`${Math.round(percent)}% complete${stage ? ' · ' + stage : ''}`}
	>
		<!-- Background ring -->
		<circle
			{cx}
			{cy}
			{r}
			fill="none"
			stroke="var(--color-edge, rgba(255, 255, 255, 0.15))"
			stroke-width="1"
		/>
		<!-- Foreground arc -->
		<circle
			{cx}
			{cy}
			{r}
			fill="none"
			stroke={strokeColor}
			stroke-width="4"
			stroke-linecap="round"
			transform="rotate(-90 70 70)"
			stroke-dasharray={strokeDasharray}
			class="ring-foreground-arc"
		/>
	</svg>
	<!-- Center label -->
	<div class="absolute flex flex-col items-center justify-center text-center">
		<span class="text-2xl font-semibold tracking-tight text-white">{Math.round(percent)}%</span>
		{#if stage}
			<span class="mt-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase"
				>{stage}</span
			>
		{/if}
	</div>
</div>

<style>
	.ring-foreground-arc {
		transition: stroke-dasharray 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
</style>
