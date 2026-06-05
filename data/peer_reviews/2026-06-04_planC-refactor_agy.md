# Plan C (Task Mutation) — Refactor Proposal

## 1. Findings (Current State)
Based on an audit of the turn-entry pipeline and active-task handling, here are the structural issues blocking Plan C:
- **Late Classification (Violates I4):** The Intent Gate (`decide()`) is currently called inside `maybeAutonomousDispatch()` during the `onFinish` callback of the stream (e.g., in `sdk-stream/+server.ts:489` and `voice-reply/+server.ts:147`). Classification happens *after* the answer streams, making it impossible to short-circuit the stream for a "short status only" response or prevent chat contradictions.
- **Unconditional Task Minting:** `stream_prepare.ts` and other entry points unconditionally call `mintTaskId()` and `persistUserTurn()` before any routing logic runs. This creates a new `proposed` task row for every turn, which fragments the thread if the operator intended to `ATTACH` to a running task.
- **No Active Task Context:** `dispatchJobs.ts` provides `listInFlight()` and `getJobsForThread()`, but no cheap, definitive `getActiveTaskForThread(threadId)` query. Turn entry logic operates blindly with respect to running tasks.
- **Three Entry Points Diverge:** While `stream_prepare.ts` unifies some setup for `sdk-stream`, the legacy `+server.ts` handles dispatch and Hermes locally, and `voice-reply` duplicates the turn lifecycle. To avoid triplicating the Mutation Gate, the gate must be pushed down into a shared path.

## 2. Refactor Proposal (Minimal Changes)
To implement Plan C cleanly and uniformly, I propose the following specific changes:

**A. New Data Query:**
- Add `getActiveTaskForThread(threadId)` to `dispatchJobs.ts`. It will return the most recent non-terminal task (`proposed`, `classified`, `gated`, `held`, `decided`, `dispatched`, `working`, `retry`).

**B. Slotting the Gates (Centralization):**
- Move both the Mutation Gate and Intent Gate *upstream* into a single shared service layer, replacing the current `classifyAndTouchThread` in `chat_turn.ts`. Let's call it `processTurnIntent()`.
- `processTurnIntent()` will:
  1. Call `getActiveTaskForThread()`.
  2. If an active task exists, run the Mutation Gate (passing the text and the task's state).
  3. If no active task exists or the Mutation Gate yields `CONVERSATIONAL_ONLY`, run the Intent Gate (`decide()`).
- All three entry points (`sdk-stream`, `voice-reply`, legacy) will call `processTurnIntent()` *before* generating their replies (satisfying I4).
- `maybeAutonomousDispatch` will be stripped of `decide()` and simply execute the dispatch if the upstream gates resolved to `MINT_OR_UPDATE_TASK`.

**C. Structural Enforcement of ATTACH Pre-Dispatch Only:**
- The Mutation Gate will not rely on the LLM to obey the timing rule. Instead, the function `evaluateMutationGate(text, taskState)` will wrap the LLM call.
- Inside `evaluateMutationGate`, if `taskState` is `dispatched`, `working`, or `retry`, the function will **hardcode** the prompt to exclude the `ATTACH` option, or programmatically override an `ATTACH` output to `CREATE_SIBLING_TASK` (or queue it). The type signature will enforce this: `evaluateMutationGate` returns `ATTACH` *only* if the provided state is pre-dispatch.

**D. Task Minting Deferral:**
- `mintTaskId()` must be deferred or conditionally applied. If the gate resolves to `ATTACH_TO_CURRENT_TASK`, `persistUserTurn` must link the user's chat row to the *existing* active `task_id` rather than a newly minted one.

## 3. The No-Silent-Mutation Guarantee
We guarantee no silent mutation of running work through **structural clamping**:
1. The `evaluateMutationGate` function explicitly requires the active task's `JobStatus` as an argument.
2. If `JobStatus` reflects an in-flight state (`dispatched`, `working`, `retry`), the router code strictly strips `ATTACH_TO_CURRENT_TASK` from the allowed returns. Even if the LLM hallucinates an intent to attach, the typescript function will throw or clamp it to a sibling task or a queue operation.
3. The `dispatchToWorker` API will be updated to reject any payload updates for a `task_id` that has already crossed the `dispatched` boundary. This is a hard DB-level/service-level invariant that prevents mid-flight payload mutations.

## 4. Risks & Sequencing
**Risks:**
- **Latency regression:** Moving classification *before* the answer stream (for I4) means the user must wait for the LLM classifier (Mutation/Intent gates) to return before seeing the first token. (Mitigation: use the fastest available model, e.g., Haiku/Flash, for the routing gates).
- **Legacy Endpoint Breakage:** The legacy `+server.ts` has a heavily customized local dispatch loop. Integrating `processTurnIntent()` requires careful untangling of its current manual `worker = 'claude-code'` heuristic.

**Sequencing (Incremental Plan):**
1. **Phase 1 (Data & Query):** Add `getActiveTaskForThread()` to `dispatchJobs.ts` and `evaluateMutationGate()` wrapper with the structural clamping logic.
2. **Phase 2 (Lifecycle Shift):** Refactor `chat_turn.ts` to `processTurnIntent()` and lift the `decide()` logic upstream out of `maybeAutonomousDispatch`. Update all three entry points to use this new order without breaking the streams.
3. **Phase 3 (Mutation Integration):** Wire the Mutation Gate into `processTurnIntent()`, handle the `ATTACH` routing (reusing `task_id`), and implement the "short status only" stream short-circuit.

## 5. Scope Check
This should be **split into two refactors**.
1. **Refactor A (The Pre-requisite I4 Shift):** Lift the Intent Gate (`decide`) out of `maybeAutonomousDispatch` and into the shared pre-stream phase (`chat_turn.ts`). Address the latency and entry-point unification first.
2. **Refactor B (The Mutation Gate):** Introduce `getActiveTaskForThread`, the `evaluateMutationGate` function, and the structural clamping. Wire it into the newly unified pre-stream pipeline.

Trying to do both in one pass risks breaking the delicate streaming logic across three divergent endpoints. Splitting them keeps the system shippable and tests the pre-stream latency impact of the Intent Gate before adding the Mutation Gate.
