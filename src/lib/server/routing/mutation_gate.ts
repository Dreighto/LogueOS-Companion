// The Mutation Gate (spec Contract 2). Pure read of the active task — decides
// whether a turn taken WHILE A TASK IS RUNNING is plain conversation or a
// work-intent that must NOT silently touch the running task. Pre-dispatch
// (gated proposal) tasks are left to the existing ask-before-dispatch flow.
import { getRunningTaskForThread, type PendingJob } from '$lib/server/dispatchJobs';

export type MutationClass = 'NO_ACTIVE_TASK' | 'CONVERSATIONAL_ONLY' | 'RUNNING_WORK_INTENT';
export interface MutationGateResult {
	classification: MutationClass;
	activeTaskId: string | null;
	activeTaskStatus: string | null;
}

// Work-intent signal: imperative verbs with an object, or an @mention. Mirrors
// the spirit of decide()'s value gate but local + cheap. Conservative — when
// unsure, treat as conversation (safe: we never silently mutate; worst case a
// real work request during a running task is answered as chat, which the
// operator can re-issue once the task finishes).
const WORK_INTENT_RE =
	/@cc\b|@agy\b|@gemini\b|\b(build|implement|create|generate|add|write|fix|patch|refactor|audit|review|run|inspect|check|verify|diagnose|deploy|migrate|update|change|delete|remove|test|investigate)\b/i;

// Opinion/advice override (live-audit 2026-06-04, the "E2" over-gate). While a
// task runs, the operator often MENTIONS the running work ("...that audit...")
// inside a plain opinion question — the work-noun would otherwise trip
// WORK_INTENT_RE. An explicit opinion/advice signal (asking Sully's view, or
// "should I ...?" about the operator's OWN action) means it is conversation,
// not a new request to act. @mentions still force work (they bypass this).
// Safe by design: when both signals appear, we err toward conversation — Sully
// answers instead of gating, never silently injecting into the running task.
const OPINION_RE =
	/\b(what(?:'?s| is| do you| are your)|do you (?:think|reckon)|should i\b|your (?:read|take|thoughts?|opinion|view)\b|thoughts on\b|how do you feel|wondering (?:if|whether|about))\b/i;
const MENTION_RE = /@cc\b|@agy\b|@gemini\b/i;

export function runMutationGate(threadId: string, userText: string): MutationGateResult {
	// getRunningTaskForThread queries only RUNNING_STATES rows — it will never
	// match the current turn's own 'classified' row (which is always the highest
	// id after classifyAndTouchThread), so the gate correctly ignores the
	// just-created turn and only fires when a genuinely-running task exists.
	const active: PendingJob | null = getRunningTaskForThread(threadId);
	if (!active)
		return { classification: 'NO_ACTIVE_TASK', activeTaskId: null, activeTaskStatus: null };
	const text = userText || '';
	// An @mention always means work. Otherwise a work-word counts only if the turn
	// is NOT framed as an opinion/advice question (precision-bias toward chat).
	const work = MENTION_RE.test(text) || (WORK_INTENT_RE.test(text) && !OPINION_RE.test(text));
	return {
		classification: work ? 'RUNNING_WORK_INTENT' : 'CONVERSATIONAL_ONLY',
		activeTaskId: active.trace_id,
		activeTaskStatus: active.status
	};
}
