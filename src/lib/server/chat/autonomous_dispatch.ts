// Autonomous dispatch (spec §4.2) — shared by BOTH streaming paths in
// src/routes/api/chat/sdk-stream/+server.ts.
//
// After producing a reply, the route decides whether to hand the operator's
// request off to a coding worker (CC / AGY) in the background. The two paths
// reach this decision slightly differently:
//
//   CLI-bridge path (Sonnet/Opus): the teacher (Opus) appends a hidden
//     <<<SULLY_GATE {...}>>> self-assessment block to its reply. The route
//     extracts that block and passes it here as `gateBlock`. The escalate
//     decision then ALSO requires the gate to validate + say escalate:true,
//     AND the deterministic valueGate to qualify.
//
//   Direct/local path (Haiku/Gemini/Ollama): streamText output can't be
//     cleanly stripped of a gate block, so there is NO gate block. `gateBlock`
//     is omitted and the deterministic gates alone decide: ruleGate (@cc/@agy
//     override) + valueGate (file/code/repo/long-imperative signals).
//
// In BOTH cases ruleGate (@cc/@agy literal mention) forces a dispatch. The
// worker/brief/category derivation differs: with a valid gate block the route
// prefers the teacher's choices; without one it falls back to claude-code /
// userText-slice / 'code'. This helper unifies the dispatchToWorker call + the
// system "sent to worker" message write while preserving each path's exact
// escalate condition and worker/brief/category derivation.

import { addChatMessage } from '$lib/server/chat';
import { runMode } from '$lib/server/config';
import { ruleGate, valueGate, validateGate } from '$lib/server/decisionGate';
import { dispatchToWorker } from '$lib/server/companionDispatch';
import { logTaskEvent } from '$lib/server/chatActivity';

export interface AutonomousDispatchArgs {
	/** The latest user message text (space-joined, trimmed). */
	userText: string;
	targetRepo: string;
	threadId: string;
	/**
	 * The pre-extracted SULLY_GATE self-assessment block, if any. Present only
	 * on the CLI-bridge path. When provided, it is validated and its
	 * escalate/worker/brief/category steer the decision; when omitted (direct/
	 * local path), the deterministic gates alone decide.
	 */
	gateBlock?: string | null;
	/**
	 * The Task id minted in prepareStream for this turn. When present, the
	 * dispatched job + the system "sent to worker" message reuse it (instead of
	 * minting a fresh sully-* id), so the whole turn — operator row, reply,
	 * dispatch, journal — shares one handle. The 'proposed' Task row created at
	 * turn start gets promoted to 'decided' by the dispatch. Falls back to a
	 * minted id if absent (legacy callers).
	 */
	taskId?: string;
}

/**
 * Evaluate the autonomous-dispatch gates and, if they fire, hand the request
 * to a background worker + write the system "sent to worker" chat message.
 *
 * No-op when companion dispatch is disabled — matches both paths' top-level
 * `runMode.companionDispatchEnabled` guard. The CLI path additionally gates on
 * `!errored` BEFORE calling this (a half/failed gen should never dispatch).
 */
export async function maybeAutonomousDispatch(args: AutonomousDispatchArgs): Promise<void> {
	if (!runMode.companionDispatchEnabled) return;

	const { userText, targetRepo, threadId } = args;
	const hasGate = args.gateBlock !== undefined;
	// Reuse the turn's Task id so the dispatch promotes the existing 'proposed'
	// row rather than creating an orphan. Fall back to a minted id for legacy
	// callers that don't pass one.
	const taskId = args.taskId ?? `sully-${Date.now()}`;

	const forced = ruleGate(userText);
	const vg = valueGate({ text: userText, fromTool: false });

	// Shared dispatch + system-message + journal write, so the CLI and direct
	// paths can't drift. taskId is the trace_id — dispatchToWorker → createJob
	// upserts the 'proposed' row to 'decided'.
	const fire = async (worker: 'claude-code' | 'gemini', category: string, brief: string) => {
		const res = await dispatchToWorker({
			traceId: taskId,
			worker,
			category,
			brief,
			targetRepo,
			task: userText,
			threadId
		});
		logTaskEvent(taskId, 'gate_evaluated', {
			forced: forced.forced,
			qualifies: vg.qualifies,
			force_ask: vg.forceAsk,
			worker,
			category,
			dispatched: res.ok,
			held_reason: res.ok ? null : res.reason
		});
		addChatMessage(
			'system',
			res.ok
				? `Sully sent this to **${worker === 'claude-code' ? 'CC' : 'AGY'}** on **${targetRepo}** — watching it now.`
				: `⚠️ Dispatch held: ${res.reason}.`,
			res.ok ? taskId : null,
			null,
			null,
			'sent',
			threadId,
			{ taskId }
		);
	};

	if (hasGate) {
		// CLI-bridge path — gate-block-aware escalate decision.
		const gate = validateGate(args.gateBlock ?? null);
		const autonomous = gate.ok && gate.gate.escalate && vg.qualifies && !vg.forceAsk;
		if (forced.forced || autonomous) {
			const worker =
				forced.forced && forced.worker ? forced.worker : gate.ok ? gate.gate.worker : 'claude-code';
			const brief = gate.ok ? gate.gate.brief : userText.slice(0, 200);
			const category = gate.ok ? gate.gate.category : 'code';
			await fire(worker, category, brief);
		} else {
			// Journal the no-dispatch decision too — this is a routing pair
			// (turn → classified DIRECT_ANSWER → no worker) for v3 training.
			logTaskEvent(taskId, 'gate_evaluated', {
				forced: false,
				qualifies: vg.qualifies,
				force_ask: vg.forceAsk,
				dispatched: false,
				path: 'cli'
			});
		}
		return;
	}

	// Direct/local path — deterministic gates only, no gate block to strip.
	if (forced.forced || (vg.qualifies && !vg.forceAsk)) {
		const worker = forced.forced && forced.worker ? forced.worker : 'claude-code';
		await fire(worker, 'code', userText.slice(0, 200));
	} else {
		logTaskEvent(taskId, 'gate_evaluated', {
			forced: false,
			qualifies: vg.qualifies,
			force_ask: vg.forceAsk,
			dispatched: false,
			path: 'direct'
		});
	}
}
