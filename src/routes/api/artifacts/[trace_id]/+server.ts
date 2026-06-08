import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listArtifactsForTrace } from '../_artifactService';

export const GET: RequestHandler = async ({ params }) => {
	const traceId = params.trace_id;
	const listing = listArtifactsForTrace(traceId);
	if (!listing) {
		return json({ error: 'trace_not_found' }, { status: 404 });
	}
	return json(listing);
};
