// Decision Gate (spec §4.2). Three stages, no second local model:
//   1. ruleGate       — zero-token literal pre-filter (@cc/@agy mentions).
//   2. valueGate      — deterministic, model-independent objective-signal gate
//                       + injection guard (tool/pasted content can't auto-fire).
//   3. parseSchema    — validate the {escalate,...} tail of the CLI-bridge reply
//                       (Task 1b.3).

export interface RuleResult {
	forced: boolean;
	worker?: 'claude-code' | 'gemini';
}

// Literal worker mentions force a dispatch route, bypassing the value gate.
export function ruleGate(text: string): RuleResult {
	const t = text.toLowerCase();
	if (t.includes('@cc')) return { forced: true, worker: 'claude-code' };
	if (t.includes('@agy') || t.includes('@gemini')) return { forced: true, worker: 'gemini' };
	return { forced: false };
}

// Objective signals that justify spending a cloud dispatch.
const FILE_PATH_RE = /\b[\w./-]+\.(ts|tsx|js|svelte|py|json|md|css|sql|sh|yaml|yml)\b/;
const CODE_KEYWORD_RE =
	/\b(function|class|import|export|refactor|bug|stack ?trace|compile|build fails?|test fails?|migration|endpoint|component|deploy)\b/i;
const REPO_RE = /\b(miru|orchestrator|kernel|console|nasdoom|companion)\b/i;
const IMPERATIVE_RE =
	/\b(fix|add|build|implement|refactor|create|update|remove|migrate|wire|debug|investigate|write)\b/i;

// Pinned value-gate heuristic: a qualifying message has a code/repo/file signal,
// OR is a long (>=280 char) imperative request. Tunable later from telemetry.
const COMPLEXITY_FLOOR_CHARS = 280;

export interface ValueGateResult {
	qualifies: boolean;
	/** True when the content is tool-sourced/pasted — must Ask even in Full-auto. */
	forceAsk: boolean;
	reason: string;
}

export function valueGate(input: { text: string; fromTool: boolean }): ValueGateResult {
	const text = (input.text || '').trim();
	const hasFile = FILE_PATH_RE.test(text);
	const hasCode = CODE_KEYWORD_RE.test(text);
	const hasRepo = REPO_RE.test(text);
	const longImperative = text.length >= COMPLEXITY_FLOOR_CHARS && IMPERATIVE_RE.test(text);
	const qualifies = hasFile || hasCode || hasRepo || longImperative;
	const reason = qualifies
		? hasFile
			? 'file-path-signal'
			: hasCode
				? 'code-keyword'
				: hasRepo
					? 'repo-signal'
					: 'long-imperative'
		: 'no-objective-signal';
	// Injection guard: never auto-dispatch tool/pasted content.
	return { qualifies, forceAsk: input.fromTool === true, reason };
}
