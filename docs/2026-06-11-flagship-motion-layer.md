# Sully Flagship — Motion & Micro-Interactions Layer (execution brief)

> **Authority:** `2026-06-11-flagship-hybrid-canon.md` is the source of truth. This brief is the
> file/line-level **motion execution checklist** under it — where they overlap, the canon wins.
> What this adds beyond the canon: the send⇄voice icon morph (M2), a **universal** reduced-motion
> guard (the canon's are per-class), and the honest "screenshots can't verify motion" gate.
> For the _why/how_ behind these moves, see the research pass `2026-06-11-flagship-feel-research.md`
> (esp. the spring→`linear()` token upgrade — the highest-leverage feel change).
>
> **What this is:** the **motion complement** to the visual decluttering — materials/layout are the
> canon's Phases A/B; this is _how it feels in your hand_. Don't redo the visual work; layer motion on top.
>
> **Author:** CC (VP Ops, second-eye review) · **For:** the motion owner (CUR per canon Part 8) · **Date:** 2026-06-11
> **Ticket:** fold under the flagship pass (LOS-204 family); reference this path in PR body.

---

## The one-sentence diagnosis

The design system already _defines_ a flagship motion language — `src/app.css` lines 179–198
carry a full ease/duration token set, several labeled for exact purposes (`--ease-enter`
`/* message/card entries */`, `--dur-base` `/* message land */`, `--ease-spring` `/* orb, dots */`,
`--ease-sheet` `/* iOS sheets ONLY */`) — **but the conversation surface never applies it.**
Messages pop in with no transition. The work here is mostly _wiring existing tokens to the
moments that should already use them_, not inventing new motion.

---

## Hard rules (non-negotiable — a reviewer will reject violations)

1. **Locked tokens only.** Every duration/easing comes from `src/app.css` (`--dur-*`, `--ease-*`).
   No hardcoded `ms` or `cubic-bezier()` in NEW motion. (Note: the **sheet** transitions at
   `Composer.svelte:459/471` carry ad-hoc `cubicOut`/`200ms` — token-align those. **EXCEPTION:**
   the attach-reveal `fly` at `Composer.svelte:574` is what the hybrid canon calls "the best
   micro-interaction in the app — keep it." Do NOT touch its feel; leave it as-is.)
2. **Transform + opacity ONLY** on messages and any large/full-width surface. iOS WebView repaints
   the whole layer when you animate `background`/`box-shadow`/`height` on big elements — it drops
   frames. The locked spec already mandates this for `.sully-smooth`; obey it everywhere here.
3. **Every new `@keyframes` / `transition` gets a `prefers-reduced-motion` guard.** ⚠️ The current
   reduced-motion blocks in `app.css` (lines ~681, ~798) are **scoped per-class, not universal** —
   new animations are NOT auto-neutralized. Either add each new animation to a reduced-motion block,
   **or** (preferred, do this first) add ONE universal neutralizer near the top of the motion section:
   ```css
   @media (prefers-reduced-motion: reduce) {
   	*,
   	*::before,
   	*::after {
   		animation-duration: 1ms !important;
   		animation-iteration-count: 1 !important;
   		transition-duration: 1ms !important;
   		scroll-behavior: auto !important;
   	}
   }
   ```
   This is an accessibility + App-Store-review requirement, not a nicety.
4. **Do not break the truth guards or e2e hooks.** Keep every `data-testid` and the WorkerPill
   truth-guard behavior (no fake motion on unverified/terminal runs) exactly as-is. Motion is
   additive chrome; it never changes _when_ something is shown, only _how_ it arrives.
5. **Don't clone the calm away.** Per `companion-ui-design` (calm/premium, NOT Console density):
   motion is quiet and physical, never decorative or attention-grabbing. Ash discipline applies to
   motion too — movement marks something real happening, it isn't sprinkled for flair.

---

## Worktree & sequencing (avoid the two-writers collision)

Motion touches the SAME files as CUR's Phase A/B (`MessageFeed.svelte`, `Composer.svelte`,
`app.css`). Two agents editing those at once = merge pain. Pick one:

- **Preferred — sequence after CUR Phase A/B merges.** Motion lands cleanest on top of the
  decluttered surface (e.g. message-land animation should target the _new_ message material, not
  the old zinc bubble). Branch off updated `main` once CUR's visual PRs are in.
- **If parallel is required**, AGY takes its **own** worktree (not `cur/`, not `captain/`) and the
  operator coordinates which files each owns this round. Never both editing `MessageFeed.svelte`
  in the same window.

Suggested branch: `feat/agy-flagship-motion`. Operator merges (AGY does not self-merge); CC reviews.

---

## The motion moments (ranked by flagship ROI)

Each: **where it is now → the change → the tokens → how to verify.**

### M1 — Message land (THE headline; the token literally exists for this)

- **Now:** `MessageFeed.svelte` renders message rows with **no entrance transition** — they appear instantly.
- **Change:** assistant replies rise + fade in; user messages do the same (or a hair of scale, `0.98→1`).
  One at a time, no stagger needed. Svelte `in:` transition or a CSS keyframe on the row wrapper.
- **Tokens:** `--dur-base` (220ms, labeled "message land") + `--ease-enter`. Transform: `translateY(6px)→0`,
  opacity `0→1`. Nothing else animates.
- **Pattern proof:** `WorkerPill` already does exactly this with its `wpill-enter` keyframe — match that feel.
- **Verify:** load a thread; each new message arrives with a soft lift, not a pop. Reduced-motion → instant.

### M2 — Send ⇄ Voice button morph

- **Now:** `Composer.svelte:674` `<Send>` vs `685` `<Mic>` is a hard `{#if}` swap — the icon pops when you type.
- **Change:** cross-fade + slight scale between the two states so it reads as the button _transforming_
  (empty = mic, typing = send arrow). The gradient CTA stays; only the glyph morphs.
- **Tokens:** `--dur-fast` (120ms) + `--ease-emphasized`. Opacity + scale only.
- **Verify:** type a character, delete it — the icon should melt between mic↔send, never blink.

### M3 — Tactile press system (unify what's scattered)

- **Now:** some `active:scale-95` exist ad-hoc; not systematic across tappable chrome.
- **Change:** every tappable element (buttons, pills, thread rows, revealed message actions, model chip)
  acknowledges touch with a quick scale-down. The token is literally named for this.
- **Tokens:** `--dur-instant` (80ms, labeled "touch acknowledgment") + `--ease-standard`; `active:scale-[0.96]`.
- **Verify:** every tap feels like it depresses. Pair with CUR's primitives (`SullyButton`/`SullyPill`) so
  it's defined once, not per-site.

### M4 — Sheet / popover spring (token-align the SHEET transitions only)

- **Now:** the sheet transitions at `Composer.svelte:459/471` use `cubicOut` + hardcoded `200ms` — off-language.
  ⚠️ The attach-reveal `fly` at `:574` is canon-protected ("best micro-interaction in the app") — **leave it.**
- **Change:** route sheet/popover open-close through `--ease-sheet` (the token reserved _only_ for
  iOS sheets) + `--dur-panel`. Slide-up + fade for sheets; quick fade + 4px rise for popovers.
- **Tokens:** `--ease-sheet` + `--dur-panel` (sheets); `--ease-emphasized` + `--dur-med` (popovers).
- **Verify:** the model sheet and any popover share one motion feel; nothing uses a raw `cubic-bezier`.
- **Coordinates with CUR's** "one popover glass recipe" (their P1 #7) — same surfaces, motion + material together.

### M5 — New-messages pill entrance (small, high-charm)

- **Now:** the `{n} new messages ↓` pill (`+page.svelte:1209`) exists (good — keep the stick-to-bottom logic).
- **Change:** spring it in/out instead of appearing.
- **Tokens:** `--ease-spring` + `--dur-med`. Scale `0.9→1` + opacity.
- **Verify:** scroll up while a reply streams; the pill springs in.

### M6 — Streaming text cadence (optional polish)

- **Now:** Sully's reply streams token-by-token; the `md-stream-cursor` (already shipped) pulses at the end.
- **Change (optional):** a barely-there fade on each streamed chunk so text _arrives_ rather than blinks.
  Keep it subtle — over-animating streaming text reads cheap.
- **Tokens:** `--dur-fast` + `--ease-standard`, opacity only.

### M7 — Keyboard rise (note; defer the native half to CUR Phase C)

- The web-CSS part (composer + feed tracking the iOS keyboard via VisualViewport) should _ease_, not jump.
  The native `@capacitor/keyboard` piece is CUR Phase C / `ship-ios` territory — **don't duplicate it here.**
  If you touch the web side, use `--dur-med` + `--ease-standard` on the composer's bottom-offset transition.

---

## Verification — the honest part

**Screenshots cannot prove motion.** A static PNG looks identical whether the animation is silky or
broken. So for this layer specifically:

1. **On-device feel is the real gate** — the operator runs it on the iPhone over Tailscale and judges by hand.
2. **Playwright proves the wiring, not the feel** — assert the transition/animation is actually applied
   (computed `transition-duration` ≠ `0s` on the target, or the keyframe class is present) so a regression
   that _removes_ motion is caught. Add one such check per moment.
3. **Reduced-motion pass** — toggle `prefers-reduced-motion: reduce` (Playwright `emulateMedia`) and confirm
   everything renders instantly with no animation. This is a required check, not optional.
4. Standard `companion-deploy-verify` (build → restart → iPhone screenshots) still runs for the at-rest layout.

---

## Paste-ready AGY handoff prompt

```text
You are AGY, doing the MOTION layer of the Sully flagship pass (operator-driven).

Read and execute, in order:
  docs/2026-06-11-flagship-motion-layer-agy.md   (this brief — the motion layer)
  docs/2026-06-11-flagship-visual-pass-plan.md    (CUR's visual plan — context; do NOT redo it)
  docs/design/sully-locked-spec.md                (motion tokens — the source of truth)

Worktree: your OWN worktree off latest origin/main, branch feat/agy-flagship-motion.
  Do NOT edit in cur/ or captain/ or w1/w3. If CUR's Phase A/B hasn't merged yet, STOP
  and ask the operator whether to sequence after it (preferred) or coordinate file ownership.

Load skills: companion-ui-design, svelte-5-runes-disciplinarian, ios-pwa-safe-area,
  companion-deploy-verify.

Hard rules (brief §"Hard rules"): locked tokens only (no raw ms/cubic-bezier),
  transform+opacity only on messages/large surfaces, a prefers-reduced-motion guard on
  EVERY new animation (add the universal neutralizer first), never touch data-testid hooks
  or WorkerPill truth-guard behavior.

Start with M1 (message land) — smallest, highest impact, the token --dur-base is literally
labeled for it. One moment per commit. Verify per the brief's "Verification" section:
on-device feel + a Playwright check that the motion is wired + a reduced-motion pass.
Operator merges; CC reviews for regressions.
```

---

## Why this is safe to hand off

- It's **additive chrome** — no logic, no routes, no dispatch/voice changes, no schema.
- It **reuses tokens that already exist** — minimal new surface area, nothing invented.
- It's **bounded** — 7 named moments, one-per-commit, each independently revertible.
- It **composes with CUR** rather than competing — same worktree discipline, same tokens, mapped to
  the same phases. The two layers (material + motion) are what together read as "flagship."
