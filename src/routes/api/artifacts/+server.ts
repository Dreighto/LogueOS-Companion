// GET /companion/api/artifacts → index of ALL promoted artifacts, newest first.
// Backs the Artifacts library surface in the SwiftUI app. Tailscale is the auth
// boundary (no app-level session gate, same as the per-trace route).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAllArtifacts } from './_artifactService';
import { getThreadMeta } from '$lib/server/thread_meta';

export const GET: RequestHandler = async ({ url }) => {
	const limitParam = Number(url.searchParams.get('limit'));
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 2000) : 500;
	const result = listAllArtifacts(limit);
	// Resolve each artifact's source-thread title at index time (the library
	// groups by thread). Cached per thread so chat_thread_meta is hit once each.
	const titles = new Map<string, string | null>();
	for (const a of result.artifacts) {
		if (!a.thread_id) continue;
		if (!titles.has(a.thread_id)) {
			titles.set(a.thread_id, getThreadMeta(a.thread_id)?.title ?? null);
		}
		a.thread_title = titles.get(a.thread_id) ?? null;
	}
	return json(result);
};
