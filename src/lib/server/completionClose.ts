// Task close-out: post Sully's completion message into the originating thread,
// link it as the synthesis message, and fire a (self-gated) push. Extracted
// from the activity route so it is unit-testable and so BOTH bugs are fixed in
// one place: (1) empty-string thread_id must fall back to 'default'; (2) the
// post must happen even when the FSM rejects done→synthesized (e.g. a
// completed callback that lands after an abort) — synthesis is best-effort.
import { addChatMessage } from './chat';
import { logTaskEvent } from './chatActivity';
import { getJob, markSynthesized } from './dispatchJobs';
import { appIdentity } from './config';
import { sendPushToAll } from './web_push';
import { sendApnsToAll } from './apns';

/** Empty string OR null/undefined thread_id → 'default'. (`??` alone misses ''.) */
export function resolveCompletionThread(threadId: string | null | undefined): string {
	return threadId && threadId.trim() ? threadId : 'default';
}

export function closeOutTask(
	traceId: string,
	outcome: 'done' | 'failed',
	resultText: string
): void {
	const job = getJob(traceId);
	const threadId = resolveCompletionThread(job?.thread_id);
	const text = resultText.trim();
	const msg =
		outcome === 'done'
			? text
				? `Done. Here's what came back:\n\n${text}`
				: `That's finished — the task completed cleanly.`
			: text
				? `That one hit a snag: ${text}`
				: `That one didn't complete — I'll need another look.`;
	try {
		const row = addChatMessage('local', msg, traceId, null, null, 'sent', threadId, {
			taskId: traceId
		});
		logTaskEvent(traceId, 'synthesis_completed', { outcome, via: 'worker-result' });
		// Best-effort link — FSM may reject the transition from a terminal state;
		// the operator-facing message above has ALREADY landed regardless.
		try {
			markSynthesized(traceId, row.id);
		} catch {
			/* already terminal (aborted/failed/synthesized) — non-fatal */
		}
	} catch (e) {
		console.error('[completionClose] message failed', e);
	}
	const pushPayload = {
		title: outcome === 'done' ? 'Sully — task done' : 'Sully — task needs you',
		body: outcome === 'done' ? 'Your task finished. Tap to see the result.' : 'A task hit a snag.',
		url: appIdentity.pushDefaultUrl
	};
	// Two delivery legs, both self-gated (no-op until creds + a device exist).
	void sendPushToAll(pushPayload).catch((e) =>
		console.error('[completionClose] web push failed', e)
	);
	void sendApnsToAll(pushPayload).catch((e) =>
		console.error('[completionClose] apns push failed', e)
	);
}
