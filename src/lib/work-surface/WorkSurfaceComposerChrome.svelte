<script lang="ts">
	import WorkSurfaceChatAnchor from '$lib/work-surface/WorkSurfaceChatAnchor.svelte';
	import WorkSurfaceDock from '$lib/work-surface/WorkSurfaceDock.svelte';
	import type { WorkSurfaceDockMode } from '$lib/work-surface/types';
	import type { Snippet } from 'svelte';

	let {
		mode = $bindable<WorkSurfaceDockMode>('badge'),
		openSurfaceId = $bindable<string | null>(null),
		sheetReturnMode = $bindable<WorkSurfaceDockMode>('badge'),
		embedded = false,
		elevated = true,
		composer
	}: {
		mode?: WorkSurfaceDockMode;
		openSurfaceId?: string | null;
		sheetReturnMode?: WorkSurfaceDockMode;
		embedded?: boolean;
		/** When true, stack above PWA update toast and other bottom overlays. */
		elevated?: boolean;
		/** Optional composer slot — pass `<Composer />` from chat for one mount point. */
		composer?: Snippet;
	} = $props();
</script>

<div class="{elevated ? 'relative z-[120]' : 'relative'} shrink-0">
	<WorkSurfaceChatAnchor
		{embedded}
		bind:mode
		bind:openSurfaceId
		bind:sheetReturnMode
	/>
	<WorkSurfaceDock bind:mode bind:openSurfaceId bind:sheetReturnMode />
	{#if composer}
		{@render composer()}
	{/if}
</div>
