# Phase 5 / 5a — live validation + blockers (2026-06-05)

## Result: full worker workspace dispatch PROVEN end-to-end (commit-verified)

A real CC worker, dispatched by Sully into the fresh `sully-workspace` repo, **built an artifact and committed it**, and the Go/No-Go poll **verified the commit**:

- Routing → `sully-workspace` ✓ · propose/dispatch ✓ · worker **spawned + executed** ✓
- Worker built `demo/index.html` (a styled page with a working toggle button) ✓
- Worker **committed**: `3d68a75 feat(demo): index.html with button toggling a "Hello from Sully" message` ✓
- Go/No-Go: **git channel GO** ("commit exists" — the core proof) ✓; synthesis + adversary ran; Sully reported the win and **honestly hedged** (I9) about the unread-files concern.

This is the operator's vision working: _Sully creates a workspace → dispatches a worker into it → the worker builds + commits → Go/No-Go verifies the commit._

## The fix that unblocked it (small + localized — NOT a kernel change)

**Root cause** (from `logs/dispatch_listener_stdout.log`): the listener writes a `.mcp.json` into every worktree (`mcp_config.writeMcpConfig`), but the fresh `sully-workspace` repo did not `.gitignore` it → the worktree showed `?? .mcp.json` (dirty) → the pre-spawn park-check refused → the dispatch died. All established repos gitignore `.mcp.json`; that's why they always worked. Worker-agnostic (both CC and AGY hit it — it's a pre-spawn step).

**Fix:** added `.mcp.json` / `.claude/` / `*.prompt.tmp` to `sully-workspace`'s `.gitignore` + a minimal `CLAUDE.md` canon (commit `36928fd`), synced to the worktree branches. Re-test: worker spawned + executed + committed cleanly, listener stable.

## Open refinement (small, Companion-side — makes the posture "confirmed" not "warn")

The Go/No-Go **artifact channel returned NO_GO "path escapes repo root"**, so the overall posture was `warn` (Sully hedged). Cause: the worker reports the artifact's **worktree** path (`~/dev/worktrees/sully-workspace/w1/demo/index.html`), but `verifyPoll`'s artifact channel checks it's under the declared repo root (`~/dev/sully-workspace`). The file genuinely exists + is committed (git channel GO confirms it) — the path check is just worktree-unaware.

**Fix (small, in `verifyPoll.ts`):** for a worktree-based dispatch, accept artifact paths under the worktree root too (or treat the git-commit GO as sufficient for workspace artifacts). Low-risk; turns `warn` → `confirmed`.

## 🅿️ PARKED — named kernel blocker (do NOT call worker dispatch fully hardened until fixed)

**Blocker:** the dispatch listener **crashes on an uncaught throw** when a worktree fails the park-check. `spawn.js:722` does `throw new Error('pre_spawn_dirty_refusal: ...')` in an async path with no catch → unhandled rejection → the **whole listener process exits** (systemd auto-restarts, but the in-flight dispatch is lost and any concurrent worker is orphaned). A single dirty/unparked worktree should fail **that one dispatch** gracefully, not take down dispatch for everything.

**Why parked:** this is a robustness fix on the **core spawn path** (kernel/Orchestrator) — exactly the "broad kernel surgery / risks destabilizing established-repo dispatch" the operator said to stop-and-document rather than do autonomously.

**Acceptance test (for when it's fixed):**

- Given a registered dispatch target whose worktree is dirty or on the wrong branch,
- When a worker is dispatched to it,
- Then: that dispatch is marked **failed** with reason `pre_spawn_dirty_refusal`, the listener **stays up** (process does not exit), and a concurrently-dispatched worker to an established repo **completes normally**.
- Regression: established-repo dispatch is unaffected.

## Distinction (per operator)

- **Safe artifact v1 (fallback, available):** a model generates content, the confined `workspace.ts` writes/commits/verifies. Not needed now that worker dispatch works, but remains the lighter option.
- **Full worker workspace dispatch (PROVEN today):** CC initializes + builds + commits inside a fresh workspace, Go/No-Go verifies the commit. ✅ working — pending the two refinements above (artifact-path → `confirmed`; the parked listener-crash robustness).
