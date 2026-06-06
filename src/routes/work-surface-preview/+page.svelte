<script lang="ts">
	import { workSurfaceSeed, seedKeys } from '$lib/data/workSurfaceSeed';
	import StageTimeline from '$lib/components/StageTimeline.svelte';

	let presetKey = $state(seedKeys[0]);
	const task = $derived(workSurfaceSeed[presetKey]);
</script>

<div
	class="flex min-h-screen flex-col items-center justify-center bg-background p-4 font-sans text-foreground"
>
	<div class="w-full max-w-2xl space-y-6 rounded-lg border border-border bg-card p-6 shadow-xl">
		<h1 class="text-center text-2xl font-bold text-primary">Work Surface Preview</h1>

		<div class="flex flex-wrap justify-center gap-2">
			{#each seedKeys as key (key)}
				<button
					type="button"
					class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
					class:bg-brand={presetKey === key}
					class:text-white={presetKey === key}
					class:bg-surface={presetKey !== key}
					class:text-muted-foreground={presetKey !== key}
					onclick={() => (presetKey = key)}
				>
					{key
						.split('-')
						.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
						.join(' ')}
				</button>
			{/each}
		</div>

		<div class="space-y-2">
			<h2 class="text-xl font-semibold text-white">Task: {task.title}</h2>
			<p class="text-muted-foreground">State: {task.state}</p>
		</div>

		<StageTimeline {task} />
	</div>
</div>

<style>
	/* Any specific styles for this preview page can go here if needed */
</style>
