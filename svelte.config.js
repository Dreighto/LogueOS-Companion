import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	// Vite Svelte Inspector — dev-only DOM-to-source picker (alt-x). Production builds unaffected.
	vitePlugin: {
		inspector: {
			toggleKeyCombo: 'alt-x',
			showToggleButton: 'always',
			toggleButtonPos: 'bottom-right'
		}
	},
	kit: {
		// adapter-node produces a standalone Node.js server (build/index.js).
		// Launch with:  PORT=18769 HOST=0.0.0.0 node build/index.js
		adapter: adapter(),
		paths: {
			// Companion is exposed via Tailscale Serve at
			//   https://<tailnet>/companion  →  http://localhost:18769/companion
			// kit.paths.base='/companion' so SvelteKit generates internal hrefs like
			// /companion/chat and the local adapter-node server serves under /companion/*.
			// (This mirrors Console's '/console' base VERBATIM — the only change is the
			// path string. Do NOT add a separate Vite base; Console works with kit.paths.base
			// alone and so does this.)
			base: '/companion'
		},
		// CSRF Origin check disabled — adapter-node derives the allowed origin from the
		// ORIGIN env var; behind Tailscale Serve/Funnel the operator may hit the surface
		// via the canonical hostname, a tailnet IP, or localhost. A mismatch returns 403
		// on multipart POST (image-paste uploads). Tailscale is the auth boundary; there
		// is no session cookie for a malicious site to ride, so the Origin check is
		// belt-and-suspenders we already gate at the network layer.
		csrf: { checkOrigin: false }
	}
};

export default config;
