<script lang="ts">
	import WorkSurfaceInlinePanel from '$lib/work-surface/WorkSurfaceInlinePanel.svelte';
	import WorkSurfacePill from '$lib/work-surface/WorkSurfacePill.svelte';
	import { createWorkSurfaceView } from '$lib/work-surface/view.svelte';
	import type { WorkSurfaceDockMode } from '$lib/work-surface/types';

	let {
		mode = $bindable<WorkSurfaceDockMode>('badge'),
		openSurfaceId = $bindable<string | null>(null),
		sheetReturnMode = $bindable<WorkSurfaceDockMode>('badge'),
		embedded = false
	}: {
		mode?: WorkSurfaceDockMode;
		openSurfaceId?: string | null;
		sheetReturnMode?: WorkSurfaceDockMode;
		/** When true, parent supplies horizontal padding (simulator mock chrome). */
		embedded?: boolean;
	} = $props();

	const view = createWorkSurfaceView(() => openSurfaceId);

	const isInline = $derived(mode === 'inline');

	function openMostImportant() {
		const target = view.mostImportantId;
		if (target === null) return;
		if (mode === 'inline' && openSurfaceId === target) {
			mode = 'badge';
			openSurfaceId = null;
			return;
		}
		openSurfaceId = target;
		mode = 'inline';
	}

	function collapseInline() {
		mode = 'badge';
		openSurfaceId = null;
	}

	function openFullDetail() {
		const surface = view.currentSurface;
		if (!surface) return;
		openSurfaceId = surface.surfaceId;
		sheetReturnMode = 'inline';
		mode = 'sheet';
	}
</script>

{#if view.hasWork && mode !== 'sheet'}
	<div
		class="work-surface-chat-anchor relative z-10 mb-2 {embedded ? '' : 'px-4'}"
		style="touch-action: manipulation;"
	>
		{#if isInline && view.currentSurface}
			<WorkSurfaceInlinePanel
				surface={view.currentSurface}
				oncollapse={collapseInline}
				onmoreDetail={openFullDetail}
			/>
		{:else if view.showPill}
			<div class="flex justify-end">
				<WorkSurfacePill
					runningCount={view.runningList.length}
					needsYouCount={view.needsYouList.length}
					hasRunning={view.hasRunning}
					hasNeedsYou={view.hasNeedsYou}
					isRecentComplete={view.isRecentComplete}
					pulseDuration={view.pulseDuration}
					ariaLabel={view.pillAriaLabel}
					onclick={openMostImportant}
				/>
			</div>
		{/if}
	</div>
{/if}
