<script lang="ts">
	import type { WorkSurfaceTask, PipelineStage } from '$lib/types/workSurface';

	let { task }: { task: WorkSurfaceTask } = $props();

	// The mock CSS uses `var(--color-complete)` for the done tick, which maps to `--color-status-green` in app.css.
	const tickColor = 'var(--color-status-green)';
</script>

<div class="stage-timeline">
	{#each task.stageProgress as step (step.stage)}
		<div
			class="stage-pill
            flex items-center justify-center font-bold uppercase whitespace-nowrap flex-shrink-0
            transition-colors"
			class:done={step.status === 'done'}
			class:active={step.status === 'active'}
			class:pending={step.status === 'pending'}
			class:skipped={step.status === 'skipped'}
		>
			{#if step.status === 'done'}
				<span class="tick">✓</span>
			{/if}
			{step.stage}
		</div>
	{/each}
</div>

<style lang="postcss">
	.stage-timeline {
		display: flex;
		gap: 4px;
		margin-bottom: 1rem; /* 16px */
		overflow: hidden;
		flex-wrap: wrap;
	}

	.stage-pill {
		height: 18px;
		border-radius: 9px;
		padding: 0 8px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		white-space: nowrap;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background-color 0.3s ease,
			opacity 0.3s ease,
			border-color 0.3s ease;
	}

	.stage-pill.done {
		background-color: rgb(255 255 255 / 0.1);
		color: var(--color-muted-foreground);
	}
	.stage-pill.done .tick {
		margin-right: 3px;
		color: var(--color-status-green);
	}

	.stage-pill.active {
		background-color: var(--color-brand);
		color: #fff;
	}

	.stage-pill.pending {
		border: 1px solid rgb(255 255 255 / 0.15);
		color: rgb(255 255 255 / 0.3);
	}

	.stage-pill.skipped {
		border: 1px dashed rgb(255 255 255 / 0.1);
		color: rgb(255 255 255 / 0.2);
		opacity: 0.6;
	}
</style>
