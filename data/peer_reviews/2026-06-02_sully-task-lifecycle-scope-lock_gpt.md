# Sully — Task Lifecycle: Scope Lock for Phase 1

**Date:** 2026-06-02
**Project:** LogueOS-Companion (Sully — operator's personal AI companion)
**Author:** main CC (Claude Opus 4.7 via Claude Code)
**For peer review by:** ChatGPT (scope validation only — not architecture re-review)
**Status:** Scope-lock document. Predecessor docs covered architecture + investigation. This one fixes the boundary of Phase 1 before code begins.
**Predecessors:** `2026-06-02_sully-routing-gate-investigation_gpt.md`, `2026-06-02_sully-task-first-architecture_gpt.md`
**Trigger:** Operator stopped the companion-v3 QLoRA mid-run after the architectural shift made the training corpus shape wrong. GPU is freed. Need to lock Phase 1 scope before starting it.

---

## What this document is for

GPT and Captain have iterated through three layers of framing over the last few sessions:

1. **Routing gate first** — move the dispatch decision before the model reply
2. **Task-first architecture** — every operator turn becomes a Task object that wraps classify → route → dispatch → verify → synthesize
3. **Sully ≠ LogueOS replacement** — they're complementary layers; Sully owns the conversation, LogueOS owns the system, workers own execution, memory owns learning, Tasks connect everything

This document does two things:

1. Captures the **final integrated framing** in one place (so future sessions don't drift)
2. Locks the **Phase 1 scope** with explicit IN / OUT lists (so we don't start building and have it expand under us)

The previous peer-review doc went broad. This one goes narrow. The architecture is settled. The question for the reviewer is just: **is this the right starting boundary?**

---

## Final integrated framing

### The Layer Rule (GPT's framing, slightly compressed)

| Layer                                          | Owns                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Sully                                          | The conversation — Captain's only visible assistant                         |
| LogueOS                                        | The system — kernel, dispatch listener, gateway, ticket system, the team OS |
| Workers (CC / AGY / Gemini / Codex / local v3) | Execution — the actual implementation work                                  |
| Memory                                         | Learning — Tier 0 observations, Tier 2 episodic facts, operator profile     |
| Tasks                                          | The connection layer that links all of the above                            |

Sully does not absorb LogueOS. LogueOS does not surface to Captain. Workers stay invisible behind Tasks. Memory writes happen _because_ of Tasks. The Task is the queryable unit that ties every other layer together.

### The architectural shift

**From:**

```
Captain's question → Sully streams answer → autonomous dispatch fires after → worker prose appears later
```

**To:**

```
Captain's question → Task created → Sully classifies → (if dispatch needed: worker runs + verifies) → Sully synthesizes → one clean Sully reply
```

The Task object exists _before_ Sully begins answering, and every subsequent action (classification, routing decision, dispatch, worker progress, verification, synthesis, error, recovery) is a transition on that Task. The forensic journal is not a separate feature — it is the persistent state of the Task lifecycle. If the Task object is right, the journal is automatic.

### Eliminating Captain as manual relay (GPT's framing)

The system's primary purpose is not "better chat." It's eliminating this pattern:

```
Captain asks AI A → AI A asks for context → Captain copies logs → Captain pastes into AI B → AI B asks for more context → ...
```

In favor of:

```
Captain asks Sully → Sully gathers context → Sully routes work → Sully coordinates workers → Sully verifies → Sully replies
```

The Task lifecycle is the substrate that enables this. Without it, Sully can't coordinate workers because she has no persistent handle on "the thing Captain is working on right now."

### The role of the local model (companion-v3 — currently un-trained)

After Captain stopped the v3 QLoRA mid-run, the new role becomes:

- **Not** a general chat assistant alongside Gemini / Claude
- **Yes** Sully's personal routing + intent + synthesis layer — the local-first classifier that runs on every turn to decide _what kind of work this is_ and the synthesizer that turns verified worker output into a Sully-voiced final answer
- Cloud models still handle the heavy reasoning + the actual worker invocations until v3 is trained for those jobs too

What v3 needs to learn is two specific patterns:

- **Routing pairs:** `(user message, classification decision, was-it-correct?)` → teaches intent classification + worker selection
- **Synthesis pairs:** `(worker output, original question, Sully-voiced summary, operator thumbs-up/down)` → teaches the "synthesize verified work into a Sully reply" job

**Neither pair exists in Captain's past chat history.** The history shows Sully answering directly, not Sully routing then synthesizing. So even if the v2 training had completed cleanly, the resulting model would have been wrong-shape for v3's job.

This is the insight that reshapes the sequencing.

---

## The sequencing insight

The Task lifecycle is not just architecture. It is the **data factory** for v3.

Every Task that runs through the lifecycle naturally produces:

- A routing pair (Captain's message + the classification Sully made + whether the dispatch was warranted)
- A synthesis pair (the worker output + the synthesis Sully wrote + Captain's quality_signal)
- An error / recovery pair when things go wrong (which becomes the training signal for "when Sully should escalate or ask for help")

So the sequencing becomes:

1. **Ship Phase 1** — stand up the Task lifecycle in cloud-only mode. Zero GPU touch. Cloud models do classification + synthesis.
2. **Run cloud-only for some weeks** — real Tasks accumulate in the journal. Each one is a tagged training pair.
3. **Train v3 on the journal** — corpus shape now matches v3's actual job (routing + synthesis), not the general-chat shape we tried before.
4. **Cut over progressively** — v3 takes on classification first (fastest path, lowest risk), synthesis later, broader assistance only if it earns it.

Phase 1 ships first not because it's the cheapest piece of architecture, but because **it's the only path to training data that matches what v3 needs to learn.**

---

## Phase 1 scope — locked

### IN scope

Server-side only. No UX change. No GPU touch. Cloud-only chat keeps working unchanged.

**Schema migrations** (idempotent ALTER TABLE):

- `pending_jobs` extended with: `thread_id`, `source`, `classification_tier`, `classification_payload` (JSON), `verification_state`, `verification_ref`, `synthesis_message_id`, `ticket_id`
- `pending_jobs.status` FSM extended with: `proposed`, `classified`, `gated`, `held`, `verified`, `synthesized` (additive — none of the existing terminal states change meaning)
- `chat_messages` extended with: `task_id`, `model`, `provider`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `error`
- `chat_activity` CREATE TABLE moved into `bootstrap.ts` (currently lazy-created, can be missing on cold DB)

**Code changes:**

- `stream_prepare.ts` — mint `task_id` up-front, flow through `PreparedStreamContext`
- `chat_turn.ts` — persist `task_id` on operator + assistant rows; persist model/provider/tokens/latency on assistant row
- `chat.ts` — `addChatMessage` accepts the new optional fields
- `companionDispatch.ts` — `createJob` persists `thread_id`, `source`, `classification_tier`, `classification_payload`; emits a `proposed` row up-front
- `autonomous_dispatch.ts` — stop minting a new `trace_id`; use the upstream `task_id`

**New file:**

- `src/lib/server/turn_replay.ts` — the reader API. Three functions: `replayTurn(task_id)`, `replayTurnByMessage(message_id)`, `replayThreadRecent(thread_id, n)`. Returns a structured `TurnReplay` shape that CC can call after any test to answer "what happened on this turn?"

**Acceptance criteria:**

- Every new turn — dispatched or not — creates a `pending_jobs` row with `status='proposed'` and a `task_id`
- `chat_messages` carries `task_id` + model + provider + tokens + latency on assistant rows
- `chat_activity` writes for non-dispatched turns too (the existing `reading|edited|ran` vocabulary plus the additive `classifier_ran|gate_evaluated|brakes_evaluated|provider_attempted|provider_fell_through|tool_invoked|tool_result|guardrail_triggered|synthesis_started|synthesis_completed`)
- CC can call `replayTurn(task_id)` and get a complete machine-readable journal
- The operator-visible UI is unchanged
- The existing dispatch flow still works end-to-end (gate fires post-reply as today; just now the Task object exists before the gate runs)
- Existing e2e tests pass unchanged
- New unit tests cover `replayTurn` against a happy-path dispatched turn and a happy-path non-dispatched turn

### OUT of scope

Explicitly NOT in Phase 1 — these wait for Phase 2/3/4 once Phase 1 proves stable:

- The pre-stream routing gate (Phase 2 — moving the dispatch _decision_ before the model reply)
- The synthesis pass (Phase 3 — Sully-authored follow-up reading worker output)
- The TaskCard render abstraction (Phase 3 — collapsing `[system bubble][working pill]` into one card)
- The Dynamic Island status pill state machine (Phase 3 — Idle/Thinking/Routing/Dispatching/Running/Reviewing/Complete/Failed)
- Worker `task_result` envelope (Phase 3 — structured `{status, summary, findings, confidence, artifacts, next_steps}` payload)
- Verification flow-back (Phase 4 — PR merge / CI green updating `verification_state`)
- companion-v3 retraining (deferred until journal has weeks of real Tasks in it)
- Any frontend changes
- Any model-routing changes
- Memory writes triggered by Task lifecycle events (deferred — observations table already exists, wiring it to fire on every Task transition is Phase 4)

### Why this scope

Three reasons it's the right boundary:

1. **Reversible.** Phase 1 adds columns and a reader API. Rolling back is dropping the columns. No UX is at risk because no UX changed.
2. **It is the data factory.** Phase 2/3/4 each benefit from having weeks of real Tasks already in the journal before they ship — because we get to test against actual workload data instead of opinion. Same for v3 training.
3. **It is observable end-to-end without operator inspection.** The moment Phase 1 ships, CC can call `replayTurn` after every test and reason about what happened. This unblocks every subsequent iteration.

---

## Risks specific to Phase 1

Most of the risk lives in deeper phases. Phase 1 is intentionally small. The risks worth naming:

1. **`task_id` flowing through every path.** Today's code mints `trace_id` inside `maybeAutonomousDispatch` _after_ both chat rows are persisted. Phase 1 has to mint it earlier — in `prepareStream` — and thread it through `persistUserTurn` and `persistAssistantTurn`. Risk is a code path that writes a `chat_messages` row without going through `chat_turn.ts` (there are a few, including the CLI bridge's `persistAssistantTurn` call). Mitigation: audit `addChatMessage` callers; ensure all paths carry `task_id`.

2. **Empty `pending_jobs` rows for non-dispatched turns.** Every turn now creates a Task even if no dispatch ever fires. This grows the table fast. With predicted/actual tokens, brief, fingerprint, classification_payload — each row is ~1-2 KB. At 100 turns/day, that's ~200 KB/day, ~6 MB/month. Within budget. But: `dispatchBrakes.ts` queries `SELECT COUNT FROM pending_jobs WHERE started_at >= cutoff` — that query now returns the wrong number for "dispatches today" because it'll count non-dispatched Tasks too. Mitigation: brakes query filters on `status NOT IN ('proposed', 'classified', 'gated', 'held')` or equivalently `status IN ('decided', 'dispatched', 'working', 'done', 'failed', 'retry', 'aborted')`.

3. **`chat_activity` vocabulary expansion.** Phase 1 adds ~10 new event types to a free TEXT column. No SQL-level enforcement. Mitigation: TypeScript enum + runtime validator on `writeActivity` write path; unknown events log to console and still write (so workers that emit unexpected actions aren't dropped silently).

4. **Reader API correctness across two return paths.** `replayTurn` must handle both companion-native dispatches (in-process activity events) and kernel-wired dispatches (worker writes `chat_messages` directly). Phase 1 should ship with both code paths covered, even though Phase 1 itself doesn't change the dispatch flow. Mitigation: explicit test coverage for each path.

5. **No backfill.** Existing turns won't have `task_id`, model, provider, tokens, etc. `replayTurn` against pre-migration turns returns `null` for those fields. Acceptable — operator's testing the new architecture against new turns, not auditing history. Documented in the reader API's return shape.

---

## What we're NOT solving in this document

Listed explicitly so they don't sneak back in:

- The "what does v3 actually do" decomposition (router-only? router + synthesis? router + synthesis + general?) — needs separate conversation once Phase 1 has produced training data
- The training corpus shape for v3 — same, deferred
- The Dynamic Island pill design — Phase 3
- Worker output envelope schema — Phase 3
- The kernel-wired vs companion-native unification — Phase 3 (specifically the Option A vs Option B choice in the predecessor doc)
- The memory layer's role in the Task lifecycle — Phase 4 (touching memory writes from Task transitions is a separate decision)
- Anything about iOS UI

The scope is intentionally tight because the operator and I have been burned twice already this week by widening scope mid-flight (the QLoRA training run + the env-loading rabbit hole). Phase 1 ships small, observably, and proves the substrate.

---

## Questions for the reviewer

Three, down from six in the previous doc.

1. **Is the data-factory framing right?** The argument is: ship Phase 1 in cloud-only mode → real Tasks accumulate in the journal for some weeks → that journal becomes v3's training corpus. Alternative framing: Phase 1 plus a synthetic data generation pass to bootstrap training before any real Tasks exist. I think the real-Tasks path is better because the synthetic shape would have the same problem v2's corpus had (doesn't match the actual job). Asking GPT to validate that read.

2. **`pending_jobs` table extension vs new `tasks` table.** The previous doc recommended extending `pending_jobs` to keep `dispatchBrakes`, `dispatchUsage`, `completion_poller` reads working. The trade-off is that `pending_jobs` is a misleading name once it holds non-dispatched Tasks. Worth a rename + view alias, or live with the name mismatch and document it?

3. **`chat_activity` for non-dispatched turns: same table, or separate?** Phase 1 writes the new event types (`classifier_ran`, `provider_attempted`, etc.) into the existing `chat_activity` table. The pro is one query surface for `replayTurn`. The con is mixing "worker progress events" and "Sully's own thinking events" in the same table. Could split into `task_events` + keep `chat_activity` as worker-only. Asking which is cleaner.

---

## Recommendation

Lock Phase 1 to the IN list above. Reject any scope expansion that comes in during implementation. After Phase 1 has been running in cloud-only mode for ~2 weeks of real chat, look at `replayTurn` outputs across the journal and decide Phase 2 (the routing gate) based on data, not opinion.

Companion-v3 retraining stays on hold until the journal has produced enough tagged pairs to train against — likely 4-6 weeks out from Phase 1 ship. That timing also gives us room to think through the v3 decomposition (router-only vs router+synthesis vs router+synthesis+general) with real data in hand.

---

_End of scope-lock. ~2500 words. Predecessor docs cover the broader architecture; this one fixes the boundary. Companion-v3 training is paused. GPU is free. Cloud-only test bed is healthy._
