# Sully + LogueOS — Vision, Current Scope, and Roadmap

**Date:** 2026-06-02
**Project:** LogueOS-Companion ("Sully") — a personal AI operating system, not a chatbot
**Author:** main CC (Claude Opus 4.8 via Claude Code), synthesizing operator + GPT direction
**For:** any LLM the operator wants to discuss this with — this is a self-contained brief, no prior context assumed
**Status:** Active. Phase 1 implementation is starting now (in parallel with this doc being written).

---

## Who's who (so the brief makes sense)

- **Captain / Dreighto** — the operator. Not a developer. Runs everything on his own hardware (a Linux box called `room` with a 5060 Ti GPU). Communicates the desired _experience_ clearly but doesn't always have the implementation vocabulary — that's expected and fine.
- **Sully** — the operator-facing AI companion. A SvelteKit + Capacitor iOS app. The single interface Captain talks to.
- **LogueOS** — the underlying multi-agent operating system. Kernel, dispatch listener, gateway, ticket system, team memory. Sully sits _on top of_ LogueOS; she does not replace it.
- **Workers** — CC (Claude Code, backend/Python/verification), AGY (Antigravity/Gemini, frontend/iOS), plus Gemini, Codex, and local models. These execute specialized work. They are infrastructure — Captain should never have to talk to them directly.
- **companion-v2 / v3** — local fine-tuned Qwen-14B models. v2 was trained on past chat history; that training was just stopped mid-run because the architectural shift (below) made the corpus shape wrong. v3's role is being redefined.

---

## The core thesis

> The goal is not to build a better chatbot. The goal is to build a personal AI operating system where chat is simply the primary interface.

Captain currently lives as the **manual relay** between AI systems:

```
Captain asks AI A → AI A asks for more context → Captain copies logs/outputs →
Captain pastes into AI B → AI B asks for more → Captain relays again → ...
```

The entire system exists to kill that pattern and replace it with:

```
Captain asks Sully → Sully gathers context → Sully routes work → Sully coordinates workers →
Sully verifies results → Sully updates memory → Sully returns one clean answer
```

One place for chat, brainstorming, research, mockups, artifacts, system health, worker execution, verification, memory, and learning.

---

## The Layer Rule (how responsibilities divide)

| Layer                                           | Owns                                                      | Never does                              |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| **Sully**                                       | The conversation. Captain's only visible assistant.       | Absorb LogueOS; expose worker internals |
| **LogueOS**                                     | The system — kernel, dispatch, gateway, tickets, team OS  | Surface directly to Captain             |
| **Workers** (CC / AGY / Gemini / Codex / local) | Execution — the actual implementation                     | Talk to Captain directly                |
| **Memory**                                      | Learning — observations, episodic facts, operator profile | —                                       |
| **Tasks**                                       | The connective tissue that links all of the above         | —                                       |

Mantra: _Sully owns the conversation. LogueOS owns the system. Workers own execution. Memory owns learning. Tasks connect everything._

---

## The architectural shift

**FROM (today — "chat-first, dispatch-second"):**

```
Question → Sully streams an answer → autonomous dispatch fires AFTER → worker prose appears later as a separate bubble
```

This forces Captain to mentally combine three things: Sully's first (often half-formed) answer, the dispatch status, and the raw worker output.

**TO (the target — "work-first, answer-after-verification"):**

```
Question → Task created → Sully classifies → (if needed: worker runs + verifies) → Sully synthesizes → one clean Sully reply
```

For requests that need verification, repo inspection, research, or worker execution, Sully does **not** answer first. She creates a Task, does the work, verifies, then returns a single Sully-authored response. Captain feels like he's talking only to Sully. Workers, routing details, and raw logs stay available for inspection but are not the primary experience.

The **Task** is the unit of work — not the message. Messages become projections of the Task.

---

## The forensic journal (emerges from the Task lifecycle, not bolted on)

A critical reframing: the journal is **not a separate logging feature.** It is the persistent state of the Task lifecycle. If the Task object is modeled correctly, the journal is automatic.

Every Task persists:

- User request (typed or spoken)
- Route decision + the reason for it
- Worker selected
- Timeline of events (classify → gate → dispatch → worker steps → verify → synthesize)
- Raw worker output
- Sully's synthesized summary
- Success / failure
- Lessons learned + memory updates
- Errors and recovery actions

This gives a complete audit trail and lets us (and future model versions) analyze: what failed, what succeeded, which routes were correct, which summaries were useful, and what the local model should learn.

**Why it matters operationally:** today the operator has to tell CC "go check the chat logs" every time something needs debugging. With the journal + a reader API (`replayTurn(task_id)`), CC reads the machine-readable trail directly. No manual relay, even for debugging.

---

## Voice is first-class, not a reduced mode

Captain brainstorms **by voice more than by text** — he thinks out loud and figures out what he wants while speaking, so he rarely has a perfectly-formed prompt before starting.

**Hard requirement:** voice and text are the same Sully. Same Task lifecycle, same routing, same memory access, same worker dispatch, same journal, same verification, same final summaries. The _only_ difference is the interface: text is typed input, voice is spoken input.

Voice must NOT become "voice commands" while text is "the real system." Both are first-class paths into the same operating model. Captain must be able to start a project from either surface and get identical capabilities.

**Current state (being fixed in Phase 1):** voice today runs a _separate, reduced_ pipeline. It bypasses the classifier, never creates a Task, never dispatches workers, never writes journal events. Phase 1 folds voice into the same `prepareStream`-rooted path as text — STT output becomes text-equivalent input; TTS is just output formatting on the way back. Under the hood, one Sully.

---

## How we build (the methodology)

Captain explicitly rejects a long traditional product-development cycle. LogueOS itself was built by _using it and improving it as we went_. Sully evolves the same way.

So: **no long observation period.** We start using Sully on a real project immediately and let the Task system + journal capture what actually happens. Production use IS the validation. The journal accumulates real Tasks as we work — not as we sit and wait.

This is also healthier for the eventual model training: synthetic test data would have the same wrong-shape problem the v2 corpus had. Real Tasks from real work are the only corpus that matches the job.

### First real-world test project: "Today's Ops" dashboard

The dashboard is not the point. Exercising the full Sully workflow is the point:

- Brainstorming (by voice and text)
- Task creation
- Worker routing
- Verification
- Progress tracking
- Final summaries
- Memory updates
- Logging

Success is measured by _"did the journal capture the friction points usefully?"_ — not _"did the dashboard ship clean?"_ We use Sully as the primary interface for the project and watch where it breaks.

---

## The local model's redefined role (companion-v3)

After stopping the v2 training, the local model's purpose changed:

- **Not** a general chat assistant competing with Gemini / Claude
- **Yes** Sully's personal **routing + intent + synthesis** layer. The local-first classifier that decides _what kind of work each turn is_, and the synthesizer that turns verified worker output into a Sully-voiced answer. It learns Captain's communication style, preferences, workflow, projects, and decision-making over time.
- Cloud models still do the heavy reasoning and the actual worker execution until v3 is trained for those jobs too.

**Key insight — the Task lifecycle is the data factory for v3.** What v3 needs to learn is two patterns that _don't exist in Captain's past chat history_:

- **Routing pairs:** `(user message → classification decision → was it correct?)`
- **Synthesis pairs:** `(worker output + original question → Sully-voiced summary → operator thumbs-up/down)`

Past chat shows Sully _answering_, not Sully _routing then synthesizing_. So v2's corpus was always wrong-shape. The journal produces the right-shape corpus naturally: every Task that runs is a tagged training pair. Train v3 on the journal once it has weeks of real Tasks in it.

**Sequencing:** Phase 1 (cloud-only) → use Sully on Today's Ops → journal accumulates real Tasks → train v3 on the journal → progressively cut v3 in (classification first, synthesis later, broader work only if it earns it).

---

## Phase 1 scope (starting now)

Server-side only. No UX change. No GPU touch. Cloud-only chat keeps working. Voice folded in.

**IN:**

- Schema: extend `pending_jobs` (the existing dispatch-job table) into the unified Task — add `thread_id`, `source`, `classification_tier`, `classification_payload`, `verification_state`, `verification_ref`, `synthesis_message_id`, `ticket_id`. Extend its status FSM with `proposed/classified/gated/held/verified/synthesized`.
- Schema: extend `chat_messages` with forensic columns — `task_id`, `model`, `provider`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `error`.
- Move `chat_activity` CREATE TABLE into bootstrap (currently lazy, can miss on cold DB); widen its event vocabulary for non-dispatched turns.
- Mint `task_id` up-front in the shared prepare step; thread it through operator + assistant rows on both text and voice paths.
- Fold voice (`/api/chat/voice-reply`) into the same `prepareStream`-rooted pipeline text uses.
- New `turn_replay.ts` reader API: `replayTurn(task_id)`, `replayTurnByMessage(id)`, `replayThreadRecent(thread_id, n)` — the machine-readable journal CC reads.

**OUT (deferred to Phase 2/3/4):**

- The pre-stream routing gate (moving the dispatch _decision_ before the reply) — Phase 2
- The synthesis pass (Sully reading worker output → authored follow-up) — Phase 3
- The TaskCard render abstraction + Dynamic Island status pill — Phase 3
- Worker structured-result envelope — Phase 3
- Verification flow-back (PR-merge / CI updating `verification_state`) — Phase 4
- Memory writes triggered by Task transitions — Phase 4
- companion-v3 retraining — after the journal has real data
- Any frontend changes; any model-routing changes

**Why this boundary:** reversible (additive columns + a reader API), it's the data factory for everything downstream, and it makes every turn observable end-to-end without operator inspection. We've been burned twice this week by scope creep (the v2 training, an env-loading rabbit hole) — Phase 1 stays tight on purpose.

---

## Open questions still being discussed (not blocking Phase 1)

1. `pending_jobs` rename vs view-alias (the name is misleading once it holds non-dispatched Tasks)
2. `chat_activity` shared table vs a split `task_events` table for Sully's own thinking events
3. v3 decomposition: router-only vs router+synthesis vs router+synthesis+general — deferred until real journal data exists
4. Synthesis model choice: always-fast (Gemini Flash-lite) vs match-the-turn's-tier — leaning always-fast since synthesis is summarization not reasoning

---

## What "moving in the right direction" looks like (operator's words)

> If I can speak or type naturally, have Sully coordinate the work, and receive a clean result back, then we're moving in the right direction.

That's the whole test. Everything in this document serves that one sentence.

---

_Self-contained brief. Companion-v3 training is paused; GPU is free. Cloud-only test bed is healthy. Phase 1 implementation in progress as of this writing. Predecessor docs (routing-gate investigation, task-first architecture, scope-lock) live alongside this file in `data/peer_reviews/`._
