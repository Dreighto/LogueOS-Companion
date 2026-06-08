# Sully_Eco.md — Reality Cross-Reference & Corrections

**What this is:** a section-by-section check of `docs/research/Sully_Eco.md` (an AI-generated architecture report) against what LogueOS/Sully **actually** runs today, with corrections. Verified against code on 2026-06-08 — not from memory. Citations are real file paths.

**TL;DR:** the doc is directionally sound and describes patterns we've largely already converged on — but it's a _generic best-practices essay_, not a description of our system. Several of its "recommendations" we already implement (often better, for our constraints); a few it gets factually wrong about us; and **two** of its points are genuinely actionable: (1) the MCP **Tools Tax / progressive disclosure** gap, and (2) **closing the routing learning-loop** (we collect the corpus but don't yet route from it).

---

## Verdict matrix

| #   | Research claim                                                                                                                          | Our reality                                                                                                                                                                                         | Status                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Sully = local surface model + manager; don't blind-dispatch                                                                             | `routing/decide.ts` 3-class Talk/Ask/Dispatch, **ask-before-dispatch**                                                                                                                              | ✅ ALIGNED (built)                           |
| 2   | Best local model for the router = **Hermes 4 14B** (dual-mode reasoning)                                                                | Sully runs **`companion-v1:latest`** (custom fine-tune); Hermes 4 14B is on disk but unused as primary                                                                                              | ⚠️ CORRECTION + open question                |
| 3   | Pooled corpus refines routing thresholds over time (PEEPLL/confidence)                                                                  | We **log** the corpus (`worker_runs`, `hermes_predictions.jsonl`) + run a **shadow predictor**, but the live gate is **static regex**                                                               | 🟡 GAP (data yes, loop no)                   |
| 4   | Memory: 3 tiers, `agents.md`, **SQLite FTS5 + LLM summarization**, skills-as-YAML                                                       | Tiered memory exists (hot-window + L1 summary + L3 facts) + `CLAUDE.md/AGENTS.md` + Claude skills; **no FTS5**                                                                                      | 🟡 PARTIAL (FTS5 absent)                     |
| 5   | Semantic/vector routing is broken → use a **TLM (LLM-as-classifier, JSON)**                                                             | We already **avoid** vector routing; we use deterministic gates + an optional model-vote (`SULLY_GATE`)                                                                                             | ✅ ALIGNED (+ partial TLM)                   |
| 6   | Orchestration: **LangGraph state-machine** > CrewAI persona                                                                             | We use **neither** — a custom deterministic dispatch listener (worktrees, HMAC, DLQ, watchdogs) that embodies the LangGraph _philosophy_                                                            | ✅ DIVERGE-BY-DESIGN (don't adopt LangGraph) |
| 7   | Patterns: Parallelization / Evaluator-Optimizer / Orchestrator-Workers                                                                  | All present informally (Workflow tool; **CC-verify = Evaluator-Optimizer**; kernel = Orchestrator-Workers)                                                                                          | ✅ ALIGNED (informal)                        |
| 8   | MCP universal adapter, shared tools, local stdio security                                                                               | logueos-gateway + many MCP servers; per-project capability registry; gatekeeper isolation                                                                                                           | ✅ ALIGNED                                   |
| 9   | **Tools Tax** (>50 tools bloats context) → **Progressive Disclosure** (`get_tool`/`invoke_tool`, semantic gateway, dynamic hide/expose) | Gateway exposes ~60 tools via **static per-project allow-lists** (`capability_registry.py`); **no dynamic get_tool/invoke_tool**. Claude Code has client-side deferral (ToolSearch); GMI/AGY do not | 🔴 GAP — **the one you flagged**             |
| 10  | Security: Full-Schema Poisoning / Rug Pulls → containerize + validate tool outputs                                                      | Gatekeeper + fail-closed registry + `github_write` isolation (LOS-154); MCP servers **not** containerized; no output-revalidation loop                                                              | 🟡 PARTIAL                                   |

---

## Section-by-section corrections

### Local model (doc §"Evaluating the Foundation")

- **Doc says:** Hermes 4 14B is the superior router foundation; Qwen 3.5 9B for constrained laptops.
- **Reality:** Sully = `companion-v1:latest` (custom fine-tune; `src/lib/server/config.ts:51`). We have `hermes4:14b`, `qwen3:14b` (was primary), `qwen2.5:7b` (shadow predictor) installed but companion-v1 is the live surface model. The doc's Hermes-4 case (dual-mode `<think>` for self-triage, length-control to curb verbosity) is a **legitimate open question** worth A/B-ing companion-v1 vs Hermes-4-14B _for the routing/triage role specifically_ — but note our triage today is mostly deterministic, so the model choice matters less for routing than the doc implies, and more for the _light-task-handled-locally_ half.
- **Correction:** the doc's hardware figures are off/inconsistent (it claims Gemma-4-12B "consumes roughly 74GB" twice as if normal — that's a misread of a max-context stress test, not a deployment profile). Don't size hardware from this doc.

### Continuous learning / pooled corpus (doc §"Distributed Lifelong Learning")

- **Doc says:** every dispatch logged; confidence scores (VAE/PEEPLL) refine the local-vs-dispatch threshold automatically.
- **Reality:** we **have the substrate** — `data/logueos_memory.db` `worker_runs` (per-dispatch outcomes), `data/hermes_predictions.jsonl` (shadow predictions via `predictDispatchAsync` in the listener), the **routing scorecard** (`src/lib/server/routing/scorecard.ts`, currently 95.9%/49 cases), and a QLoRA labeling corpus. **But the live decision (`valueGate` regexes in `decisionGate.ts`) is static** — nothing reads `worker_runs` to adjust thresholds. We are in **shadow mode**, not closed-loop.
- **This is the highest-value real gap.** PEEPLL/VAE is overkill; the pragmatic path is: promote the shadow predictor (or the scorecard) from _measuring_ to _gating_ (e.g., model-vote becomes mandatory on the local path, calibrated against `worker_runs` outcomes).

### Memory (doc §"Bridging the Empathy Gap")

- **Reality:** per-turn context is assembled server-side in `stream_prepare.ts` (hot-window ~20 + Layer-1 summary + Layer-3 facts) — a real tiered memory. `CLAUDE.md`/`AGENTS.md` are our `agents.md` equivalent. Skills exist (Claude Code + superpowers).
- **Correction:** **no SQLite FTS5** (the doc's specific recommendation). Whether FTS5 retrieval beats our current summary+facts approach is untested — a candidate experiment, not a known win. Active-correction / passive-generalization (append-to-memory) is partially present (this session's memory writes) but not auto-prompted at task end.

### Orchestration framework (doc §"Structuring the AI Workforce")

- **Doc says:** adopt LangGraph (state machine) + persona nodes; reject CrewAI's non-determinism.
- **Reality + correction:** we already built a **custom deterministic orchestrator** (`services/dispatch_listener/`) that delivers exactly the properties the doc credits LangGraph with — explicit states, auditability, no open-ended agent dialogue, fault recovery (DLQ, watchdogs, slot quarantine), **plus** physical worktree isolation + HMAC + governance the doc doesn't even cover. **Recommendation: do NOT adopt LangGraph.** It would be a rewrite that loses our isolation/governance for a philosophy we already enforce. The doc's framework section is the least applicable to us.

### Workflow patterns (doc §"Agentic Workflow Design Patterns")

- All three already exist, informally: **Parallelization** (the Workflow tool's `parallel`/`pipeline`, multi-worker dispatch); **Evaluator-Optimizer** (this is literally **CC verifying DPSK's commits** — Generator=DPSK, Evaluator=CC, which caught Stage 3/4 breakage this week); **Orchestrator-Workers** (kernel dispatch + Sully proposing). Formalizing them as named, reusable harnesses is a nice-to-have, not a gap.

### MCP & the Tools Tax (doc §"Environmental Interfacing" / "Mitigating the Tools Tax") — **the operator's focus**

- **Doc says:** at >~50 tools the full-schema `tools/list` dominates the context window, degrades reasoning, inflates cost. Fix = **Progressive Disclosure**: inject only `get_tool`/`invoke_tool`; a gateway uses semantic/intent search to return only the relevant schemas at call time; dynamic hide/expose via `notifications/tools/list_changed`.
- **Reality:** we have **static, coarse** scoping, not dynamic disclosure:
  - `tools/logueos_mcp_gateway/capability_registry.py` (LOS-29) loads `.logueos/capability_registry.yaml` and drops tools not matching a **per-project allow-list** in `tools/list`. Fail-closed (transitioning). Good for _security/scoping_, but every allowed tool's **full schema still ships** to the client.
  - The logueos-gateway exposes **~60 tools** — already past the doc's Tools-Tax threshold.
  - **Claude Code** mitigates this client-side: deferred tools + `ToolSearch` (this is progressive disclosure, but at the _agent_ layer, not the gateway). **GMI/AGY (aider/gemini) have no such deferral** — they eat the full `tools/list`. That is almost certainly the "context bloat in other agents" you're seeing.
- **Correction / recommendation (before adding more tools):** the operator's instinct is right — adding tools to a flat ~60-tool catalog worsens the tax for the non-Claude-Code agents. Two options, cheapest first:
  1. **Tighten per-profile allow-lists** so each worker profile (`standard_worker`/`reviewer`/`drift_executor` in `gatekeeper/`) sees a small, task-relevant subset, not the whole catalog. Low effort, big immediate win, uses machinery we already have.
  2. **Add a `get_tool`/`invoke_tool` facade** at the gateway (true progressive disclosure): expose 2 meta-tools + a semantic/keyword search over the catalog; return schemas on demand. Higher effort; the right long-term answer if the catalog keeps growing. Mirrors what Claude Code's ToolSearch already does — so you'd be giving GMI/AGY the same benefit.
  - Either way: **categorize the catalog** (by domain: github / linear / fs / system / n8n / memory) so disclosure/allow-lists can be reasoned about.

### Security (doc §"System Integrity")

- We have the gatekeeper, fail-closed registry, and `github_write` isolation (LOS-154, shipped). We do **not** containerize MCP servers (they run as local processes), and there's no Evaluator-revalidation of tool outputs. FSP/Rug-Pull risk is mostly mitigated because our MCP servers are **first-party** (not unverified third-party) — the doc's threat model assumes untrusted servers, which is a weaker fit for us. Worth a note, not urgent.

---

## Worth acting on (prioritized — for the parallel agent)

1. **MCP progressive disclosure / Tools-Tax** (operator-flagged). Start with option 1 (tighten per-profile allow-lists in the capability registry) so adding new gateway tools doesn't bloat GMI/AGY context. Then evaluate a `get_tool`/`invoke_tool` facade. _This is the prerequisite to "add the tools we don't have yet."_
2. **Close the routing loop.** Promote the shadow predictor / scorecard from measuring to gating — the data (`worker_runs`, `hermes_predictions`) already exists; the live `valueGate` is static. Ties to PRO-963 (worker scorecards).
3. **Lift Ask-recall on vague work-intent** (the 2/49 scorecard misses: "implement the login screen", "fix the thing that crashes"). A mandatory cheap local model-vote on the local path is the doc's "TLM" applied to our real gap.

## Worth a low-priority experiment

- A/B `companion-v1` vs `hermes4:14b` **for the triage role** (dual-mode `<think>` self-assessment).
- FTS5 memory retrieval vs the current summary+facts assembly.

## Not worth doing (corrections to the doc's recommendations)

- **Adopting LangGraph/CrewAI** — we already have a deterministic orchestrator with stronger isolation/governance.
- **Sizing hardware from this doc** — its VRAM figures are inconsistent.
- **Containerizing first-party MCP servers** as a priority — our servers are trusted; the doc's FSP threat model targets untrusted third-party servers.

---

## Operator design direction — Sully tools toggle (2026-06-08, PENDING / being scoped)

Operator intent layered on top of item 1 (MCP disclosure). Worker-side gating stays as-is (capability registry per project/profile); this is **Sully-side, per-turn control**:

- **A gateway tools toggle for Sully** — operator-facing control over _which_ tools are loaded for Sully at a given time (flexibility + control over Sully's loaded surface, independent of the static per-project allow-list).
- **A routing-layer "tools enabled this turn" flag** — the routing layer (`routing/` + `decisionGate`/`turn_decision`) carries an explicit set of tools enabled for the current turn, and **respects it before attempting any tool call** (a tool not enabled this turn is not callable, regardless of what the gateway _could_ expose). This is a turn-scoped allow-list that sits in front of the gateway, not a replacement for worker gating.

Open questions to resolve before building: where the toggle state lives (env/config vs per-thread DB vs operator UI control); whether "tools enabled this turn" is set by the operator, inferred by the router from intent, or both; and how it composes with the gateway's existing per-project capability registry (turn-flag should be the _intersection_, never an escalation). Treat this as the design frame for the MCP work — **held pending operator data**.

---

## My thoughts (one paragraph)

The doc is a competent literature review, and it's reassuring that an independent synthesis lands on the architecture we've been building toward — ask-before-dispatch, deterministic orchestration, shared MCP, evaluator loops. Its real value isn't new direction; it's **naming two things we've under-invested in**: the routing _learning loop_ (we hoard the corpus but still decide with regexes) and MCP _progressive disclosure_ (we scope by project but still ship ~60 full schemas to agents that can't defer). Both are tractable with machinery we already own — the scorecard/`worker_runs` for the loop, and the capability registry for the tax. I'd treat everything else in the doc as confirmation, not a to-do. The one trap to avoid: the doc's framework/model sections will tempt a rewrite (LangGraph, Hermes-as-primary) that trades our hard-won isolation + governance for theory — resist that.
