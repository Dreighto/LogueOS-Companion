# Handoff Brief — Sully (LogueOS-Companion): Notification fix + QOL batch

**For:** an incoming coding agent (any model — Cursor / Codex / a fresh Claude Code / Gemini CLI) with repo + sandbox access.
**From:** CC (VP Ops). **Date:** 2026-06-04. **Operator:** dreighto ("Captain") — **non-technical; lead every status update in plain English.**
**Companion full detail:** read `data/peer_reviews/2026-06-04_qol-notification-sdk-research.md` (the research report — has the file:line root-cause, sources, and the full approach for every item below). This brief is the work order; that report is the evidence base.

---

## 0. The Go/No-Go rule (the operator's hard directive for this handoff)

> **Only report "CONFIRMED WORKING" when you have proven it with evidence you can point to — and only after ALL of it is tested in a sandbox.** A claim is not proof.

Apply, per task:

- **GO** (say "confirmed working") only when you can cite the deterministic evidence: tests pass (`npm run check && npm test` green), the build succeeds, and the behavior is demonstrated (a test asserting it, a command's output, or an on-device/sandbox check). Quote the receipt.
- **NO-GO / UNKNOWN** otherwise. If you couldn't test something (e.g. real on-device iOS push needs the operator's phone), say exactly that — "built + unit-tested; on-device tap NOT yet verified" — never round up to "done."
- **Sandbox first.** Do NOT deploy to the live service (`:18769`) or push to `main` directly. Work on a branch, test locally (build + tests + a local run if useful), open a PR, and hand back for the operator to review/merge/deploy. The live companion is the operator's daily driver.

---

## 1. What you're working on (context)

**Sully = the operator's personal, local-AI companion.** SvelteKit (adapter-node, **Svelte 5 runes**, Tailwind 4) PWA + a **Capacitor iOS shell** that loads the remote tailnet URL. Server runs on `:18769`, base path `/companion`. It's **task-first**: Sully proposes work, dispatches background workers (CC/AGY), verifies their output (deterministic Go/No-Go), and notifies the operator when a task is done.

**Already shipped + proven live (do NOT regress it):** the task-first v1 verification layer — Sully verifies before she speaks, never silently mutates a running task, and classifies before answering. 342 vitest pass, `svelte-check` 0 errors. See `docs/SESSION-HANDOFF.md` + `docs/DOING-NOW.md`. **Phase 5 (workspace + write-tool + artifact preview/download) is OWNED BY THE OPERATOR + CC — it is NOT part of this handoff. Stay out of it** (see §5 exclusions).

**Environment / commands:**

- Repo: `~/dev/LogueOS-Companion`. Stack tests: `npm run check` (svelte-check, must be 0 errors) + `npm test` (vitest, currently 342 green — keep them green).
- Build: `npm run build`. Deploy (operator-only, don't run without OK): `sudo -n systemctl restart logueos-companion.service`.
- The iOS shell loads the remote tailnet URL, so **frontend changes reach the phone on app reload — no iOS rebuild** unless you touch native code (push, plugins, Info.plist, entitlements). Native iOS rebuilds go through Codemagic (`tools/trigger-ios-build.sh`) — operator-run.
- **On-phone push is native APNs**, NOT web push (Web Push does not work inside the Capacitor/WKWebView shell). Treat PWA web-push as the desktop/installed-PWA fallback only.

**Hard don'ts:** never `git add -A` (the tree has pre-existing NOT-yours files — `docs/agy-audit-shots/*`, `scripts/finetune/*`, `peer-reviews/*` deletions, `docs/Screenshots/*`, root `*.md`; stage only files you create/modify, by explicit path). Never touch `.env`, `.mcp.json`, `card_catalog.db`, or the append-only `data/*.jsonl`. Match the app's brand in any UI (magenta `#ec2d78`, `brand`/`brand-soft` tokens, rounded-full pills, the `DispatchChips`/`WorkingBubble` look — NOT generic zinc/Tailwind defaults). Build subagent-/test-driven; adversarially review your own work before declaring GO.

---

## 2. Task 1 — Notification deep-link fix (DO FIRST; highest value, ~2 lines)

**Symptom (operator-reported):** tapping a "task done" push opens a brand-new empty chat instead of the conversation with the result.

**Root cause (verified against live code — full detail in the research report §1):** the completion push payload carries a static URL (`appIdentity.pushDefaultUrl` = `/companion/chat`, `config.ts:213`) with **no thread id**. A bare `/companion/chat` open hits `src/routes/chat/+page.server.ts:90-93`, finds no `?thread=`, and **by design** mints a fresh thread. The originating `threadId` is in scope at both send sites but never put in the URL. The tap handlers (`src/lib/native/push.ts:58-67`, `src/service-worker.ts:82-85`) and the `?thread=` deep-link load already work — they're just fed a thread-less URL.

**The fix:**

1. `src/lib/server/completionClose.ts:135` — `url: appIdentity.pushDefaultUrl` → `url: \`${appIdentity.pushDefaultUrl}?thread=${encodeURIComponent(threadId)}\`` (`threadId`already computed at line 40; the`'default'` fallback lands correctly in The Den).
2. `src/lib/server/completion_poller.ts:61` — same, using `entry.thread_id` (already null-checked at line 54).
3. No sender/load changes needed (`apns.ts:138-141` forwards `url` at root → Capacitor maps to `notification.data.url`; `web_push.ts:140` nests it; `+page.server.ts:91` reads `?thread=`).

**Prove it (Go/No-Go):** add a test asserting the completion push URL contains `?thread=<the job's thread id>` for a normal thread AND the `default` fallback; `npm run check && npm test` green; sanity-check `?thread=` survives the APNs JSON serialization. On-device tap verification needs the operator's phone — mark it "ready for on-device check" if you can't do it, don't claim it.

---

## 3. Task 2 — Cheap QOL batch (after Task 1; all low-effort on existing infra)

Each is small; do them as separate commits/PRs or one cohesive PR — your call, but keep each independently testable. Detail + sources in research report §2.

- **Pin / rename / search threads.** `chat_thread_meta` already exists — add the columns + sidebar UI (`ThreadsSidebar.svelte`, `threads.svelte.ts`). Full-history search across messages.
- **Scroll-restore / last-unread on reopen.** Persist scroll position + last-read per thread so reopening lands where the operator left off.
- **Clearable "tasks waiting" badge.** APNs badge count = unseen finished tasks; clears on view. Keep it low-noise.
- **Notification grouping by thread.** Set the APNs `thread-id` (and web-push `tag`) so multiple pings for one thread collapse into one stack.
- **`experimental_throttle` on the SDK chat** (trivial): set the throttle (~50ms) on the `Chat`/`useChat` surface in `src/lib/chat/streaming.svelte.ts` for smoother streaming + lower phone CPU. Verify the exact prop name in the installed `@ai-sdk/svelte` version.

**Prove it:** tests where unit-testable (DB columns, search, badge logic); `npm run check && npm test` green; brief manual/sandbox verification notes for the UI bits.

---

## 4. Task 3 — Decision-push + lock-screen actions (after Task 2; native iOS work — heaviest)

- **"Needs a decision" push.** Today `decide()` returns Talk/Ask/Dispatch and an Ask posts a `pending_approval` proposal with Run/Not-now buttons. Wire the **blocked/awaiting-approval** state to its own APNs push ("Sully needs a decision"), deep-linked (per Task 1) to that thread, so the operator can approve a blocked dispatch from the phone without babysitting.
- **Lock-screen Approve / Not-now (+ quick text reply).** Native: register a `UNNotificationCategory` with `UNNotificationAction`s (Approve / Not-now) + a `UNTextInputNotificationAction`; stamp the category id on the push payload; handle the response (`actionIdentifier` / `userText`) and round-trip it to the existing confirm endpoint (`/api/chat/dispatch/confirm`) / the gateway. This is native iOS + a Codemagic rebuild — coordinate the rebuild with the operator.

**Prove it:** server-side wiring unit-tested; the native action round-trip is on-device — be explicit about what's sandbox-verified vs. needs the operator's device.

---

## 5. Explicitly NOT in this handoff (leave for the operator + CC)

These are **Phase 5 / later** and owned elsewhere — do not start them, to avoid colliding with parallel work:

- Workspace + write-tool, artifact **preview/download** panel, and the AI-SDK **custom data parts** / **v6 tool-approval** that back them (Phase 5).
- **Resumable streams** (needs Redis on ROOM) and **live interactive HTML artifact preview** (needs a separate `artifacts.` origin) — later, higher-infra.
- "Pulse-style" overnight catch-up digest — later differentiator.

If a QOL item seems to require touching Phase 5 surfaces, stop and flag it to the operator instead of proceeding.

---

## 6. Report-back format (every status)

Plain-English first (3 lines: what happened / does it work / what you need from the operator), then detail below a `---`. For each task: **STATUS = CONFIRMED WORKING / READY-FOR-DEVICE-CHECK / BLOCKED / NOT-STARTED**, the evidence (test output, commands, file:line), and the PR link. Per the Go/No-Go rule: no "done" without the receipt.
