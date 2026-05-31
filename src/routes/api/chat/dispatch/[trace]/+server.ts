import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runMode } from '$lib/server/config';
import { getJob } from '$lib/server/dispatchJobs';
import { getActivityForTrace } from '$lib/server/chatActivity';

export const GET: RequestHandler = async ({ params }) => {
	if (!runMode.companionDispatchEnabled) return json({ job: null });
	const traceId = (params.trace || '').trim();
	if (!traceId) return json({ error: 'trace required' }, { status: 400 });
	const job = getJob(traceId) ?? null;
	const activity = getActivityForTrace(traceId, 200);
	return json({ job, activity });
};
