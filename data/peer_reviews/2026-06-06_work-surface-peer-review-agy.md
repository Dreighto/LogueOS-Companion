# Sully Work Surface — Peer Review (AGY)
## Executive summary
The dock and sheet architecture are structurally sound and handle density well, but the visual execution fails the "operator cockpit" reframe. The surface is still styled like a companion feature: status is conveyed through loud brand colors (magenta) instead of semantic telemetry, and the motion is decorative layout-noise rather than event-driven signal. Overall, the implementation needs a course correction back to the disciplined restraint of the CDX audit. The single biggest issue is the undisciplined use of `--color-brand` for active states, which creates visual shouting and breaks status recognition.

## 1. Information hierarchy
**Observation:** The card header is generic ("Detailed Telemetry", default Send icon) and the stage pills fight the ownership banner for attention. 
**Evidence:** `src/lib/components/WorkSurfaceCard.svelte:82-84` hardcodes the label "Detailed Telemetry" and `<Send size="18" />`. Screenshot `01_sheet_glance.png` shows the bright pink APPROVE pill dominating the visual weight over the critical "Now: Halted at safe Gate" banner.
**Impact:** The operator's eyes are drawn to the static stage pipeline instead of the active blocker or the current system action.
**Recommendation:** Drop "Detailed Telemetry" and the Send icon. Restore the dynamic operator banner ("Next: [action]") from the approved mock. Demote the stage pipeline to a subtle, thin progress track.

## 2. Stage pills (StageTimeline)
**Observation:** The timeline is a row of equally weighted, highly saturated pills that wrap poorly and include non-work states.
**Evidence:** `src/lib/components/StageTimeline.svelte:14` uses `flex-wrap` and `stage-pill.active` applies `var(--color-brand)` (pink). Screenshot 01 shows both BUILD and APPROVE as active/pink simultaneously. "Reply" is listed as a stage.
**Impact:** It looks like a tag cloud, not a pipeline. Multiple active pink pills break the "one current stage" mental model.
**Recommendation:** Replace the discrete pills with a unified, segmented line (like a GitHub Actions or Linear progress bar). Use `--color-st-run` for the single active segment. Remove "Reply" entirely as it's a chat-routing event, not a work phase.

## 3. Motion (WorkGraph + indicator)
**Observation:** Motion is continuous, layout-driven decoration, not a reflection of data flow. Idle states are never quiet.
**Evidence:** `src/lib/components/WorkGraph.svelte:216` derives packets purely from the current `task.stage`. `WorkGraph.svelte:350` and `373` run `rotateOrbital` and `coreFieldBreath` infinite loops regardless of event activity.
**Impact:** The "flying square" problem: motion provides no telemetry because it never stops. The operator learns to ignore it as background noise.
**Recommendation:** Bind animations strictly to event frames (`dispatch_started`, `result_arrived`) as specified in the CDX audit. Drop the infinite `rotateOrbital`. When `task.state === 'idle'`, the graph must be completely static (opacity 0.4).

## 4. Spacing + rhythm
**Observation:** The card feels boxed-in and the layout is dense with borders rather than utilizing whitespace. 
**Evidence:** `src/lib/components/WorkSurfaceCard.svelte:213` defines borders around the card, the ownership banner (`border-border`), and the proof cards. `src/lib/components/WorkSurfaceDock.svelte:307` adds more borders to the accordion headers.
**Impact:** A "box-in-a-box" effect that makes the UI feel cramped and heavy, reducing scan speed.
**Recommendation:** Remove the explicit borders on the inner ownership banner and accordion headers. Rely on subtle background differences (`bg-surface/50`) and consistent padding to establish hierarchy.

## 5. Brand + status discipline
**Observation:** The muted-rose brand color (`--color-brand`) is incorrectly used across the board for active work states, overriding the semantic cockpit palette.
**Evidence:** `src/lib/components/WorkSurfaceCard.svelte:348` uses `bg-brand` for active status pills. `src/lib/components/WorkSurfaceIndicator.svelte:101` uses `bg-brand` for the running dot. The Approve button is explicitly `bg-brand` (Screenshot 1).
**Impact:** Magenta becomes meaningless. A "Needs Approval" state button shouldn't be the brand color, it should be semantic amber or green.
**Recommendation:** Strip `--color-brand` from all state representations. Use `--color-st-run` for running/active, `--color-st-needs` for blocked/waiting, and `--color-st-done` for complete. Change the Approve button to `--color-st-needs` or a muted green.

## 6. Mobile (390px)
**Observation:** Primary touch targets fail the 44px minimum requirement for mobile, risking mis-taps.
**Evidence:** `src/lib/components/WorkSurfaceCard.svelte:383` sets `px-3 py-1.5` on `.action-btn`, yielding ~28px height. `src/lib/components/WorkSurfaceIndicator.svelte:93` sets `h-9` (36px).
**Impact:** Frustrating mobile experience, especially for critical actions like "Stop" or "Approve". 
**Recommendation:** Apply `min-h-[44px]` to `.action-btn`, the indicator pill, and the accordion headers. Ensure the `StageTimeline` (once refactored to a line) doesn't overflow horizontally.

## 7. Accessibility
**Observation:** Interactive list items in the dock use `div` elements instead of semantic buttons, and the graph lacks ARIA descriptions.
**Evidence:** `src/lib/components/WorkSurfaceDock.svelte:148` uses `<div role="button" tabindex={0} onclick...>` for dock rows. `src/lib/components/WorkGraph.svelte` has no `aria-label` or `role="img"`.
**Impact:** Screen readers will struggle to parse the dock items natively, and the graph is a black box.
**Recommendation:** Convert the `div role="button"` elements in `WorkSurfaceDock.svelte` to semantic `<button>` elements. Add `role="img"` and a descriptive `aria-label` to the `<svg>` in `WorkGraph.svelte` explaining the current topology.

## 8. Cockpit reframe consistency
**Observation:** Anthropomorphic buddy-language persists in the work surface labels.
**Evidence:** `src/lib/components/WorkSurfaceCard.svelte:71` reads "Sully: {task.state}".
**Impact:** Fails the psychological reframe from "chat buddy" to "operator cockpit system view".
**Recommendation:** Change "Sully: {task.state}" to "System: {task.state}" or simply the Task ID/Title. Keep the "Sully" name and orb restricted entirely to the chat lane.

## 9. What's missing
**Observation:** Key operational flows are unhandled in the current implementation.
**Evidence:** No UI for clearing/scrubbing completed tasks. Real assets (worker icons, payload shapes) are missing (using placeholder dots in `WorkGraph.svelte:278`).
**Impact:** The dock will eventually fill with stale "Done" tasks, and the graph looks unfinished without the semantic SVGs.
**Recommendation:** Implement the 10-second auto-fade for "Done" items to a collapsed, scrubbable history group. Import and wire up the SVG sprite definitions for the real worker/system icons.

## 10. What should be removed
**Observation:** Leftover mock code and vestigial animations clutter the codebase.
**Evidence:** `specialSystemInputEdge` is hardcoded to `{340, 105}` in `src/lib/components/WorkGraph.svelte:223`. The `StageTimeline` wrap-row layout is fundamentally flawed.
**Impact:** Tech debt and visual noise.
**Recommendation:** Delete the hardcoded input edge. Delete the discrete pill layout in `StageTimeline`. Strip out the infinite loops (`rotateOrbital`, `coreFieldBreath`).

## Stay-as-is (do not touch)
- **The Accordion Sheet:** Progressive disclosure via the `openSections` accordion (`WorkSurfaceDock.svelte`) is excellent. It perfectly manages density by keeping the glance layer clean.
- **Optimistic Spawning:** The state grouping (`running`, `needsYou`, `done`) in the rail is exactly the right architectural spine for concurrency. 
- **The Indicator Pill:** Rebinding the pulse to just the pill border (rather than ghosting the whole chat UI) was a smart, precise fix.

## DO-FIRST 5 (ranked by leverage)
1. **Purge `--color-brand` from status indicators.** Re-map all active/running UI (pills, dots, graph nodes, action buttons) to the semantic `--color-st-*` palette.
2. **Bind motion to events, not layout.** Remove the infinite orbital/breathing loops in `WorkGraph.svelte`; motion must require an active data-flow event.
3. **Enforce 44px mobile tap targets.** Fix `.action-btn` and the indicator pill heights to prevent mobile mis-taps.
4. **Refactor StageTimeline to a segmented track.** Kill the noisy wrap-row of pink pills; make it a quiet, single-line progress indicator and remove "Reply".
5. **Convert dock `div`s to `<button>`s.** Fix the accessibility regression in `WorkSurfaceDock.svelte` rows.
