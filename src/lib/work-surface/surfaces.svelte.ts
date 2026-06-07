import type { WorkSurfaceTask, Surface, SurfaceStatus } from '$lib/types/workSurface';

let surfaceIdCounter = 1;

/** Read `surfaceStore.items` inside `$derived` / `$effect` so Svelte tracks updates. */
export const surfaceStore = $state({ items: [] as Surface[] });

export function spawnSurface(fromMessageId: string, task: WorkSurfaceTask): string {
	const surfaceId = `surface-${surfaceIdCounter++}`;
	const now = new Date().toISOString();
	const newSurface: Surface = {
		surfaceId,
		spawnedFromMessageId: fromMessageId,
		title: task.title,
		status: 'running',
		task: task,
		createdAt: now,
		updatedAt: now
	};
	surfaceStore.items = [...surfaceStore.items, newSurface];
	return surfaceId;
}

export function attachToSurface(id: string, patch: Partial<Surface>) {
	const index = surfaceStore.items.findIndex((s) => s.surfaceId === id);
	if (index !== -1) {
		const next = [...surfaceStore.items];
		next[index] = { ...next[index], ...patch, updatedAt: new Date().toISOString() };
		surfaceStore.items = next;
	}
}

export function setStatus(id: string, status: SurfaceStatus) {
	const index = surfaceStore.items.findIndex((s) => s.surfaceId === id);
	if (index !== -1) {
		const next = [...surfaceStore.items];
		next[index] = { ...next[index], status, updatedAt: new Date().toISOString() };
		surfaceStore.items = next;
	}
}

export function removeSurface(id: string) {
	surfaceStore.items = surfaceStore.items.filter((s) => s.surfaceId !== id);
}
