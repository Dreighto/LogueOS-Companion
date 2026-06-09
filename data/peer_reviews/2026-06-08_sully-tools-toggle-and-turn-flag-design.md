# Sully Tools Toggle + "Tools Enabled This Turn" Flag — Design

**Author:** CDX (investigation + design only — no app code changed)
**Date:** 2026-06-08
**Status:** DESIGN / proposed — not implemented
**Scope:** LogueOS-Companion (Sully). Sully-side, per-turn control of the tool surface that sits **in front of** the existing worker/gateway gating. Worker-side gating (the kernel/gateway capability registry) is **unchanged** by this design.

---

What happened: I read the Companion's actual tool-call path and the operator's design notes, and wrote a build-ready design for two things — an operator switch for which tools Sully can use, and a per-turn rule the chat code checks before it ever runs a tool.

Does it work: This is a design doc, not code — nothing was implemented or run. The design is grounded in the real files (paths + line numbers cited), and it respects the operator's hard rule that the per-turn flag can only _remove_ tools, never _grant_ one the system would otherwise deny.

What you need to do: Read §7 (the open questions) — the only thing I need from you before this can be built is the **default state** decision (default-on vs default-off) and how fine-grained you want the toggle (master switch vs per-category vs per-tool). Everything else has a recommended default baked in.

---

## 0. A note on sources

The dispatch named `docs/research/Sully_Eco_v2.md`. That file **does not exist** in the worktree or anywhere in git history — only `docs/research/Sully_Eco_reality-crossref.md` (the reality-checked correction of an earlier `Sully_Eco.md`). The crossref doc carries the exact content the dispatch pointed me at: the **"Operator design direction — Sully tools toggle"** section (lines 91–98) and the **MCP / Tools-Tax** item (§"MCP & the Tools Tax", lines 54–64, plus verdict-matrix row 9). I designed against the crossref as the authoritative source. The research anchor (**BoundaryRouter** — learn tool selection from observed solver behavior) is captured as the v2/future path in §2.2.

The operator-locked constraint from the crossref (line 98): _"turn-flag should be the **intersection**, never an escalation."_ That single sentence is the spine of this design.

---

## 1. The two "tool" surfaces — and which one this is about

Sully has **two unrelated tool concepts**. Conflating them is the easiest way to get this wrong, so pin them down first:

| Surface                        | What it is                                                                                                                                                                                                                                                                      | Where it's gated today                                                                                                                                                                           | This design touches it?       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **A. Sully's _inline_ tools**  | Tools the chat model itself calls mid-reply: `read_file`, `list_directory`, `web_search`, `web_fetch`, `deep_think`, `consult_claude` (text) + `web_search`/`web_fetch` (voice), plus always-on `baseTools` (`list_chat_threads`, `read_thread_messages`, `get_server_status`). | `allowSensitive` (funnel/key gate) in `stream_prepare.ts`; the tool object assembled at `sdk-stream/+server.ts:355`. **Local AI-SDK `tool()` defs — these do NOT pass through the MCP gateway.** | **YES — this is the target.** |
| **B. Dispatched-worker tools** | The MCP tools a _cloud worker_ (claude-code/gemini) can reach after Sully proposes/fires a dispatch via the routing layer.                                                                                                                                                      | The **kernel/gateway capability registry** (`capability_registry.py`, per-project allow-lists) — in the Orchestrator repo, not here.                                                             | **NO — stays exactly as-is.** |

The operator's instruction ("worker-side gating stays as-is — this is Sully-side, per-turn control that sits IN FRONT of it") maps cleanly: **the toggle + turn-flag govern surface A.** Surface B's gateway registry is untouched and remains the sole authority over what a dispatched worker can do.

> ⚠️ **The routing layer (`routing/decide.ts`, `turn_decision.ts`) is about surface B, not A.** `decide()` returns `Talk | Ask | Dispatch` — it routes _work to workers_, it is **not** where Sully's own `read_file`/`web_search` calls are gated. The dispatch prompt's phrase "the routing layer respects [the flag] before attempting any tool call" is therefore satisfied not inside `decide.ts` but at the **inline-tool enforcement points** (§3). The flag is _computed_ in the same shared preamble the routing decision uses (`stream_prepare.ts`), so it is fair to call it "routing-layer state" — but it is _enforced_ at the `streamText`/voice-loop boundary. This distinction is the most important finding in this doc; building it in `decide.ts` would gate the wrong thing.

---

## 2. Where the flag lives + how it's set

### 2.1 Where it lives — layered resolution (recommended)

The current code already resolves `provider` through a precedence chain in `prepareStream` (`stream_prepare.ts:247-267`: body → thread_state override → tier → companion default → fallback). **Reuse that exact pattern.** The "tools enabled this turn" value is _resolved_, not stored in one place:

```
effectiveTools(turn) =
        STATIC_SURFACE                       // what's compiled in (baseTools + sensitive)
    ∩   allowSensitiveGate                   // §1A funnel/key gate (already computed)
    ∩   operatorToggle(thread | global)      // the persistent operator choice  ← PRIMARY STORE
    ∩   perTurnOverride?                      // optional ephemeral narrow (header/body or router)
    ∩   routerInferred?                       // v2 — BoundaryRouter, narrow-only
```

Every layer can only **remove**. There is no union anywhere in the chain (this is the intersection invariant — §4).

**Primary store for the operator toggle = a per-thread column in `chat_thread_state`** (`logueos_memory.db`), added with the same idempotent `ALTER TABLE ADD COLUMN … ` / duplicate-column-swallow pattern already used for `provider_override` (`thread_state.ts:53-60`). Rationale:

- It already exists, is lazily migrated, survives restart, and is read on every turn via `getThreadState` — zero new infra.
- It is set through the existing `/api/chat/tier` PUT endpoint, which already takes partial `{ tier?, provider? }` updates (`tier/+server.ts:37-55`). Add `{ tools }`.
- Per-thread is the right _default_ grain: it matches `provider_override` and `operator_override`, and lets "tools off for this sensitive conversation" coexist with "tools on elsewhere."

**Env default (`COMPANION_TOOLS_DEFAULT`)** sets the _initial_ state when a thread has no column value — exactly like `COMPANION_LOCAL_DISABLED` / `COMPANION_DEFAULT_MODEL` in `config.ts`. This is the "default state" knob.

**Optional global override:** if the operator wants "Sully's loadout _right now_, everywhere" (not per-conversation), store it under a reserved sentinel thread row (e.g. `thread_id = '__global_tools__'`) read as a fallback between the per-thread column and the env default. Cheap, no new table. Recommended only if §7-Q4 says global is wanted.

**Rejected:** a _new_ singleton table (more migration surface than a sentinel row buys); request-body-only (lost on refresh, can't express "Sully is currently in safe mode"); env-only (too coarse — can't differ per thread, needs a redeploy to flip).

### 2.2 How it's set — operator first, router later

- **v1 (build now): operator-set, explicit.** The operator flips it; the router never changes it on its own. Two input paths, both writing the per-thread column:
  1. A `/tools …` chat command (mirrors the existing `/unlock <code>` pattern in `chat/+page.svelte:440-443`, which is the established "operator types a control command" precedent). `/tools off`, `/tools on`, `/tools web read`, `/tools none`.
  2. A small UI control (§5).
- **v2 (future, research-anchored): router-inferred, narrow-only.** Per the **BoundaryRouter** anchor, a tool-scope classifier infers the _minimal_ tool set a turn needs from intent + the `worker_runs` / routing-scorecard corpus (the same corpus the crossref §"Worth acting on" item 2 wants to close the loop on). It is wired as the `routerInferred` layer — it can only _narrow_ the operator's setting, never widen it. The natural home is a pure function beside `decide()` (e.g. `routing/tool_scope.ts`) so it's scoreable against the corpus the same way `scorecard.ts` grades `decide()`. **Not in v1** — v1 ships the explicit flag and the enforcement; v2 makes the flag smart.

---

## 3. The enforcement point — refuse, never silently drop

The flag is enforced as **two cooperating gates sharing one predicate** `isToolEnabled(gate, name)`:

### Gate 1 — assembly-time narrowing (the Tools-Tax win)

Omit disabled tools' _schemas_ from the tool object so they never ship to the model. This is what actually shrinks the context surface (the crossref's whole Tools-Tax motivation).

- **Text path — `src/routes/api/chat/sdk-stream/+server.ts:355`.** Today:

  ```ts
  const tools = allowSensitive ? { ...baseTools, ...getSensitiveTools() } : baseTools;
  ```

  Becomes:

  ```ts
  const fullSurface = allowSensitive ? { ...baseTools, ...getSensitiveTools() } : baseTools;
  const tools = filterToolsByGate(fullSurface, toolGate); // intersection, never adds
  ```

  Note the order: `allowSensitive` runs **first**, then the gate intersects the already-narrowed surface. The gate physically cannot re-introduce a sensitive tool over the public funnel.

- **Voice path — `voice_tools.ts` + `voice-reply/+server.ts:122`.** Pass the resolved enabled-set into `runVoiceToolLoop`; filter `VOICE_TOOL_SCHEMAS` (`voice_tools.ts:18-48`) down to the enabled names before offering them at each step (`voice_tools.ts:153`).

### Gate 2 — execution-time refusal (never silently drop)

A model can still emit a tool_call for a disabled/forgotten name — from hot-window history, the system prompt, or hallucination. The voice path is especially exposed because it parses **inline-JSON** tool calls (`voice_tools.ts:62-80`) that bypass schema validation. So the dispatch of a tool call must check the gate and, when a name is not enabled, **return a structured refusal as the tool result** — which Sully then relays — instead of dropping it or letting the SDK throw an opaque `NoSuchToolError`:

- **Text:** wrap tool execution so a call to a not-enabled name resolves to `{ error: 'tool "X" is turned off for this turn — tell the operator they can re-enable it' }`. In AI-SDK v5 this is cleanest via `experimental_repairToolCall` / an `onError` mapping, or by registering disabled tools as thin **tombstone** `tool()` defs whose `execute` returns the refusal. (Tombstones cost a little schema; recommend tombstones **only** for the highest-value tools and omit the rest — most disabled tools just vanish from the surface and the system-prompt clause keeps Sully honest. See §7-Q3.)
- **Voice:** `execTool` (`voice_tools.ts:82-105`) already returns `{ error: 'unknown tool X' }` for unknowns. Extend the same branch to the _disabled_ case: `if (!isToolEnabled(gate, name)) return JSON.stringify({ error: 'tool X is turned off right now' })`. The loop already feeds tool results back to the model (`voice_tools.ts:202`), so Sully will speak the refusal naturally.

### Gate 0 — keep the system prompt honest

`chat_prompt.ts` already conditions the tool description block + fact-check discipline on `allowSensitive` (`chat_prompt.ts:123,152`; `FACT_DISCIPLINE_WORLD` vs `FACT_DISCIPLINE_WORLD_NOWEB` at lines 86-92). **Extend the same mechanism to the resolved gate**, not just `allowSensitive`: the prompt must describe _exactly_ the tools enabled this turn, so Sully neither offers a capability she lacks nor refuses one she has. This is the difference between "I can't look that up right now" (correct) and silently failing.

> 🔎 **Sharp interaction — fact routing.** `sdk-stream/+server.ts:334` force-routes a `world_fact` turn to a strong fact model _and assumes `web_search` is attached_. If the gate disables `web_search`, that branch must (a) **not** select the fact model, and (b) fall to the `FACT_DISCIPLINE_WORLD_NOWEB` honesty clause. The gate decision must be visible at line 334. Miss this and the operator gets a fact model with no web tool, fabricating URLs — the exact failure the fact-routing was built to prevent.

---

## 4. Composition with gateway gating — intersection, never escalation

Three concrete guarantees, each enforceable and testable:

1. **Set algebra is intersection-only.** `filterToolsByGate` is implemented as `Object.fromEntries(Object.entries(surface).filter(([name]) => isToolEnabled(gate, name)))`. There is no code path that _adds_ a key. A configured flag naming a tool that isn't in `surface` is **silently ignored** (it is not a grant — it can't be, the key isn't there to keep).

2. **Ordering enforces subordination to the existing gate.** `allowSensitive` is computed and applied before the toggle (§3 Gate 1). The toggle operates on the post-`allowSensitive` surface, so it is structurally incapable of re-enabling a tool the funnel/key gate removed. Public-funnel visitors get `baseTools` only, regardless of any toggle value.

3. **The dispatched-worker gateway is never consulted or modified by this flag.** Surface A (Sully's inline tools) and surface B (worker MCP tools) are disjoint. The flag governs A. When Sully proposes/fires a dispatch, surface B is still gated solely by the kernel/gateway capability registry. The flag can at most _prevent Sully from proposing a dispatch_ (if dispatch-proposal is itself brought under the flag — §7-Q5); it can never raise a worker's ceiling.

**Invariant + test:** add a unit test asserting `resolveToolGate(...).enabled ⊆ staticSurfaceNames` for every layer combination, and a property test that no `(env, thread, override, allowSensitive)` tuple yields a tool absent from the base surface. Mirror `routing/scorecard.ts`'s table-driven style. Fail-closed: an unparseable/empty stored value resolves to the **default**, never to "all tools."

---

## 5. The operator toggle UX — minimal viable

Two grades; ship 5a, add 5b if wanted:

- **5a — `/tools` command (cheapest, zero new components).** Parsed in `chat/+page.svelte` alongside `/unlock`. `PUT /api/chat/tier { tools: <value> }`, then reflect the new state in the thread (a toast/system line: "Tools: web + read only"). This alone satisfies "operator can flip Sully's loaded tools."
- **5b — composer/settings control.** A "Tools" affordance in the model-picker/settings area the chat page already has (it already GETs `/api/chat/tier` and reflects `provider_override` — `chat/+page.svelte:423-428,542-555`). Minimum: a master **Tools on/off** switch. Better: a small set of **category chips** (`web`, `files`, `consult`) so the operator narrows by group without per-tool fiddling. Same PUT endpoint.

**Surfacing the current state:** show the active loadout where the model/provider is shown, so "what can Sully do right now" is always visible — this is also what keeps the operator from being surprised by a refusal.

**Default state (recommended, pending §7-Q1):** **default-ON for the operator's own devices** (tailnet or `/unlock`'d), which preserves today's behavior exactly and means the flag only ever _narrows_ from the status quo — no regression risk on rollout. Public-funnel default is unchanged (sensitive tools already off). `COMPANION_TOOLS_DEFAULT` lets the operator flip the global default to "safe" without a code change.

---

## 6. File-by-file implementation plan (DO NOT IMPLEMENT — reference for the build ticket)

| #   | File                                              | Change                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **`src/lib/server/routing/tool_gate.ts`** _(new)_ | Pure module: `ToolGateDecision` type; `resolveToolGate({ envDefault, threadValue, globalValue, perTurnOverride, allowSensitive }): ToolGateDecision`; `isToolEnabled(gate, name)`; `filterToolsByGate(surface, gate)`. No side effects (mirrors `decide.ts`). Fail-closed parse → default. |
| 2   | **`src/lib/server/thread_state.ts`**              | Add `tools_enabled TEXT NULL` via idempotent `ALTER TABLE` (copy the `provider_override` block, `:53-60`); add field to `ThreadState` + the default objects; add `setToolsEnabled(threadId, value)` (copy `setProviderOverride`, `:156-175`).                                              |
| 3   | **`src/lib/server/chat/stream_prepare.ts`**       | In `prepareStream`, after `allowSensitive` (`:301`), call `resolveToolGate(...)`; add `toolGate` (+ a resolved `enabledTools` set) to `PreparedStreamContext` (`:157-188`). Thread it through `prepareTurnLifecycle` (`:98`) so the voice path gets it too.                                |
| 4   | **`src/routes/api/chat/sdk-stream/+server.ts`**   | Line **355**: intersect the assembled surface with `toolGate` (§3 Gate 1). Line **334**: make the `world_fact` fact-routing branch respect `web_search`-disabled (§3 sharp interaction). Add Gate-2 refusal (tombstones or `experimental_repairToolCall`).                                 |
| 5   | **`src/lib/server/chat/voice_tools.ts`**          | `runVoiceToolLoop` accepts `enabledTools`; filter `VOICE_TOOL_SCHEMAS` before offering (`:153`); `execTool` refuses disabled names with an `{ error }` result (extend `:101`).                                                                                                             |
| 6   | **`src/routes/api/chat/voice-reply/+server.ts`**  | Pass `enabledTools`/`toolGate` into `runVoiceToolLoop` (`:122`).                                                                                                                                                                                                                           |
| 7   | **`src/lib/server/chat_prompt.ts`**               | Gate `SENSITIVE_TOOLS_CLAUSE` (`:123`) and the fact-check clause (`:102-109`) on the **resolved gate**, not just `allowSensitive`; list the enabled tools so Sully is accurate (§3 Gate 0).                                                                                                |
| 8   | **`src/routes/api/chat/tier/+server.ts`**         | PUT accepts `{ tools }` (validate; copy the `provider` branch `:48-55`); GET returns `tools_enabled` (`:21-27`).                                                                                                                                                                           |
| 9   | **`src/routes/chat/+page.svelte`**                | `/tools` command parse (mirror `/unlock`); optional toggle/chips UI (§5b); reflect state from the GET `/api/chat/tier` it already calls.                                                                                                                                                   |
| 10  | **Tests** _(new)_                                 | `tool_gate` unit/property tests for the intersection invariant (§4); an enforcement test that a disabled tool yields a refusal result, not a silent drop, on both paths.                                                                                                                   |

**Build order:** 1+2 (state + pure gate) → 3 (wire into preamble) → 4/5/6 (enforce) → 7 (prompt) → 8/9 (operator control) → 10 (tests alongside). Steps 1-7 are shippable as "flag exists + enforced, default-on" before any UI, so the risky part (enforcement) lands and is verified before the operator-facing surface.

---

## 7. Risks + open questions

- **Q1 — default-on vs default-off (NEEDS OPERATOR DECISION).** Recommend **default-on for operator devices** (no behavior change on rollout; flag only narrows). Default-off would be safer-by-construction but silently breaks every existing tool-using flow until the operator re-enables — a worse first impression and a support cost. _This is the one decision blocking the build._
- **Q2 — granularity (NEEDS OPERATOR DECISION).** Master on/off (simplest), per-category (`web`/`files`/`consult` — recommended sweet spot), or per-tool (most control, most UI). The `tools_enabled` column value shape follows this choice (a bool, a category list, or a tool-name list). I'd build per-category.
- **Q3 — refusal mechanism.** Tombstone tools (explicit refusal, costs a little schema) vs omit-and-rely-on-prompt (cheaper, leans on Gate 0). Recommend: omit for most, system-prompt clause for honesty, and a tombstone only if a specific tool keeps getting hallucinated. Revisit if telemetry shows silent-call attempts.
- **Q4 — per-thread vs global toggle.** Per-thread is the recommended default (matches `provider_override`). Add the `__global_tools__` sentinel row only if the operator wants one switch for "Sully's loadout everywhere."
- **Q5 — is _dispatch_ a tool the flag gates?** Today dispatch happens via `applyTurnDecision` after the routing gate, **not** as an inline `tool()` call — so it's outside surface A. Decide whether "tools off" should also suppress Sully's ability to _propose/fire a dispatch_. Recommend: v1 leaves dispatch on the routing gate (out of scope); document it so it's a deliberate choice, not an oversight.
- **Q6 — voice-mode interplay.** Voice is a separate enforcement path (Ollama-native loop + inline-JSON parse). The inline-JSON path (`voice_tools.ts:62`) bypasses schema validation, so Gate 2 (execution-time refusal) is **mandatory** there — assembly-time omission alone is insufficient. Called out in §3.
- **Q7 — fact-routing interaction.** Covered in §3 (the sharp interaction box). If `web_search` is off, the `world_fact` branch must not pick the fact model and must use the NOWEB honesty clause. This is the highest-risk silent-failure if missed.
- **Q8 — system-prompt sync drift.** If Gate 0 isn't kept in lockstep with the resolved surface, Sully will lie about her capabilities (offer a disabled tool or refuse an enabled one). The fix is to derive the prompt clause from the _same_ `toolGate` object the enforcement uses — single source of truth, no second list to maintain.
- **Q9 — the COMPANION_TOOLS_KEY bypass.** The flag must never become a way around the funnel gate. Enforced structurally by applying `allowSensitive` before the toggle (§4 guarantee 2) — but worth an explicit test so a future refactor can't reorder it.
- **Q10 — v2 router-inferred calibration.** When BoundaryRouter-style inference lands, it must be calibrated against `worker_runs` outcomes and remain narrow-only. Wire it as a layer that can only intersect; never let an inference _widen_ the operator's setting. Ties to the crossref's "close the routing loop" item.

---

## 8. One-paragraph summary

Sully has two tool surfaces; this design touches only the **inline** one (the tools the chat model calls itself), and leaves the dispatched-worker gateway registry untouched. The "tools enabled this turn" value is **resolved** in `stream_prepare.ts` through the same precedence chain `provider` already uses (env default → per-thread `chat_thread_state` column → optional per-turn override → optional v2 router inference), and **enforced** at the inline-tool boundary — _not_ in `decide.ts`, which gates worker dispatch, a different surface. Enforcement is two gates sharing one predicate: omit disabled schemas at assembly (the Tools-Tax win) and return a structured refusal at execution (never silently drop), with the system prompt kept honest from the same gate object. The intersection invariant is guaranteed by construction: `allowSensitive` runs first, the toggle only filters the already-narrowed surface, no code path ever adds a tool, and unknown tool names in a stored flag are ignored rather than granted. The only thing blocking the build is the operator's call on default-on vs default-off and how fine-grained the toggle should be.
