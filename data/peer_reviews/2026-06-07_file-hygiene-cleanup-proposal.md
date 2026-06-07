# File Hygiene + Cleanup Proposal (operator-flagged 2026-06-07)

**Trigger:** Operator caught sprawl — "screenshots and files in the ~/dev directory" that don't belong there.

## What I cleaned (mine only, executed)

| File                                              | Action                                                       | Why                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `~/dev/phase3-prod-state-B-expanded.png`          | → `LogueOS-Companion/data/peer_reviews/2026-06-07-evidence/` | Today's Playwright evidence; preserve in canonical location |
| `~/dev/phase3-stateA-compact.png`                 | → same evidence dir                                          | Today's Playwright evidence                                 |
| `~/dev/phase3-stateC-detail-sheet.png`            | → same evidence dir                                          | Today's Playwright evidence                                 |
| `~/dev/phase2a-pill-verified-prod.png`            | → same evidence dir                                          | Today's Playwright evidence                                 |
| `~/dev/real-brand-icons-live.png`                 | deleted                                                      | Brand-icons work shipped Jun 6 (commit f20c097); stale      |
| `~/dev/work-surface-brand-icons-midflight.png`    | deleted                                                      | Same — shipped + stale                                      |
| `~/dev/work-surface-brand-icons-multi-worker.png` | deleted                                                      | Same                                                        |
| `LogueOS-Companion/.gitignore`                    | Added: `.playwright-mcp/`, `/*.png`, `/*.jpg`, `/*.jpeg`     | Prevent future repo-root image drops from getting committed |

Per memory `feedback_scope_cleanup_to_own_artifacts` — touched only what I created.

## Files I did NOT touch (need your call)

These predate this session OR were produced by other agents/sessions. Listing them so you can decide:

### `~/dev/` top level (other agents' / older work)

| File                                                 | Likely owner             | Suggestion                                                                                    |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `~/dev/bench_routing.py` (Jun 7 11:17)               | unknown agent / operator | Move to `~/dev/LogueOS-Orchestrator/tools/` if it's a routing benchmark, or delete if scratch |
| `~/dev/cdx-stronger-glow.png` (Jun 6 19:32)          | CDX audit                | Move to `LogueOS-Companion/docs/Screenshots /work_surface_doc/` (where his other shots live)  |
| `~/dev/doctrine-needs-sheet.png`                     | design ref               | Move to `LogueOS-Companion/docs/design/Sully_Work_Surface/work_surface_reference/`            |
| `~/dev/doctrine-running-sheet.png`                   | design ref               | Same                                                                                          |
| `~/dev/icons-shipped.png`                            | design ref               | Same                                                                                          |
| `~/dev/icons-waiting-graph.png`                      | design ref               | Same                                                                                          |
| `~/dev/minecraft-dashboard-facelift-mobile.png`      | minecraft work           | Move to `~/dev/minecraft-dashboard/`                                                          |
| `~/dev/minecraft-dashboard-glass-command-center.png` | minecraft work           | Same                                                                                          |

### `LogueOS-Companion/` root (untracked .md scratch from prior sessions)

| File                          | Content             | Suggestion                                  |
| ----------------------------- | ------------------- | ------------------------------------------- |
| `chatterbox-vram-report.md`   | TTS GPU diagnostic  | Move to `data/audits/` or delete if shipped |
| `offload-box-requirements.md` | Jetson offload spec | Move to `docs/design/`                      |
| `piper-investigation.md`      | Piper TTS research  | Move to `data/peer_reviews/`                |
| `tts-diagnostic.md`           | TTS troubleshooting | Move to `data/audits/`                      |

## Standing rule proposal — for ALL agents going forward

**Rule:** Agent-produced artifacts go to canonical locations:

- **Playwright / browser test evidence** → `<repo>/data/peer_reviews/<YYYY-MM-DD>-evidence/`
- **Audit / investigation docs** → `<repo>/data/peer_reviews/` or `<repo>/data/audits/`
- **Design references / mockups** → `<repo>/docs/design/`
- **Screenshots from real device** (operator's phone, screenshots app) → `<repo>/docs/Screenshots /work_surface_doc/`
- **NEVER** drop files at `~/dev/` root or repo root — those are stable namespaces

**For CC specifically:** when invoking Playwright with `filename:`, use absolute path including the evidence dir. When invoking shell from a worktree/repo, set explicit CWD for any `mkdir`/`mv`/`cp`.

If you greenlight, I'll save this rule as a feedback memory + start applying immediately in any future sessions.

## Refactor scope I'd recommend but NOT execute without your call

1. **Move the 4 untracked .md files** in LogueOS-Companion root (chatterbox/offload/piper/tts-diagnostic) into their right homes per the table above.
2. **Move the 6 ~/dev/ top-level artifacts** (cdx, doctrine, icons, minecraft) into their right repos.
3. **Add a `.gitignore` at `~/dev/` level** to flag any new repo-root drops — though that's risky since ~/dev/ contains multiple repos.
4. **Audit `LogueOS-Companion/docs/Screenshots /`** — folder name has trailing space, lots of operator screenshots mixed with worker outputs. Consider renaming to `docs/screenshots/` (no space, no caps).

The hygiene rule above is the load-bearing piece — the cleanup of existing files is just one-time housekeeping after that's in place.
