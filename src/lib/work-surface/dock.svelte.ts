// Dock navigation state — optional controller for pages that own the collapse ladder.
import type { WorkSurfaceDockMode } from '$lib/work-surface/types';

export interface WorkSurfaceDockState {
	mode: WorkSurfaceDockMode;
	openSurfaceId: string | null;
	sheetReturnMode: WorkSurfaceDockMode;
}

export function createWorkSurfaceDock(
	initial: Partial<WorkSurfaceDockState> = {}
): WorkSurfaceDockState {
	let mode = $state<WorkSurfaceDockMode>(initial.mode ?? 'badge');
	let openSurfaceId = $state<string | null>(initial.openSurfaceId ?? null);
	let sheetReturnMode = $state<WorkSurfaceDockMode>(initial.sheetReturnMode ?? 'badge');

	return {
		get mode() {
			return mode;
		},
		set mode(value: WorkSurfaceDockMode) {
			mode = value;
		},
		get openSurfaceId() {
			return openSurfaceId;
		},
		set openSurfaceId(value: string | null) {
			openSurfaceId = value;
		},
		get sheetReturnMode() {
			return sheetReturnMode;
		},
		set sheetReturnMode(value: WorkSurfaceDockMode) {
			sheetReturnMode = value;
		}
	};
}
