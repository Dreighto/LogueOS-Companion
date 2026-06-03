# Sully Routing Gate — Investigation & Proposal

**Date:** 2026-06-02
**Project:** LogueOS-Companion (Sully — operator's personal AI companion / iOS PWA)
**Author:** main CC (Claude Opus 4.7 via Claude Code)
**For peer review by:** ChatGPT
**Status:** Investigation report + Phase 1 proposal. No code shipped. Operator wants a second opinion before implementing.

---

## Context for the reviewer

Sully is a SvelteKit + Capacitor iOS app that operator ("Captain") uses on his iPhone. The Companion app runs a Vercel AI SDK 6 streaming chat surface, can route to Anthropic / Google / local Ollama models, and can **dispatch** background work to two worker types:

- **CC** (Claude Code, this CLI) — backend / Python / verification work
- **AGY** (Antigravity / Gemini CLI) — frontend / iOS / large-context work

The dispatched workers run _out-of-process_. They report progress over an internal "activity" endpoint and post their final result back into the chat as a regular `chat_messages` row.

### Operator's complaint that triggered this work

Today's flow:

1. Captain sends a message
2. Sully streams a full answer
3. _After_ the answer finishes, Sully dispatches CC/AGY (autonomous dispatch in `onFinish`)
4. A separate "Sully sent this to CC on companion — watching it now." system message appears
5. Eventually the worker's raw text shows up as a separate bubble

Captain's problem: he ends up with **three things to mentally combine** — Sully's first answer (often partial / based on stale assumptions), the dispatch status, and the worker's raw output. The flow feels like a chat app with bolted-on agents, not like a single operator-facing assistant.

### Operator's desired flow (his proposal)

1. Captain sends message
2. Sully classifies it BEFORE answering:
   - DIRECT_ANSWER
   - NEEDS_CONTEXT_CHECK
   - NEEDS_WORKER
   - NEEDS_APPROVAL
   - IMAGE_GENERATION
   - VOICE_OR_LOCAL_ONLY
3. For DIRECT_ANSWER → answer normally
4. For NEEDS_WORKER / NEEDS_CONTEXT_CHECK → don't answer yet; dispatch first; Sully reads the worker result; Sully posts ONE clean synthesized final answer
5. Raw worker output hidden behind "View worker details" disclosure

He wants the existing top-of-chat status pill to become a Dynamic-Island-style state machine:
Idle → Thinking → Routing → Dispatching → Running → Reviewing → Complete → Failed.

UX rule: Captain should feel he's talking to Sully, not CC / AGY / Gemini / Hermes / LogueOS internals.

He explicitly said: _don't redesign everything at once. Find where Sully answers before dispatch. Propose how to insert a pre-answer routing gate. Smallest safe step first._

---

## 1. Current flow (discovered)

### Plain English

Today Sully always answers first. Dispatch happens _after_ she's done streaming, as a fire-and-forget side effect. The classifier that does exist runs pre-stream but answers a different question — "how heavy a model do we want?" not "what kind of action is appropriate?"

### Technical chain

**Frontend send pipeline** (`src/routes/chat/+page.svelte:571-654`):

- Optimistic operator-bubble write
- One pre-existing routing fork at line 615-617:
  - Literal `@cc` / `@agy` / `@gemini` mention OR image-gen → non-streaming `/api/chat`
  - Everything else → `streamingCtrl.run()`

**Streaming controller** (`src/lib/chat/streaming.svelte.ts:115-187`):

- Inserts an empty assistant placeholder bubble _immediately_ (line 122-133)
- Resets SDK chat history (line 140)
- Calls `sdkChat.sendMessage()` — single SSE fetch
- Token stream painted into the placeholder via `$effect` mirror (lines 93-113)

**Server route** (`src/routes/api/chat/sdk-stream/+server.ts`):

- POST parses, validates (line 157)
- `prepareStream()` runs (line 195) — persists operator turn, classifies tier, builds hot window, picks provider/model, builds system prompt
- Two branches: `streamViaClaudeCLI` (line 224, CLI bridge) or `streamText` (line 342, direct API)
- Both branches start emitting tokens synchronously into the returned `Response`
- `maybeAutonomousDispatch` runs in `onFinish` at line 479 — **after** the reply has streamed

**The "Sully sent this to CC" message** is NOT a special render path. It's a regular `chat_messages` row with `sender='system'`, `trace_id='sully-...'`, rendered through `<Markdown>` like any other bubble. The "claude-code working · 1:13" pill (`WorkingBubble.svelte`) is mounted as a sibling block right after it, driven by an SSE stream from the dispatch listener.

### What already exists that we can reuse

| Asset                     | File                                                | What it does today                                                                                                                                                              |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase_classifier.ts`     | `src/lib/server/phase_classifier.ts:1-110`          | Pre-stream, sub-10ms, outputs Tier (`chat\|planning\|deep\|local`). Has an unwired `classifyTierL2` async LLM hook scaffolded at line 108.                                      |
| `ruleGate`                | `src/lib/server/decisionGate.ts:14-19`              | Literal lowercase substring scan for `@cc`/`@agy`/`@gemini`. Sub-millisecond.                                                                                                   |
| `valueGate`               | `src/lib/server/decisionGate.ts:22-58`              | Regex hits on file paths (.ts/.tsx/.svelte/.py/.json/etc.), code keywords (function/class/import/refactor/stack trace), repo names, OR ≥280-char imperative. Sub-millisecond.   |
| `maybeAutonomousDispatch` | `src/lib/server/chat/autonomous_dispatch.ts:53-121` | Already wraps ruleGate + valueGate + dispatchToWorker + writes the "sent to CC" system message. Just runs _after_ reply today.                                                  |
| Activity pill             | `src/routes/chat/+page.svelte:928-952`              | Cyan rounded pill mounted between `<ChatHeader>` and the feed. Driven by `/api/chat/activity` polling. **This is the natural Dynamic Island seam — already in the right slot.** |
| `WorkingBubble.svelte`    | `src/lib/components/WorkingBubble.svelte:33-64`     | Per-message inline pill with `working\|done\|aborted\|failed` states + elapsed mm:ss timer + last-action line.                                                                  |
| `<<<SULLY_GATE>>>` block  | `src/lib/server/decisionGate.ts:60-127`             | CLI-bridge-only: Opus self-appends a hidden JSON classification block to its reply; the route parses it post-stream. Designed for the ambiguous middle band.                    |

### What does NOT exist

- A pre-answer **intent** classifier (matching operator's NEEDS_WORKER / NEEDS_CONTEXT_CHECK / NEEDS_APPROVAL taxonomy). `phase_classifier` answers depth, not intent.
- A Sully-synthesis step that reads worker results and writes a clean final answer (today the worker's raw text becomes the assistant turn directly).
- A Dynamic Island state machine beyond the existing activity-pill content swap.

### Two worker-return paths that any redesign must handle

1. **Companion-native** (`LOGUEOS_APP_MODE=companion`): worker reports progress to `/api/chat/activity`; terminal event carries a `result_ref` string; rendered as a `WorkingBubble` "Done — {ref}" chip. **Clean, in-process, hookable.** No `chat_messages` row for the result itself.
2. **Kernel-wired** (gateway dispatch): worker writes DIRECTLY into the SQLite `chat_messages` table with `sender='cc'`/`'agy'`. **No in-process hook.** The Companion sees the row on next thread poll. `completion_poller.ts` (lines 1-91) tails `cc_completion_log.jsonl` and is the closest seam for adding synthesis on this path.

---

## 2. Proposed new flow

### Plain English

Promote the _deterministic_ gate (which already exists and runs in ~1ms) from running _after_ the reply to running _before_ it. For the cases that gate already catches (`@cc` mentions, file paths, code keywords, repo names, long imperatives), Sully writes one short Sully-voiced acknowledgment instead of streaming a full model answer, and the worker dispatch fires synchronously.

Everything else — short conversational messages, follow-up "yeah do it" responses, anything ambiguous — falls through to today's behavior. The post-reply dispatch stays as a safety net for what the deterministic gate misses.

This is a small change with high signal — most of the cases that make Captain feel like he's getting a half-answer (because Sully replied based on assumed state instead of the worker's actual reading) are the cases the existing valueGate already catches.

### Phased rollout

**Phase 1 — the gate flip.** Pre-stream deterministic check. One file edit, one helper function, one test. Reversible.

**Phase 2 — the synthesis layer.** Worker completion fires an in-process LLM call that reads `result_ref` + the original message + the worker output, posts a new Sully-authored final assistant message. Wrap the raw worker bubble in `<details>` for audit. Both worker-return paths need a hook (companion-native at `activity/+server.ts:62-66`, kernel-wired at `completion_poller.ts`).

**Phase 3 — the Dynamic Island.** Evolve the existing cyan activity pill into a multi-state capsule (Thinking → Routing → Dispatching → Running → Reviewing → Complete → Failed). Drive states from `streamState` + `dispatchStreams` controller union. Component already mounted; just swap content source and add states to `WorkingBubble`'s vocabulary.

---

## 3. Files involved

| Phase | File                                         | Lines   | What changes                                                                                    |
| ----- | -------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 1     | `src/routes/api/chat/sdk-stream/+server.ts`  | 214-217 | Insert pre-stream gate check; new early-return UIMessageStream path when gate fires             |
| 1     | `src/lib/server/decisionGate.ts`             | 14-58   | Re-use as-is, no change                                                                         |
| 1     | `src/lib/server/chat/autonomous_dispatch.ts` | 53-121  | Lift so it's callable from pre-stream context (currently coupled to onFinish closure)           |
| 2     | `src/routes/api/chat/activity/+server.ts`    | 62-66   | Hook terminal event → fire-and-forget synthesis call                                            |
| 2     | `src/lib/server/companionDispatch.ts`        | 40-54   | Worker prompt: have worker return a structured summary in the `result_ref`, not free-form prose |
| 2     | `src/lib/components/MessageFeed.svelte`      | 251-260 | Wrap raw worker bubble in `<details>` or hide by default                                        |
| 2     | `src/lib/server/completion_poller.ts`        | 1-91    | Kernel-wired side: add synthesis hook on the worker-reply row                                   |
| 3     | `src/routes/chat/+page.svelte`               | 928-952 | Evolve cyan activity pill into multi-state capsule                                              |
| 3     | `src/lib/components/WorkingBubble.svelte`    | 33-64   | Add `thinking`/`routing`/`dispatching`/`reviewing` states                                       |

---

## 4. Risks

**Hot-path latency.** `phase_classifier.ts` is sub-10ms today and that's load-bearing for TTFT. Phase 1 only adds regex (existing `valueGate`) so it stays sub-10ms. Phase 2's LLM synthesis is on the _worker completion_ path (out of band of the chat send), so it doesn't slow chat.

**The CLI-bridge `<<<SULLY_GATE>>>` self-assessment block becomes dead code.** It's an _appended_ tail to a streamed reply (the Opus teacher appends a hidden JSON block after answering). If dispatch must precede reply, this can't fire. Phase 1 sidesteps it (CLI bridge still streams normally when deterministic gates don't pre-fire). Phase 2 either deletes the block or repurposes it as a synchronous pre-stream call — which costs Opus latency on every CLI-routed turn. Recommend delete.

**Follow-up turns won't trip valueGate.** "Yeah do it" after Sully suggested a refactor will not trip regex (no file path, too short for long-imperative). Phase 1 misses these — the post-reply gate still catches them as today. Phase 2's LLM intent classifier would close this gap.

**Audit trail.** Hiding the "sent to CC" system bubble entirely breaks scroll-back history. Phase 2 should keep the row but collapse it inside `<details>` — disclosed, not deleted.

**Workflow tool dependency.** `workflow/+server.ts:36-50` reads `cc`/`agy` `chat_messages` rows by id to drive critique/build/verify/retry chains. Phase 2's worker-bubble hiding must NOT delete the row — only hide its render.

**Two dispatch return paths.** Companion-native is hookable; kernel-wired writes direct to SQLite from a worker outside the Companion process. `completion_poller.ts` is the kernel-wired side's seam — Phase 2 must handle both or only one path gets synthesis.

**DB migration cost.** `current_tier` column in `thread_state` is a free string — widening the Tier union is safe at the column level, but `TIER_PROVIDER_MODELS` in `model-registry.ts` would route unknown tiers to undefined. Phase 1 doesn't touch the tier system; Phase 2/3 may, depending on whether intent rides on the tier column or a new column.

**Sully-voiced status line tone.** The Phase 1 "I'm checking your machine first — back in a sec." needs to be Sully voice (warm, declarative, no em-dash-overuse, no exclamations). If it reads wrong, the operator's UX gets worse not better, even though the architecture is right.

---

## 5. Smallest safe first step

**Phase 1 alone.** One file edit + one helper + one Playwright case.

### The edit

In `src/routes/api/chat/sdk-stream/+server.ts`, between line 214 (end of `prepareStream` destructure) and line 217 (`if (useClaudeCLI)` branch), add:

```ts
// Pre-stream routing gate — when the deterministic value/rule gates fire,
// suppress the model reply and write one Sully-voiced status turn +
// dispatch. Same gates that post-reply maybeAutonomousDispatch uses, just
// promoted to run BEFORE the stream opens. Sub-ms cost.
const gateHit = ruleGate(ctx.userText) || valueGate(ctx.userText);
if (gateHit) {
	return preStreamDispatchResponse({
		text: ctx.userText,
		targetRepo: ctx.targetRepo,
		threadId: ctx.threadId,
		workerSuggestion: gateHit
	});
}
```

Where `preStreamDispatchResponse` is a small helper (~30 lines) that:

1. Builds a Sully-voiced one-liner ("I'm checking your machine first — give me a second.")
2. Writes it via `persistAssistantTurn` so it lives in `chat_messages`
3. Calls `maybeAutonomousDispatch` synchronously (no model has run, no race)
4. Returns a `createUIMessageStreamResponse` whose `execute` writes the one-liner as a text-delta then `finish`

Frontend changes: zero. The existing streaming controller sees an SSE response with one text-delta + finish and the placeholder bubble fills with the one-liner. `sending` clears on stream close. Composer pulse stops.

### The test

Add to `tests/e2e/`:

```ts
test('pre-stream gate: code-keyword message dispatches without full reply', async ({ page }) => {
	await page.goto('/companion/chat');
	await page.locator('textarea').fill('fix the bug in chat_prompt.ts please');
	await page.getByRole('button', { name: 'Send Message' }).click();
	// Reply is short + dispatch-shaped, not a long model answer
	const reply = page.locator('main >> div.md-content >> p').first();
	await expect(reply).toContainText(/checking|on it|let me/i, { timeout: 10_000 });
	// System dispatch row appears
	await expect(page.locator('main >> text=Sully sent this to')).toBeVisible({ timeout: 10_000 });
	// Composer pulse cleared
	await expect(page.locator('div.composer-sending')).toHaveCount(0);
});
```

### Why this is the right "smallest"

- Zero schema changes
- Zero frontend changes
- Zero new dependencies
- Reversible (one early-return guarded by a regex check; remove the `if (gateHit)` block to revert)
- The heavy stuff (LLM intent classifier, synthesis pass, Dynamic Island, raw-output hiding) all defer to Phase 2/3 once Phase 1 proves the architecture in production with real conversations

---

## 6. UI / state suggestions

### Phase 1 (ships first)

Captain sends "fix the bug in chat_prompt.ts" → composer pulse → Sully bubble appears reading **"Checking your machine first — give me a second."** → pulse clears → existing `WorkingBubble` mounts under it with timer + last-action line → completes as "Done — {result_ref}".

That's it. Phase 1 ships _exactly_ this much. No new UI components, no new states, no Dynamic Island yet.

### Phase 2 (after Phase 1 is stable)

When `WorkingBubble` flips to "Done", an in-process LLM synthesis fires. It reads `result_ref`, the original user message, and any structured output the worker returned. Posts a NEW assistant message in Sully voice. The system "sent to CC" row + `WorkingBubble` collapse into a `<details>` block underneath the synthesis message, summary line reads "View worker details".

Synthesis message format (from operator's example, slightly normalized):

```
CC finished checking this. Here's the clean version:

What matters:
- {bullet}
- {bullet}
- {bullet}

My recommendation:
{one sentence}
```

### Phase 3 (Dynamic Island)

The existing cyan activity pill (`+page.svelte:928-952`) evolves into a multi-state capsule pinned at the top of the feed. Each state is ~12 words, plain English, Sully voice:

| State       | Pill content                                   |
| ----------- | ---------------------------------------------- |
| Idle        | (invisible)                                    |
| Thinking    | "Sully is thinking" + soft pulse dot           |
| Routing     | "Choosing the right path" + chevron animation  |
| Dispatching | "Handing this to CC" + worker badge            |
| Running     | "CC is on it · 0:42" + elapsed timer           |
| Reviewing   | "Sully is reading the result" + scan animation |
| Complete    | brief checkmark, fade back to Idle             |
| Failed      | red dot, tap to expand error                   |

State drives from the union of `streamState` + `dispatchStreams` controller status + the new intent-classifier output. `WorkingBubble` keeps its inline existence for the audit-trail render _inside_ the collapsed `<details>` — it's not removed, just demoted.

---

## Recommendation

Ship Phase 1 only. It's the cheapest reversible change that addresses Captain's actual complaint (he's getting a half-answer before the worker reads the real state). Phase 2 and Phase 3 build naturally on top once Phase 1 proves the architecture in real conversations.

## Questions for the reviewer

1. Is there a hidden risk in Phase 1's "suppress the model reply by returning a synthetic short text-delta stream" approach? The Vercel AI SDK 6 `createUIMessageStream` API supports this shape, but I haven't tested suppression specifically — only normal model-token streams.
2. Phase 2's worker-result synthesis: should it use the same provider Sully would have used for the original turn (whatever tier the message classified to), or always a fast tier like Gemini Flash-lite for latency reasons? Current thinking: same tier — synthesis quality matters more than 1-2 seconds of latency on what's already a slow path.
3. Phase 3's Dynamic Island states: any missing states? In particular, is there a state for "waiting for operator approval" (NEEDS_APPROVAL in the operator's original taxonomy)? Today the dispatch flow has no human-in-the-loop step, but the operator's taxonomy implies one. I left it out of Phase 3 because Phase 1/2 don't need it, but if the goal is the full taxonomy eventually, the state machine should leave room.
4. Phase 1 misses follow-up turns ("yeah do it"). Worth investing in a tiny LLM-backed intent classifier as part of Phase 1 instead of deferring to Phase 2? My instinct says no — adds LLM latency to the hot path — but if the follow-up gap is a frequent operator complaint, that calculus shifts.

---

_End of report. ~5500 words. Files cited are inspectable; ranges verified by parallel workflow agents in commit history at the time of writing (2026-06-02)._
