# Sully — Plan / What's Next

> _Last updated: 2026-06-03 · state: [CURRENT-STATE.md](CURRENT-STATE.md) · in flight: [DOING-NOW.md](DOING-NOW.md)_
>
> The forward plan. Sourced from the 2026-06-02 audit synthesis + the task-first roadmap. Nothing here is started unless noted.

## Two decisions needed first

These gate the higher-value work — they are product calls, not just code:

1. **Make Sully's dispatch judgment authoritative?** Today, even when Sully decides "this needs a worker," a keyword regex can veto it. Making her call carry weight is what makes "the model routes" real — but she'd start dispatching on phrasing currently blocked (each spawn burns Max quota). _Refactor step #12._
2. **Retire the legacy in-composer Talkback?** Realtime voice is now primary; the old path duplicates playback/usage logic. Decide before consolidating the voice stack. _Refactor step #15._

## The refactor — remaining steps (quick wins already done in `11f466e`)

Sequenced low-risk-first, gated behind the now-live CI so the 134 tests catch regressions. Full detail + file:line: `data/peer_reviews/2026-06-02_companion-audit_findings.md`.

| Step | Effort | Risk | What                                                                                                                                                                                                                                                                           |
| ---- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 11   | M      | med  | **Migrate the rest of the legacy `/api/chat` handler** onto `persistAssistantTurn` so its replies get forensics + the journal + summary refresh (parity with streaming). The half-migrated handler is the source of the two highest-severity bugs. Do it one branch at a time. |
| 12   | M      | med  | **Gate authority** (decision #1) — make Sully's validated self-assessment decide on the CLI path; valueGate becomes a floor only for the cheap local path. Wire/arm or delete the dead injection guard.                                                                        |
| 13   | M      | med  | **Centralize the conversation window** (size + NEW-CONVERSATION reset-marker) into one shared helper used by all three paths — the streaming paths currently ignore the reset marker the legacy path honors.                                                                   |
| 14   | L      | med  | **One shared `db.ts`** owning a single connection (WAL + busy_timeout once) + all schema/migrations — replaces ~23 per-call open/close openers and kills the schema-duplication root cause. Do AFTER CI exists.                                                                |
| 15   | L      | med  | **Consolidate the two voice stacks** — one shared TTS-playback helper, one truthful usage-cap module, remove the dead `transcribe/stream` route. Gated on decision #2.                                                                                                         |

**Do NOT touch** (load-bearing, per the audit): the run-mode config matrix, the shared `chat_turn`/`stream_prepare`/`chat_prompt` extractions, the hot-window ordering, the documented Svelte-5 runes workarounds, the stable-signing-key injection, the tailnet fail-closed auth, the brakes-chain ordering.

## Task-first roadmap (the big arc)

Phase 1 shipped. The rest:

- **Phase 2 — gate before the answer.** Decide → optionally dispatch → answer (instead of answer-then-maybe-dispatch). This is what starts emitting the `classified`/`gated`/`held` states the schema already supports. Closely tied to decision #1.
- **Phase 3 — synthesis + surfaces.** Worker `task_result` envelope → Sully synthesizes → render a **TaskCard** in chat + a **Dynamic Island** live-activity pill (reuses the APNs foundation).
- **Phase 4 — verification flow-back.** Verify dispatched work (PR-merge / CI) before it's "done"; memory-writes triggered on Task transitions.
- **companion-v3 retrain** — deferred until the journal has accumulated weeks of real Tasks (it's the data factory).

## Today's Ops dashboard (the first task-first test project)

Build a dashboard that answers "where did we leave off / what's next / roadmap" from **real sources** (git log, the task journal, Linear, a small projects registry) — never from stale config prose. Design: `data/peer_reviews/2026-06-02_todays-ops-data-sources_design.md`.

- **MVP (one sitting):** git-activity panel + projects registry + the 3-card `/ops` page. True-on-day-one from git alone.
- The intent is to run it **through Sully's dispatch** as the test, once decision #1/#3 is made.

## iOS / platform

- **Dynamic Island** live-activity (Phase-3 surface; reuses APNs). Separate larger build, not started.
- iOS keyboard-open delay on chat threads — open diagnostic (pre-existing task #28).

## Frontend polish (deferred, lower priority)

- Clean-&-premium visual pass; the new brand icon set + Auto-tier icon (awaiting the Moonlit Rabbit mark); the few a11y gaps the audit noted (`aria-pressed` on toggles, ImageLightbox keyboard handler).
