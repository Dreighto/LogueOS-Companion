# Sully — Doing Now

> _Last updated: 2026-06-03 · companion: see [CURRENT-STATE.md](CURRENT-STATE.md) · what's next: [PLAN.md](PLAN.md)_
>
> What's actively in flight right now, grounded in git history + the live journal.

## Active focus (operator's stated priorities)

| Project                       | Status        | Note                                                                       |
| ----------------------------- | ------------- | -------------------------------------------------------------------------- |
| **LogueOS-Companion (Sully)** | 🛠️ **Active** | The current build focus. 178 commits in the last 14 days.                  |
| **Miru**                      | ⏸️ Paused     | Operator's "first big project," coming back to it after Companion settles. |
| **Nasdoom**                   | 🔭 Future     | Frontend work pending; backend reported done. Dormant (0 commits/14d).     |

## Just shipped (this session, 2026-06-02 → 06-03)

- **Native iOS push (APNs)** — built server-side, fixed a 4-build signing saga (vanished cert → stable-key + one-time cert reset) AND the real root cause (Capacitor 8 drops the AppDelegate token-forwarding), shipped on **build 15**, verified end-to-end (test push hit the lock screen). `8de7cde…a245f93`
- **Read-aloud / Talkback fixed** — iOS audio-unlock (play through the shared element) + trailing-silence pad (iOS clips WAV ends) + self-heal when the local TTS GPU faults. `513d39a, 9a11aea, ccb0788`
- **Cloud Emma is now primary** for talkback + voice (off-GPU, ~0.6 s, no CUDA-fault risk; local Chatterbox is the fall-forward). One env flip: `VOICE_TTS_PROVIDER=elevenlabs`.
- **Task-first Phase 1** — Task object + forensic journal + `turn_replay.ts` reader API. `c8f6bc1` (+ gate tightening `be62344`).
- **Full app audit + quick-wins batch** — 7-dimension evidence-based audit; 9 quick wins landed (index bug, type error, wrong-thread bug, CI gate, hotkey, dead-code, APNs cache, …). `11f466e`
- **Web tools** wired into text + voice via Ollama Pro. `78dfeb9`

## Open threads (in progress, not finished)

1. **"Today's Ops" dashboard** — the **first task-first real-world test project**. Being scoped _with Sully_ (the point is to watch the architecture run a real project, not for CC to build it directly). Data-sources design written: `data/peer_reviews/2026-06-02_todays-ops-data-sources_design.md`. **Not yet built.** The directory Sully "claimed" to create does not exist — she narrated it without dispatching (she was in `local` tier).

2. **Dispatch / routing** — confirmed working (`@cc`/`@agy` forces it; the auto-gate fires on strong work-signals). The open question: should **Sully's own judgment** be able to drive a dispatch, instead of being vetoed by the keyword regex? (See PLAN.md → decision needed.)

3. **The post-audit refactor** — quick wins done; the higher-effort items (legacy-handler migration, shared DB layer, voice consolidation) are queued behind two decisions and the new CI gate. (PLAN.md.)

## Decisions waiting on you

- **Gate authority** — make Sully's judgment authoritative for dispatch? It changes her behavior (she'd dispatch on phrasing the regex currently blocks, each burning Max quota). Product call.
- **Legacy Talkback** — retire the old in-composer Talkback now that realtime voice is primary?
- **Today's Ops** — kick it off through Sully with `@cc` now, or wire "Sully's judgment drives dispatch" first so it fires on its own?
