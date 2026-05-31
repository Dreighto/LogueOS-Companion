import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runMode, serverConfig } from '$lib/server/config';
import { getMeter } from '$lib/server/dispatchUsage';
import { checkDailyCap } from '$lib/server/dispatchBrakes';

export const GET: RequestHandler = async () => {
	if (!runMode.companionDispatchEnabled) {
		return json({ enabled: false, count: 0, wallClockSeconds: 0, cap: 0, used: 0 });
	}
	const meter = getMeter();
	const cap = checkDailyCap();
	return json({
		enabled: true,
		count: meter.count,
		wallClockSeconds: meter.wallClockSeconds,
		cap: cap.cap,
		used: cap.used,
		windowMin: serverConfig.companionDispatchWindowMin
	});
};
