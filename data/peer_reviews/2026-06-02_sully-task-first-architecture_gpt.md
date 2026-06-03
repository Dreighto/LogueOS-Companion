# Sully — Task-First Architecture + Forensic Turn Journal

**Date:** 2026-06-02
**Project:** LogueOS-Companion (Sully — operator's personal AI companion on iPhone/PWA)
**Author:** main CC (Claude Opus 4.7 via Claude Code)
**For peer review by:** ChatGPT
**Status:** Architecture proposal. No code shipped. Operator wants a second opinion before implementation. Cloud-only chat is the test bed (companion-v2 retrain is in flight on the GPU).
**Predecessor:** `2026-06-02_sully-routing-gate-investigation_gpt.md` — Phase 1 of the routing-gate work. This document subsumes that proposal and expands it into the full architectural shift.

---

## Context for the reviewer

Sully is a SvelteKit + Capacitor iOS app running on the operator's home machine. It uses Vercel AI SDK 6 for chat, routes to Anthropic / Google / local Ollama models, and dispatches work to two worker types (CC = Claude Code backend; AGY = Antigravity / Gemini CLI frontend).

### Operator's stated goal (verbatim)

> Move from a "chat-first, dispatch-second" architecture to a "work-first, answer-after-verification" architecture, while keeping Sully as the only visible assistant and treating workers as hidden infrastructure behind task objects.
>
> We also need to make sure there is a way for the data to be pulled into a log so that way we can track progress and you can read from logs to understand what happened as we continue to test rather than me having to tell you to check the chat logs.
>
> This all lives on my machine so there is real data we can store and then we can track failure points and when Sully did something right and something wrong or if there are any underlying issues. Since we are using the cloud right now for the models we can test once we get done with all of this.

### What that means in plain English

Two intertwined asks:

1. **Architectural pivot:** every operator turn becomes a **Task** that Sully runs through _classify → route → (maybe dispatch) → (maybe verify) → synthesize → reply_. Workers (CC / AGY / Hermes / kernel listeners) stay hidden behind the Task abstraction — the operator only ever sees Sully. The current "answer first, dispatch later" flow is replaced by "decide first, work first, _then_ answer with verified context."

2. **Forensic journal:** a **machine-readable per-turn log** that CC (this assistant) can read after the fact to answer "what happened on turn X?" — model, provider, tokens, latency, every classifier decision, every gate fire, every worker step, every error. So the operator stops having to say "go read the chat logs."

Both shipped together so the architecture has the instrumentation it needs to be iterated on safely. The forensic journal isn't a separate feature — it's the side effect of running the Task lifecycle through a single, persisted state machine.

---

## 1. What we have today (inventory)

Five parallel agents mapped the existing surfaces. The findings are dense; the upshot is that **70% of the pieces already exist**, scattered across ~14 SQLite tables and ~12 log files. The real work is unifying them, not building from scratch.

### Existing "task-like" primitives

| Primitive              | Path                                         | Status today                                                                                                                                                                                       | Reuse-or-extend                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending_jobs` table   | `src/lib/server/dispatchJobs.ts:51-78`       | Worker dispatch lifecycle FSM (decided→dispatched→working→done\|failed\|retry\|aborted), trace_id, worker, brief, category, fingerprint, predicted+actual tokens, result_ref, started_at, ended_at | **EXTEND — this IS the Task primitive.** Just needs `thread_id`, source, classification trail, verification, synthesis_message_id.                                                                                                                                                         |
| Status FSM transitions | `src/lib/server/dispatchJobs.ts:37-45`       | Allowed-transition map, forward-only, terminal sinks                                                                                                                                               | Extend with pre-dispatch (`proposed`, `classified`, `gated`, `held`) and post-terminal (`verified`, `synthesized`) stages.                                                                                                                                                                 |
| `chat_activity` table  | `src/lib/server/chatActivity.ts:8-17`        | Per-task event log keyed by trace_id (action: reading\|edited\|ran\|thinking\|completed\|failed; target text)                                                                                      | **REUSE AS-IS** as the per-task event stream. Just need to write to it for non-dispatched turns too (today it's empty for 95% of turns where Sully answered directly). Also: move the CREATE TABLE into `bootstrap.ts` (currently lazy-created in `chatActivity.ts`, can miss on cold DB). |
| `chat_messages` rows   | `src/lib/server/chat.ts:36-302`              | The visible conversation; carries `trace_id`, `ticket_id`, `interactive_action` JSON, `quality_signal`                                                                                             | **EXTEND** — add `task_id` (or formalize trace_id), `model`, `provider`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `error`.                                                                                                                                                      |
| `chat_thread_state`    | `src/lib/server/thread_state.ts:20-175`      | Per-thread classifier cache (current_tier, operator_override, provider_override, last_model_used)                                                                                                  | **REUSE AS-IS.** No changes needed.                                                                                                                                                                                                                                                        |
| `observations` table   | `src/lib/server/observation_emit.ts:46-193`  | Tier-0 learning emissions; trace_id + chat_thread_id + tier_at_emit + models_used                                                                                                                  | **REUSE AS-IS** as the per-task learning signal. Currently disabled in companion mode — re-enable.                                                                                                                                                                                         |
| HMAC dispatch contract | `src/lib/server/companionDispatch.ts:33-119` | brakes → createJob(decided) → HMAC POST → markDispatched                                                                                                                                           | **REUSE VERBATIM** as the worker transport.                                                                                                                                                                                                                                                |

### Existing log surfaces

CC's reader interface today is "stitch by hand across these." The journal proposal collapses them under one query API.

| Log                                                                         | Where                   | Format            | What's there                                                               | Operator-readable?                         | CC-readable?                               |
| --------------------------------------------------------------------------- | ----------------------- | ----------------- | -------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `chat_messages`                                                             | `companion.db`          | SQLite            | The visible conversation                                                   | Via UI                                     | Yes (SQL)                                  |
| `chat_activity`                                                             | `companion.db`          | SQLite            | Worker step bubbles                                                        | Via the cyan activity pill + WorkingBubble | Yes (SQL) — empty for non-dispatched turns |
| `pending_jobs`                                                              | `companion.db`          | SQLite            | Dispatch state machine + token telemetry                                   | No                                         | Yes (SQL)                                  |
| `dispatch_listener_traces/<trace>.{stdout,stderr,done}`                     | Orchestrator filesystem | Files             | **Full worker output + verdict**                                           | No                                         | **YES — and CC isn't currently using it**  |
| `cc_completion_log.jsonl`                                                   | Orchestrator `/data/`   | JSONL append-only | Terminal team-ledger row per ship                                          | Operator can `tail -f`                     | Yes (read JSONL)                           |
| `cc_heartbeat_log.jsonl`                                                    | Orchestrator `/data/`   | JSONL append-only | Per-minute liveness ticker                                                 | No                                         | Yes                                        |
| `dispatch_dlq.jsonl`                                                        | Orchestrator `/data/`   | JSONL append-only | Stall-recovery DLQ                                                         | No                                         | Yes                                        |
| `chat_token_usage` / `chat_tts_usage` / `chat_stt_usage` / `chat_web_usage` | `companion.db`          | SQLite            | Per-day-per-provider cost rolls                                            | No                                         | Yes                                        |
| `dispatch-prompts/<trace>.prompt.json`                                      | Filesystem              | JSON              | The literal prompt the worker received                                     | No                                         | Yes                                        |
| `usage_events`                                                              | `companion.db`          | SQLite            | Pre-dispatch prediction telemetry                                          | No                                         | Yes                                        |
| llm_router output                                                           | stdout / console.error  | Ephemeral         | **Lost** — model attempts, fall-through, prompt-cache hits never persisted | No                                         | **NO**                                     |
| Sully's tool invocations                                                    | Vercel AI SDK in-memory | Ephemeral         | What tools she called per turn                                             | Yes (chips)                                | **NO — chip text only, no persistence**    |

### Existing render surfaces (the "five task-shaped paths bolted on")

| Surface         | Where                        | Today                                                                                                                                                  |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operator bubble | `MessageFeed.svelte:122`     | `sender='operator'` → right-aligned bubble                                                                                                             |
| Sully bubble    | `MessageFeed.svelte:124-149` | Every non-operator row gets `<SullyNameTag>` + `<Markdown>`. `cc`/`agy`/`local`/`hermes` senders **silently impersonate Sully** (no distinct branch).  |
| LOGUEOS bubble  | `MessageFeed.svelte:126`     | `sender='system'` → SullyNameTag relabeled 'LOGUEOS'                                                                                                   |
| WorkingBubble   | `MessageFeed.svelte:251-260` | Sibling block under system bubbles whose trace_id starts with `sully-`; driven by `ensureDispatchStream(trace_id)`                                     |
| Activity pill   | `+page.svelte:928-952`       | Cyan chip above the feed, polled from `/api/chat/activity` — a SECOND parallel surface for "worker is doing X" with no shared state with WorkingBubble |
| Thinking-dots   | `MessageFeed.svelte:277-304` | `streamState` driven, not row-driven                                                                                                                   |
| Tool-call chips | `MessageFeed.svelte:314-352` | `sdkChat.messages` parts driven, not row-driven                                                                                                        |

**Five smells worth naming:**

1. The LOGUEOS label is the ONLY visual hint that a system bubble is task-shaped. It still gets the same Copy/Regen/Read-aloud/Thumbs footer as a Sully reply — wrong for a system event.
2. `cc` / `agy` / `local` / `hermes` senders have ZERO distinct UI today — silently impersonate Sully.
3. WorkingBubble is mounted as a SIBLING of the system bubble, not a replacement → operator sees `[system text bubble][working pill]` stacked for the same trace.
4. activityPill and WorkingBubble are parallel implementations of the same concept with no shared state.
5. No `task_id` on the DB row yet — `trace_id` is the de-facto task id, only on system rows.

### Critical gaps in the current model

Surfacing six concrete bugs / missing fields the proposed architecture closes:

1. **No `thread_id` on `pending_jobs`.** `dispatchToWorker` takes threadId as input but `createJob` doesn't persist it. The thread↔job link survives ONLY in the `chat_messages.trace_id` back-pointer from the system row. Asking "show me all jobs Sully spawned from thread X" requires a join through `chat_messages`.

2. **Classification trail evaporates.** The FSM starts at `decided`. Pre-dispatch stages (gate fired, brakes held, valueGate reason, SULLY_GATE block) leave no DB trace. A held dispatch only writes a chat system message; brakes refusals are invisible.

3. **Verification + synthesis not modeled.** Terminal states are `done|failed|aborted` from the listener's perspective. Did the diff merge? (shipments.ts polls GH live, no DB row.) Did Sully synthesize a follow-up? Did the operator thumb it up? None flow back to one object.

4. **Two parallel completion signals.** `pending_jobs.status` (in-process) and `cc_completion_log.jsonl` (out-of-process file tail) don't reconcile. `completion_poller.ts` only fires web push — never advances `pending_jobs`.

5. **`chat_messages` doesn't carry model OR tokens.** No `model`, no `provider`, no `latency_ms`. "How many tokens did turn 638 consume" is unanswerable from the DB. Daily aggregates only.

6. **`chat_activity` is empty for 95% of turns.** When Sully answers directly without dispatching, there is zero machine-readable trace of what she did — only the prose itself.

---

## 2. The architectural shift (plain English)

**Today (chat-first):**

1. Operator sends.
2. Sully streams a reply.
3. AFTER the reply finishes, a classifier checks if dispatch is warranted.
4. If yes, dispatch happens fire-and-forget; a separate "Sully sent this to CC" message appears.
5. Worker prose lands as a `cc`/`agy` chat row.
6. Operator has to mentally combine three streams.

**Proposed (task-first):**

1. Operator sends.
2. A **Task** is minted immediately with a task_id. State: `proposed`.
3. Task runs through phases: `classify` → `route` → `(maybe dispatch + verify)` → `synthesize` → terminal.
4. While work is happening, **one TaskCard** in the chat surface is the operator-visible representation — Sully voice, progressively updated. Raw worker output is captured in the journal but rendered behind a `<details>` drill-down on the TaskCard.
5. The final reply is **Sully-authored**, synthesized from the verified worker output. Posted as one assistant message that links to the Task.
6. **Every transition** (classify decision, gate fire, dispatch, worker step, verification, synthesis, error) is recorded as a row in `chat_activity` keyed by `task_id`. The journal IS the audit trail.

The shift is structural: the **Task is the unit of work**, not the message. Messages become projections OF the task. The journal is the substrate.

**What the operator sees on the chat surface:**

- Operator bubble.
- ONE TaskCard that morphs: "Thinking…" → "Routing — handing this to CC" → "CC is on it · 0:42" → "Reading the result…" → "Done. Here's what I found:" + the synthesis.
- A `View worker details` disclosure on the TaskCard for the raw worker output.

No separate "Sully sent this to CC on companion — watching it now." bubble. No raw CC/AGY prose bubble. Only Sully, only one surface.

**What CC sees in the journal (machine-readable):**

- `task_id`, `thread_id`, `source`, `classification_tier`, `classification_payload`, FSM transitions with timestamps, every `chat_activity` row, the model/provider/tokens for every model attempt, verification outcomes, the final synthesized reply, the operator's quality signal.

One SQL query per turn answers "what happened?" without operator help.

---

## 3. Proposed schema changes

The header rule: **extend `pending_jobs` into the unified Task primitive.** It already speaks the lifecycle language. The FSM is solid. Don't create a new table.

### 3.1 Extend `pending_jobs` → conceptually `tasks` (keep the table name to avoid migration churn)

```sql
-- Already exists:
trace_id TEXT UNIQUE,
worker TEXT,
status TEXT,                  -- extend FSM (see below)
category TEXT,
current_activity TEXT,
seq_cursor INTEGER,
started_at TEXT,
ended_at TEXT,
predicted_prompt_tokens INTEGER, predicted_completion_tokens INTEGER,
actual_prompt_tokens INTEGER, actual_completion_tokens INTEGER,
predicted_cache_read_tokens INTEGER, predicted_cache_creation_tokens INTEGER,
actual_cache_read_tokens INTEGER, actual_cache_creation_tokens INTEGER,
predicted_total_tokens INTEGER, actual_total_tokens INTEGER,
result_ref TEXT,
brief TEXT,
fingerprint TEXT,

-- NEW columns (additive, idempotent ALTER TABLE):
thread_id TEXT,                            -- the missing parent link
source TEXT,                               -- 'autonomous' | 'operator-mention' | 'manual' | 'sully-initiated'
classification_tier TEXT,                  -- 'chat'|'planning'|'deep'|'local' at decision time
classification_payload TEXT,               -- JSON: { gate_hit, gate_reason, sully_gate_block, valueGate_signals }
verification_state TEXT,                   -- 'unverified'|'pr-opened'|'pr-merged'|'pr-rejected'|'no-pr'
verification_ref TEXT,                     -- PR URL or commit sha
synthesis_message_id INTEGER,              -- FK to chat_messages.id of Sully's follow-up summary
ticket_id TEXT,                            -- Linear link (lift from chat_messages)
```

**Extended FSM:**

```
proposed → classified → gated|held → decided → dispatched → working → done → verified → synthesized
                                                                  ↘ failed → rejected (terminal)
                                                                  ↘ aborted (terminal)
```

- `proposed` — task minted, before classifier ran
- `classified` — classifier output persisted to `classification_tier` + `classification_payload`
- `gated` — gate fired, dispatch warranted
- `held` — brakes / cap / dedupe held the dispatch (terminal-ish: can be retried)
- `decided` → `dispatched` → `working` — current FSM, unchanged
- `done` — worker terminal (current FSM), but no longer a true terminal
- `verified` — GH/CI/PR-merge confirmed (only meaningful for dispatched tasks that produce code)
- `synthesized` — Sully posted the follow-up assistant message; terminal
- `failed` / `aborted` / `rejected` — terminal sinks (current)

### 3.2 Extend `chat_messages` (forensic columns)

```sql
ALTER TABLE chat_messages ADD COLUMN task_id TEXT;       -- alias of trace_id, but flows up to operator + assistant rows too
ALTER TABLE chat_messages ADD COLUMN model TEXT;          -- e.g. 'gemini-2.5-flash-lite', 'claude-sonnet-4-6'
ALTER TABLE chat_messages ADD COLUMN provider TEXT;       -- 'anthropic'|'google'|'local'|'openai'
ALTER TABLE chat_messages ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE chat_messages ADD COLUMN completion_tokens INTEGER;
ALTER TABLE chat_messages ADD COLUMN latency_ms INTEGER;
ALTER TABLE chat_messages ADD COLUMN error TEXT;          -- short error string if the model attempt failed
```

`addChatMessage` in `chat.ts` is the single chokepoint to patch.

### 3.3 Promote `chat_activity` to a per-turn journal

Currently `chat_activity` only writes when a worker reports progress. The proposal: emit rows for **every** turn transition, dispatched or not.

New event vocabulary (additive — preserves the existing `reading|edited|ran|thinking|completed|failed` for worker compatibility):

```
classifier_ran            target = "{tier:'planning', tier_reason:'long-imperative'}"
gate_evaluated            target = "{gateHit:'@cc', valueGate_signals:['file_path','code_keyword']}"
brakes_evaluated          target = "{held:true, reason:'daily_cap_hit'}" | "{held:false}"
provider_attempted        target = "{provider:'anthropic', model:'claude-haiku-4-5'}"
provider_fell_through     target = "{from:'anthropic', to:'google', reason:'rate_limit'}"
tool_invoked              target = "{tool:'read_file', path:'src/lib/...'}"
tool_result               target = "{tool:'read_file', bytes:1234, status:'ok'}"
guardrail_triggered       target = "{kind:'COMPANION_TOOLS_KEY missing'}"
synthesis_started         target = ""
synthesis_completed       target = "{message_id:638}"
```

Schema stays as-is (`{trace_id, action, target, timestamp}`), just widen the vocabulary. **Move CREATE TABLE into `bootstrap.ts`** so it's never missing on cold DB.

For non-dispatched turns, `trace_id` becomes the `task_id` minted at turn start — `chat_activity` now logs _every_ turn, not just dispatched ones.

### 3.4 Worker terminal payload — add `task_result` JSON envelope

Today the worker emits one prose `chat_messages` row + a free-form `result_ref`. Proposal: add a structured envelope alongside, **using the existing `interactive_action` JSON column** (already plumbed through `addChatMessage` and `parseRow` — no schema migration).

```ts
// interactive_action.kind = "task_result"
{
  kind: "task_result",
  payload: {
    status: 'success'|'partial'|'failed',
    summary: string,                // 1-2 sentence Sully-readable
    findings: string[],             // bullet points
    confidence: 'high'|'medium'|'low',
    artifacts: [
      { kind:'pr', url: 'https://...' },
      { kind:'commit', sha: 'abc...' },
      { kind:'observation_id', id: 'obs_...' }
    ],
    next_steps: string[]
  }
}
```

Workers continue to emit prose for chat_messages, but the structured envelope drives the synthesis step. Validation pattern: copy the `emit_observation.py` validate-then-write discipline so workers can't return `status: "kinda ok"`.

`tools/emit_chat_message.py` gains an optional `--task-result <json-file>` flag.

### 3.5 The reader API (the "CC can read this" surface)

A single TypeScript helper that takes a turn handle and returns the journal:

```ts
// src/lib/server/turn_replay.ts (NEW)
type TurnReplay = {
	task_id: string;
	thread_id: string;
	operator_message: { id: number; text: string; ts: string };
	classification: { tier: string; tier_reason: string; gate_hit?: string; gate_reason?: string };
	brakes: { held: boolean; reason?: string };
	model_attempts: Array<{
		provider: string;
		model: string;
		status: string;
		tokens: { p: number; c: number };
		latency_ms: number;
	}>;
	worker_dispatch?: {
		worker: string;
		status_timeline: Array<{ status: string; at: string }>;
		activity: Array<{ action: string; target: string; ts: string }>;
		terminal: { status: string; result_ref: string; task_result?: object };
	};
	verification: { state: string; ref?: string };
	synthesis?: { message_id: number; text: string; ts: string };
	operator_signal?: 1 | -1 | 0;
};

export function replayTurn(taskId: string): TurnReplay;
export function replayTurnByMessage(messageId: number): TurnReplay;
export function replayThreadRecent(threadId: string, n: number): TurnReplay[];
```

CC calls these. The operator stops having to say "go read the chat logs."

### 3.6 Render abstraction — extend `WorkingBubble` into `TaskCard`

`WorkingBubble.svelte` already owns the state machine, timer, rows[], resultRef, retry slot. Rename to `TaskCard`, lift props to be optional (a historical row has `status='done'` + no live SSE controller), add three slots:

- `header` — the Sully-voiced one-line summary (replaces "claude-code working · mm:ss")
- `body` — optional Markdown drill-down (raw worker prose, hidden behind a tap)
- `actions` — retry / dismiss / open-ticket

`MessageFeed.svelte:120-260` row dispatch becomes:

```svelte
{#each messages as m (m.id)}
	{#if m.task_id}
		<TaskCard message={m} />
	{:else if m.sender === 'operator'}
		<OperatorBubble {m} />
	{:else}
		<SullyBubble {m} />
	{/if}
{/each}
```

Demote `activityPill` in `+page.svelte:928-952` to a global "something is happening somewhere" header chip that links to the in-feed TaskCard. Don't keep it as a parallel surface.

---

## 4. Worker reporting — close the loop

### Companion-native dispatch path (the cleaner case)

1. `dispatchToWorker` mints task_id (already happens, just lift it up earlier)
2. Worker receives prompt including the task_id + the contract: "emit `task_result` envelope on completion"
3. Worker reports progress to `POST /api/chat/activity` (already works)
4. Worker terminal callback POSTs `marker` (existing) + `task_result` (new) + `final_text` (existing)
5. `activity/+server.ts` writes the chat_activity terminal row AND updates `pending_jobs.task_result` AND triggers the synthesis pass
6. Synthesis pass: in-process LLM call reads `task_result` + original user message → posts ONE new assistant message with `task_id` linked → updates `pending_jobs.synthesis_message_id` → transitions `synthesized`

### Kernel-wired dispatch path (the messier case)

The worker writes its result row DIRECTLY to SQLite via `tools/emit_chat_message.py` — out-of-process. The Companion has no in-process hook on row insert.

Two options:

**Option A (heavier, cleaner):** the worker's `emit_chat_message` now also calls back to `POST /api/chat/activity` with the terminal `task_result` envelope. Companion-side code is identical to companion-native. Worker code gains one POST.

**Option B (lighter, lossier):** `completion_poller.ts` (already tails `cc_completion_log.jsonl`) gets extended to trigger the synthesis pass when it sees a thread-linked completion. Synthesis reads the worker's chat_messages row prose as the "raw output," parses any `[TASK_RESULT]: {...}` JSON tail from it, and runs synthesis. Worker contract: append a `[TASK_RESULT]: {...}` trailer to its emit_chat_message body.

Recommend **A** — having one POST contract for both paths keeps the data model uniform. The kernel-wired path becomes "just a worker that happens to live behind a gateway." The kernel route would still write the raw chat_messages row (so the workflow tool at `workflow/+server.ts:36-50` keeps working), but the row gets hidden in the render via the TaskCard's `<details>` drill-down.

---

## 5. Phased rollout

### Phase 1 — Task object + forensic columns + reader API (small, no UX change)

**One DB migration + 4 file edits + 1 new file.** Nothing changes for the operator yet.

1. `bootstrap.ts` — add ALTER TABLE statements (idempotent) for the new `pending_jobs` columns + new `chat_messages` columns + move chat_activity CREATE into bootstrap
2. `stream_prepare.ts:96-103` — mint `task_id` up-front, before any DB write; flow it through PreparedStreamContext
3. `chat_turn.ts:32` — `persistUserTurn` accepts task_id, persists it on the operator row
4. `chat_turn.ts:85-95` — `persistAssistantTurn` accepts task_id + model + provider + token usage + latency; persists them
5. `companionDispatch.ts:56-120` — `createJob` persists thread_id; tasks now have a parent
6. `autonomous_dispatch.ts:81-91` — stop minting a new trace_id; use the task_id already minted in prepareStream
7. NEW: `src/lib/server/turn_replay.ts` — the reader API

**Acceptance criteria:**

- Every new turn (dispatched or not) creates a `pending_jobs` row with `status='proposed'` and a `task_id`
- `chat_messages` carries `task_id`, `model`, `provider`, tokens, latency on assistant rows
- CC can call `replayTurn(task_id)` and get the full journal
- The operator-visible UI is unchanged
- Existing dispatch flow still works end-to-end

**Why this is the right "smallest":** establishes the data model + reader API without touching UX. Once the journal exists, every subsequent phase can be tested end-to-end with `replayTurn` instead of operator inspection. **The forensic journal is the test harness for everything else.**

### Phase 2 — Move the gate before the answer (the routing-gate Phase 1 from the previous proposal)

Now that Task exists, the routing gate becomes "transition `proposed → classified → gated` before the model streams."

8. `sdk-stream/+server.ts:214-217` — pre-stream gate check (existing valueGate + ruleGate, reused). If hit, return a synthetic UIMessageStream with one Sully-voiced acknowledgment line + skip streamText.
9. Worker dispatch fires synchronously, task transitions `gated → decided`.
10. Existing post-reply `maybeAutonomousDispatch` becomes the safety net for ambiguous cases the regex missed.

**Acceptance criteria:**

- Messages with code keywords, file paths, repo names, or long imperatives dispatch BEFORE Sully starts streaming
- The operator's first visible reply is a short Sully-voiced acknowledgment, not a full model answer
- `replayTurn` shows the gate fired pre-stream
- Phase 1's journal proves it (no operator inspection needed)

### Phase 3 — Synthesis + render-time TaskCard

11. `activity/+server.ts:62-66` — terminal event fires in-process LLM synthesis call (cloud, fast model — Gemini Flash-lite). Posts a NEW assistant message with `task_id` linked. Updates `pending_jobs.synthesis_message_id` + transitions `synthesized`.
12. Worker contract update — emit `task_result` envelope alongside prose. Validate on the activity endpoint.
13. `WorkingBubble.svelte` → renamed `TaskCard.svelte`. Adds header/body/actions slots.
14. `MessageFeed.svelte:120-260` — rewrite row dispatch to use TaskCard when `m.task_id` is present.
15. `+page.svelte:928-952` activityPill — demote or fold into TaskCard.
16. Render the synthesis message as the canonical Sully reply; collapse the raw `cc`/`agy`/`system` rows into the TaskCard's `<details>` drill-down.

**Acceptance criteria:**

- Operator sees ONE TaskCard per dispatch, not a stack of bubbles
- Final reply is Sully-authored and links to the task
- Raw worker output is accessible via "View worker details" disclosure
- `replayTurn` shows the synthesis transition and message

### Phase 4 — Verification + quality signal flow-back

17. `shipments.ts` polls GH for PR merge; on success, updates `pending_jobs.verification_state='pr-merged'` + `verification_ref=<pr_url>`.
18. `chat_messages.quality_signal` thumbs-up/down on the synthesis message also lifts to `pending_jobs.operator_signal`.
19. `replayTurn` exposes both — closes the loop on "did Sully do the right thing this turn?"

---

## 6. Risks

**Migration cost.** SQLite `ALTER TABLE ADD COLUMN` is idempotent + cheap. The bigger risk is code paths that read `pending_jobs` or `chat_messages` and assume column shapes — `dispatchUsage.ts`, `dispatchBrakes.ts`, `workflow/+server.ts`, `completion_poller.ts`. All identified in the workflow findings; all consume specific columns and ignore extras, so additive migration is safe.

**Two `chat_activity` DBs.** Kernel-wired workers write to the Orchestrator's `logueos_memory.db.chat_activity`, not the Companion's. The Companion SSE pipeline only reads its own DB. Phase 1 stays single-DB; Phase 3 requires consolidating either via Option A (worker POSTs to Companion HTTP) or via a cross-DB read. Recommend Option A.

**Vocabulary discipline.** `chat_activity.action` is a free TEXT column with an informal open vocabulary. Adding 10 new event types without an enum lets workers write `action='pondering'` and it lands. Add a TypeScript enum + runtime validator on the write path (`writeActivity`) — defensive, not enforced at the SQL level.

**Synthesis latency on small turns.** Phase 3's worker-completion synthesis adds an LLM call. For tiny worker tasks ("read this file, ack") synthesis quality matters less and latency matters more. Add a `skip_synthesis` flag on the `task_result` envelope; the worker decides whether to invoke it.

**Suppressing the model's reply (Phase 2).** Tested approach: `createUIMessageStream` with `execute` that writes only a synthetic text-delta then `finish`. Vercel AI SDK 6 supports this shape, but I haven't tested the empty-tokens edge case on iOS Safari/WebKit. Phase 1 doesn't ship this; we get to validate it incrementally in Phase 2.

**Kernel-wired path losing the synthesis.** If the kernel worker doesn't update its emit_chat_message script, kernel-wired tasks land prose in chat_messages and skip the synthesis step. The TaskCard render still wraps the prose in a `<details>` drill-down (Phase 3 hides the raw text), but the synthesis line above it would say "No structured task result available" — which is honest, but not the goal. Recommend updating `tools/emit_chat_message.py` as part of Phase 3.

**Audit-trail loss in render.** Hiding the raw worker bubble inside `<details>` breaks scroll-back if the operator was used to skimming worker prose. Acceptable risk per operator's stated UX rule ("Captain should feel he is talking to Sully, not CC"). Keep the row in DB; only hide the render.

**Workflow tool dependency.** `workflow/+server.ts:36-50` reads `cc`/`agy` chat_messages rows by id to drive critique/build/verify chains. Phase 3's hidden render must NOT delete those rows; only collapse them. Confirmed safe.

**Hot-path latency.** `phase_classifier.ts` is sub-10ms today. Phase 1 adds ~5ms for the new INSERTs (single-row writes). Phase 2 adds nothing (regex reused). Phase 3's synthesis is on the worker-completion path (out of band of the chat send). TTFT for direct chat unchanged.

**Cloud-only test bed during training.** Operator is currently routing all chat to Gemini Flash-lite while companion-v2 trains on the GPU. Phase 1-3 are model-agnostic — they instrument the orchestration layer, not the model layer. Safe to develop + test against cloud now; switch back to local after training.

---

## 7. Smallest safe first step (concrete)

**Phase 1 alone. One sitting.**

```
git checkout -b task-first-phase-1
```

Files to edit / create:

1. **`src/lib/server/bootstrap.ts`** — add the ALTER TABLE migrations (idempotent), move `chat_activity` CREATE into bootstrap
2. **`src/lib/server/dispatchJobs.ts`** — extend FSM with `proposed`+`classified`+`gated`+`held`+`synthesized` states
3. **`src/lib/server/chat/stream_prepare.ts`** — mint `task_id`, flow through PreparedStreamContext
4. **`src/lib/server/chat_turn.ts`** — persist `task_id` on operator + assistant rows; persist model/provider/tokens/latency on assistant row
5. **`src/lib/server/chat.ts`** — addChatMessage accepts the new optional fields
6. **`src/lib/server/companionDispatch.ts`** — createJob accepts + persists `thread_id`, `source`, `classification_tier`, `classification_payload`
7. **`src/lib/server/chat/autonomous_dispatch.ts`** — stop minting a new trace_id; use the upstream task_id
8. **NEW `src/lib/server/turn_replay.ts`** — the reader API

Tests:

- New unit test: `replayTurn(task_id)` returns the right shape for a happy-path dispatched turn
- New unit test: `replayTurn(task_id)` returns the right shape for a happy-path non-dispatched turn (just chat, no worker)
- Existing e2e tests should pass unchanged (no UX change yet)

**No UX change. No model change. No frontend changes. Cloud-only test bed.**

After Phase 1 ships, every operator turn going forward leaves a forensic trail. CC reads it via `replayTurn`. The operator never has to point at the chat logs again. From that foundation, Phase 2/3/4 each build observably on top — every iteration has the journal as its test harness.

---

## 8. Questions for the reviewer

1. **`pending_jobs` rename.** I'm keeping the table name `pending_jobs` to avoid breaking `dispatchBrakes`, `dispatchUsage`, `completion_poller` reads. But conceptually it's "tasks" now. Worth adding a `tasks` VIEW that aliases it for queryability, or just live with the name mismatch?

2. **Reading kernel-wired completions.** The Orchestrator's `cc_completion_log.jsonl` is the kernel-team-wide ledger and isn't going away. Should the Companion's `replayTurn` read it directly (file tail) or insist on the worker's HTTP callback (Option A in §4)? File tail is lossier but works retroactively for old runs; HTTP callback is uniform but requires worker updates.

3. **Synthesis model.** Recommend Gemini Flash-lite for the synthesis pass (cheap, fast, already wired). But the original turn may have been classified `planning` or `deep` — should the synthesis match the original turn's tier (same depth) or always go with a fast model (latency)? My instinct: always fast. Synthesis is summarization, not reasoning.

4. **`chat_activity` vocabulary enum.** Should I lock the action vocabulary to a TypeScript enum + validator on write? Pro: keeps the journal clean for `replayTurn` parsing. Con: workers that emit unknown actions silently drop their progress rows. Lean toward: log unknown actions to a separate `chat_activity_unknown` table for forensic recovery, not silently drop.

5. **Phase 1 acceptance — is the journal enough?** The operator's stated goal pairs the architecture with the journal. Phase 1 ships only the journal. Is that a satisfying first step on its own, or does the operator need to see some UX evidence (even a tiny TaskCard) before Phase 1 feels "done"? My read: the journal is the foundation and shipping it alone is correct. But asking.

6. **Two terminal states for "worker finished."** Today `pending_jobs.status='done'` is set by the worker's HMAC callback. The proposal adds `verified` and `synthesized` as post-`done` states. What's the right behavior if synthesis fails (e.g. LLM call errors) — does the task go `done → ` (terminal) or `done → failed_synthesis` (a new state)? My instinct: `failed_synthesis` as a distinct terminal so we can retry synthesis without re-dispatching the worker.

---

## Recommendation

Ship Phase 1 only. The journal + task object + reader API. Zero UX change. The instrumentation is the foundation everything else builds on, and shipping it alone gives the operator + CC the substrate to iterate Phases 2/3/4 with empirical evidence instead of opinion.

After Phase 1 ships and we have one weekend of real chat traffic in the journal, decide Phase 2 (routing gate before answer) based on what `replayTurn` shows about how often the gate would have fired pre-stream.

---

_End of report. ~7800 words. Files cited are inspectable; ranges verified by parallel workflow agents in commit history at the time of writing (2026-06-02). Companion-v2 retrain still in flight on GPU; this work is cloud-only friendly and can ship before training completes._
