# Plan C (Task Mutation) — scope + refactor audit brief

**Date:** 2026-06-04 · **For:** operator review + parallel audit by CC (me) and AGY · **Status:** scoped; audit/refactor proposal requested BEFORE implementation.

---

## Plan C scope (the active-task conversation problem)

**The problem (operator):** while a task is running, the Captain keeps talking. Sully must clearly decide whether the new input should **attach to the current task**, **create a sibling task**, or stay **conversational-only** — and must **never silently mutate running work.**

**The locked behavior (spec Contract 2 + ATTACH timing rule):**

- When a task is active on the thread, a **Mutation Gate** runs FIRST: `ATTACH_TO_CURRENT_TASK` / `CREATE_SIBLING_TASK` / `CONVERSATIONAL_ONLY`.
- `CONVERSATIONAL_ONLY` falls through to the normal Intent Gate (answer / suggest / mint).
- **ATTACH is only legal pre-dispatch** (`CREATED`/`CLASSIFIED`/`AWAITING_APPROVAL`). Once `DISPATCHED`/`RUNNING`, an ATTACH is NOT injected into the in-flight pipeline — it's queued as a follow-up after the task completes, or offered as a sibling. **Never silently dropped, never silently injected.**
- Ambiguous → Sully ASKS ("add to the running task, or start a separate one?") — a SUGGEST_INVESTIGATION routing proposal.
- At most one open proposal per thread.

**Current-state findings (grounded):**

- **No active-task awareness in the turn pipeline.** `prepareStream()` (`stream_prepare.ts`) mints a fresh `task_id` EVERY turn and classifies independently; `maybeAutonomousDispatch()` runs `decide()` with no knowledge of a task already running on the thread. There is **no** "is a task active on this thread?" query wired into the entry path.
- Active-task data exists but isn't used for gating: `dispatchJobs.ts` has `listInFlight()` (all `decided/dispatched/working/retry`), `getJobsForThread(threadId)`, `getPendingProposal(threadId)` — but nothing composes them into a per-thread "active task + its current state" check at turn entry.
- **Three entry points** reach the turn pipeline: `api/chat/sdk-stream/+server.ts` (modern), `api/chat/voice-reply/+server.ts` (voice), and the legacy `api/chat/+server.ts` (the ~530-line god-handler, half-migrated per the 2026-06-02 audit). The Mutation Gate must apply to all (I2 — one pipeline) without being bolted on three times.
- `decide()` (`routing/decide.ts`) is the Intent Gate; the Mutation Gate is a NEW layer that runs before it when a task is active.

**Plan C domain (files the refactor/audit should consider):** `src/lib/server/chat/stream_prepare.ts`, `src/lib/server/chat/autonomous_dispatch.ts`, `src/lib/server/routing/decide.ts` (+ a new `routing/mutationGate.ts`), `src/lib/server/dispatchJobs.ts` (a new `getActiveTaskForThread(threadId)` query), the three entry points, `src/lib/server/chat_turn.ts` (per-turn `mintTaskId`).

---

## Audit + refactor brief (same brief given to CC and AGY)

**Question:** Before implementing Plan C's Mutation Gate, audit the turn-entry pipeline + active-task handling and **propose a refactor** that lets us cleanly add attach/sibling/conversational classification — applied uniformly across all entry points — with a hard guarantee of **no silent mutation of running work**. Keep it shippable and incremental; respect the load-bearing parts the 2026-06-02 audit flagged as do-not-touch (run-mode config matrix, the `chat_turn`/`stream_prepare`/`chat_prompt` extractions, hot-window ordering, the brakes chain).

**Deliver:**

1. **Findings** — the concrete structural issues that make adding the Mutation Gate hard today (per-turn task minting, no active-task query, three entry points, the legacy handler, where state-awareness is missing).
2. **Refactor proposal** — the specific, minimal changes to prepare the ground: where the Mutation Gate slots, how "active task + its state" is detected once and shared, how all three entry points get it without triplication, and how the ATTACH-pre-dispatch-only / queue-or-sibling rule is enforced structurally (not by convention).
3. **The no-silent-mutation guarantee** — exactly how the design makes it _impossible_ to inject into or drop a running task's work silently.
4. **Risks + sequencing** — what could regress, what to do first, what to defer.
5. **Scope check** — is this one refactor, or should it split (e.g. entry-point unification vs the Mutation Gate itself)?

Output a concise proposal (findings → refactor → guarantee → risks/sequencing). Do NOT implement — this is a proposal for the operator to approve first.

---

## Results — CC (multi-agent audit) vs AGY (`..._agy.md`), + recommendation (2026-06-04)

Both audits independently reached the **same core diagnosis**:

| Point | CC | AGY |
|---|---|---|
| No per-thread active-task query → add `getActiveTaskForThread(threadId)` | ✅ | ✅ |
| Classification must run **before** the reply (today `decide()` runs post-reply in `maybeAutonomousDispatch`) | ✅ | ✅ |
| 3 entry points (sdk-stream / voice-reply / legacy) diverge → apply the gate **once**, no triplication | ✅ | ✅ |
| ATTACH-pre-dispatch-only enforced **structurally by the task's FSM state**, not by trusting the model | ✅ (`PRE_DISPATCH_STATES` derived from `TRANSITIONS`) | ✅ (clamp ATTACH out when state is dispatched/working/retry) |
| **Split into two refactors** | ✅ | ✅ |
| Latency of classify-before-reply (use a fast path/model) | ✅ | ✅ |

**Where they diverge — the split:**
- **AGY:** Refactor A = lift the **Intent Gate reorder** (move `decide()` before the stream — i.e. Plan D's I4 fix) FIRST as the prerequisite; Refactor B = the Mutation Gate on top. *Folds Plan D's reorder into Plan C's foundation.*
- **CC:** Refactor 1 = **behavior-neutral substrate** (migrate voice-reply onto `prepareStream`, bring the legacy route into the task lifecycle, add the primitive) — *zero behavior change*; Refactor 2 = the Mutation Gate (slots into `prepareStream`, which already runs pre-stream). CC **keeps Plan D (the reorder) + the legacy-routing migration as separate later work**, so Plan C's risky behavior rides on a verified, behavior-neutral base.

**Unique to CC** (deeper risk coverage): the fire-and-forget **double-ATTACH race** → `BEGIN IMMEDIATE` around read+classify+write; **stale-job-as-active-task** → ensure `reapStaleJobs` self-clears a dead worker; a **`proposal_type` discriminator** so the Contract-2 routing-ask isn't conflated with a dispatch proposal + an `isRoutingAnswer()` detector; a **queue-after-complete** deferral (terminal-handler re-injection) so an ATTACH-on-running is *persisted as deferred work, never dropped*.

**Unique to AGY** (worth folding in): a hard **`dispatchToWorker` rejects any payload update for a task past the `dispatched` boundary** — an API/DB-level invariant that complements the FSM-state read (belt-and-suspenders against mid-flight mutation).

### Recommendation (CC)
Go with **CC's incremental split** — it matches the operator's stability + "no silent mutation" priorities and keeps Plan C scoped to the active-task problem (not the Plan D reorder):
1. **Refactor 1 — substrate (behavior-neutral):** `getActiveTaskForThread` + `PRE_DISPATCH_STATES`/`RUNNING_STATES`; migrate voice-reply → `prepareStream`; bring legacy `/api/chat` into the task lifecycle (pass a `taskId`). Ships with **zero behavior change**, mechanically reviewable.
2. **Refactor 2 — the Mutation Gate (Plan C behavior):** pure `mutation_gate.ts`; gate as a required step in `prepareStream`; `proposal_type` + `isRoutingAnswer`; queue-after-complete deferral; the `BEGIN IMMEDIATE` race fix. **Add AGY's hard invariant:** `dispatchToWorker` rejects post-`dispatched` payload mutations.
3. **Keep separate (NOT Plan C):** the Plan D classify-before-stream reorder (AGY's "Refactor A") and the full legacy-handler routing migration.

The no-silent-mutation guarantee is structural three ways: (a) ATTACH legality is an FSM-state read derived from `TRANSITIONS`; (b) the gate is a non-optional field of `PreparedStreamContext` (can't be skipped — compile-enforced); (c) every outcome is a DB write (answer / mint-sibling / persist-a-deferral) inside one atomic transaction — nothing is silently injected or dropped, and AGY's dispatch-API rejection backstops it.

**Awaiting operator approval of the refactor direction before writing the Plan C implementation plan.**
