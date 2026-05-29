// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Build-time constants injected by vite.config.ts `define` (LOS-73).
	// Surfaced in the /settings footer so the operator can identify which
	// build is currently running when triaging issues.
	const __BUILD_VERSION__: string;
	const __BUILD_SHA__: string;
	const __BUILD_TS__: string;
}

export {};
