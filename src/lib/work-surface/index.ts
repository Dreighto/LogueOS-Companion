// Work surface — drop-in module for chat composer integration.
//
// Quick start (real chat):
//   import { WorkSurfaceComposerChrome, createWorkSurfaceDock } from '$lib/work-surface';
//
// Store + scripting (simulator, tests):
//   import { spawnSurface, surfaceStore, createWorkSurfaceView } from '$lib/work-surface';

export {
	surfaceStore,
	spawnSurface,
	attachToSurface,
	setStatus,
	removeSurface
} from '$lib/work-surface/surfaces.svelte';

export { createWorkSurfaceView } from '$lib/work-surface/view.svelte';
export { createWorkSurfaceDock, type WorkSurfaceDockState } from '$lib/work-surface/dock.svelte';
export type { WorkSurfaceDockMode } from '$lib/work-surface/types';

export { default as WorkSurfacePill } from '$lib/work-surface/WorkSurfacePill.svelte';
export { default as WorkSurfaceInlinePanel } from '$lib/work-surface/WorkSurfaceInlinePanel.svelte';
export { default as WorkSurfaceChatAnchor } from '$lib/work-surface/WorkSurfaceChatAnchor.svelte';
export { default as WorkSurfaceDock } from '$lib/work-surface/WorkSurfaceDock.svelte';
export { default as WorkSurfaceComposerChrome } from '$lib/work-surface/WorkSurfaceComposerChrome.svelte';
export { default as DispatchCard } from '$lib/work-surface/DispatchCard.svelte';
