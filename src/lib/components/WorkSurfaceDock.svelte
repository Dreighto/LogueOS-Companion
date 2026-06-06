<script lang="ts">
	import WorkSurfaceCard from './WorkSurfaceCard.svelte';
	import { running, needsYou, done } from '$lib/data/surfaces.svelte';
	import type { Surface } from '$lib/types/workSurface';

	// Props to control initial mode from parent (e.g., preview route)
	export let initialMode: 'badge' | 'rail' | 'sheet' = 'badge';
	export let initialOpenSurfaceId: string | null = null;

	// Internal state for the dock's current display mode and open surface
	let mode = $state<'badge' | 'rail' | 'sheet'>(initialMode);
	let openSurfaceId = $state<string | null>(initialOpenSurfaceId);

	// Re-read the module getters reactively (they were exported as functions
	// because Svelte 5 forbids exporting $derived from a module).
	const runningList = $derived(running());
	const needsYouList = $derived(needsYou());
	const doneList = $derived(done());

	// Badge/Rail toggle
	function toggleDockState() {
		if (mode === 'badge') {
			mode = 'rail';
		} else if (mode === 'rail') {
			mode = 'badge';
			openSurfaceId = null; // Close any open card when collapsing to badge
		}
	}

	// Rail/Sheet transitions
	function openSurfaceSheet(id: string) {
		openSurfaceId = id;
		mode = 'sheet';
	}

	function closeSurfaceSheet() {
		openSurfaceId = null;
		mode = 'rail';
	}

	// Helper for status dot color
	function getStatusDotColor(status: Surface['status']): string {
		switch (status) {
			case 'running':
				return 'bg-[--color-st-run]';
			case 'needs-you':
				return 'bg-[--color-st-needs]';
			case 'done':
				return 'bg-[--color-st-done]';
			case 'failed':
				return 'bg-[--color-st-fail]';
			case 'idle':
				return 'bg-[--color-st-done]'; // Default neutral for idle, though not a dock status
			default:
				return 'bg-[--color-st-done]';
		}
	}
</script>

<!-- Badge Mode -->
{#if mode === 'badge'}
<div class="fixed bottom-safe right-safe z-50 p-4">
	<button
		class="h-9 w-max px-3 py-1 flex items-center gap-2 rounded-full bg-card/80 text-foreground backdrop-blur-sm shadow-lg text-sm font-semibold active-trigger"
		onclick={toggleDockState}
		aria-label="Open Work Surface Dock"
	>
		<span class="h-2 w-2 rounded-full bg-[--color-st-run]"></span>
		<span>▶ {runningList.length}</span>
		{#if needsYouList.length > 0}
		<span class="h-2 w-2 rounded-full bg-[--color-st-needs]"></span>
		<span>⏸ {needsYouList.length}</span>
		{/if}
	</button>
</div>
{/if}

<!-- Rail Mode -->
{#if mode === 'rail'}
<div
	class="fixed top-0 bottom-0 right-0 z-50
		flex w-full flex-col bg-card/80
		p-2 text-foreground
		backdrop-blur-sm
		transition-all duration-300
		ease-in-out md:w-80 lg:w-96
	"
>
	<button
		class="
			absolute top-1/2 -left-12 flex
			h-16 w-12
			-translate-y-1/2
			flex-col items-center
			justify-center rounded-l-lg bg-card/80 text-center text-sm
			font-bold text-foreground backdrop-blur-sm active-trigger
		"
		onclick={toggleDockState}
		aria-label="Collapse Work Surface Dock"
	>
		<span class="text-lg">›</span>
	</button>

	<div class="flex-none border-b border-border pb-2 px-4 pt-4">
		<h2 class="text-lg font-semibold">Work Surface Dock</h2>
		<div class="mt-1 flex gap-4 text-sm">
			<div class="flex items-center gap-1">
				<span class="h-2 w-2 rounded-full bg-[--color-st-run]"></span>
				<span>Running {runningList.length}</span>
			</div>
			<div class="flex items-center gap-1">
				<span class="h-2 w-2 rounded-full bg-[--color-st-needs]"></span>
				<span>Needs You {needsYouList.length}</span>
			</div>
			<div class="flex items-center gap-1">
				<span class="h-2 w-2 rounded-full bg-[--color-st-done]"></span>
				<span>Done {doneList.length}</span>
			</div>
		</div>
	</div>

	<div class="-mr-2 flex-auto overflow-y-auto pr-2 px-4">
		<!-- Running Tasks -->
		{#if runningList.length > 0}
			<h3 class="mt-4 mb-2 text-sm font-semibold text-[--color-st-run]">Running</h3>
			{#each runningList as surface (surface.surfaceId)}
				<div
					class="mb-2 cursor-pointer rounded-lg border border-border bg-surface/50 p-2 active-trigger"
					role="button"
					tabindex={0}
					onclick={() => openSurfaceSheet(surface.surfaceId)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openSurfaceSheet(surface.surfaceId);
						}
					}}
				>
					<div class="flex items-center gap-2 text-sm font-medium whitespace-nowrap overflow-hidden">
						<span class="h-2 w-2 rounded-full {getStatusDotColor(surface.status)} flex-none"></span>
						<span class="flex-none font-mono text-xs text-[--color-brand]">
							{surface.task.workers[0]?.shortCode || 'SYS'}
						</span>
						<span class="flex-grow truncate">{surface.title}</span>
						<span class="flex-none text-xs text-muted-foreground ml-auto">
							{surface.task.stage}
						</span>
					</div>
				</div>
			{/each}
		{/if}

		<!-- Needs You Tasks -->
		{#if needsYouList.length > 0}
			<h3 class="mt-4 mb-2 text-sm font-semibold text-[--color-st-needs]">Needs You</h3>
			{#each needsYouList as surface (surface.surfaceId)}
				<div
					class="mb-2 cursor-pointer rounded-lg border border-border bg-surface/50 p-2 active-trigger"
					role="button"
					tabindex={0}
					onclick={() => openSurfaceSheet(surface.surfaceId)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openSurfaceSheet(surface.surfaceId);
						}
					}}
				>
					<div class="flex items-center gap-2 text-sm font-medium whitespace-nowrap overflow-hidden">
						<span class="h-2 w-2 rounded-full {getStatusDotColor(surface.status)} flex-none"></span>
						<span class="flex-none font-mono text-xs text-[--color-brand]">
							{surface.task.workers[0]?.shortCode || 'SYS'}
						</span>
						<span class="flex-grow truncate">{surface.title}</span>
						<span class="flex-none text-xs text-muted-foreground ml-auto">
							{surface.needs?.prompt || 'Action required'}
						</span>
					</div>
				</div>
			{/each}
		{/if}

		<!-- Done Tasks -->
		{#if doneList.length > 0}
			<h3 class="mt-4 mb-2 text-sm font-semibold text-[--color-st-done]">Done</h3>
			{#each doneList as surface (surface.surfaceId)}
				<div
					class="mb-2 cursor-pointer rounded-lg border border-border bg-surface/50 p-2 active-trigger"
					role="button"
					tabindex={0}
					onclick={() => openSurfaceSheet(surface.surfaceId)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openSurfaceSheet(surface.surfaceId);
						}
					}}
				>
					<div class="flex items-center gap-2 text-sm font-medium whitespace-nowrap overflow-hidden">
						<span class="h-2 w-2 rounded-full {getStatusDotColor(surface.status)} flex-none"></span>
						<span class="flex-none font-mono text-xs text-[--color-brand]">
							{surface.task.workers[0]?.shortCode || 'SYS'}
						</span>
						<span class="flex-grow truncate">{surface.title}</span>
						<span class="flex-none text-xs text-muted-foreground ml-auto">
							{new Date(surface.updatedAt).toLocaleTimeString()}
						</span>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
{/if}

<!-- Sheet Mode -->
{#if mode === 'sheet'}
	{@const currentSurface = [...runningList, ...needsYouList, ...doneList].find(s => s.surfaceId === openSurfaceId)}
<div class="fixed inset-0 z-50 bg-background/80 flex items-center justify-center backdrop-blur-sm">
	<!-- Tap-out overlay for desktop sheet -->
	<div
		class="absolute inset-0 z-0 hidden md:block"
		role="button"
		tabindex={0}
		onclick={closeSurfaceSheet}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				closeSurfaceSheet();
			}
		}}
		aria-label="Close Work Surface Sheet"
	></div>
	<div
		class="relative h-full w-full overflow-y-auto bg-card p-4
			md:max-w-2xl md:rounded-lg md:shadow-xl md:h-[90vh]
		"
		role="dialog"
		aria-modal="true"
	>
		<button
			class="absolute top-4 right-4 z-10 p-2 rounded-full bg-card/80 text-foreground active-trigger"
			onclick={closeSurfaceSheet}
			aria-label="Back to Work Surface Dock"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
		</button>
		{#if currentSurface}
			<WorkSurfaceCard footprint="expanded" task={currentSurface.task} />
		{:else}
			<p>Surface not found or no surface selected.</p>
		{/if}
	</div>
</div>
{/if}
