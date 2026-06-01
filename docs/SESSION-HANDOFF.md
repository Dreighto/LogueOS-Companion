# LogueOS-Companion — Session Handoff

**Last updated:** 2026-06-01 (CC) · **Read this first**, plus memory `project_companion_repos`, `reference_companion_chat_module_map`, and `reference_companion_chat_context_architecture`, to resume.

Sully = local AI companion. SvelteKit (adapter-node, Svelte 5 runes, Tailwind 4) PWA + Capacitor iOS shell, port **18769**, base path **`/companion`**. Operator = **dreighto ("Captain")**, non-technical → lead every reply in plain English. Restart after backend changes: `npm run build && sudo systemctl restart logueos-companion.service`.

---

## 1. Current state

- Branch **`main`**; tree clean except untracked throwaway mockups (`static/facelift/`, `mockup-drawer.html`, `docs/design/ref_material/`, a peer-review md) — do NOT commit these.
- Build clean · **115/115 vitest** · `svelte-check` 0 errors (1 pre-existing `DispatchChips.svelte` warning).
- **11 commits UNPUSHED on `main`.** Pushing fires the **GitHub Actions iOS build** — the operator gates the build on push and has NOT said "push" yet. **Confirm before `git push`.**

```
4c4552a slice 6 — font-mono → font-sans on chat chrome
d70c1fd slice 5 — split companion_tools by responsibility
bdd1026 slice 4 — extract MessageFeed + SullyNameTag + message-actions
2aac713 slice 3 — split sdk-stream into orchestrator + helpers
10834d9 slice 2 — unify model lineup into one registry
39fc8da slice 1 — remove verified dead code
d814755 feat — prominent Den, thinking-only composer glow, branded tool indicators
dc9b0e7 feat — "The Den" home + fresh-thread-on-open landing
2934b96 fix — load hot-window history server-side (context survives model switches)
b581aa9 feat — tactile message footer + working monster in thinking row
a59b04f fix — model picker toggle + animation, image typography, Opus 4.8
```

---

## 2. Shipped THIS session

**Chat-section facelift (done + browser-verified):** model-picker toggle/animation fixed, all 10 models verified live; **context preserved across model switches** (the big fix, §4); image-mode + footer + tool indicators retyped to Inter; tiny working-monster avatar in the thinking row; **"The Den"** home (pinned top + magenta-highlighted) with **fresh-thread-on-open** landing; composer glow now only while thinking (was a constant glow that read as "still working").

**Refactor — 6 slices, structure-only, behavior-preserving, final 4-dimension sanity audit CLEAN (zero regressions):**

1. Dead-code removal (dictation path, `openChip`, unused imports, `upsertThreadTier_local`, `switchRepo`); fixed an already-broken `mobile-pwa-check.mjs`.
2. Model lineup unified → `src/lib/chat/model-registry.ts` (single source of truth; `model-choices.ts` + `model_catalog.ts` derive from it).
3. `sdk-stream/+server.ts` → thin orchestrator (parse → `prepareStream` → branch) + `chat/stream_prepare.ts` + `chat/autonomous_dispatch.ts` + `chat/base_tools.ts`.
4. `+page.svelte` **1353 → 989 lines** → `MessageFeed.svelte` + `SullyNameTag.svelte` + `message-actions.svelte.ts`.
5. `companion_tools.ts` 571 → 255 → `chat/{fs_guard,web_search,consult,secret_scan}.ts`.
6. `font-mono` → `font-sans` on chat chrome (code blocks + WorkingBubble diagnostics kept mono).

This completes the old handoff's "② Frontend rebuild → decompose the 1,200-line +page.svelte" item. Full module map: memory `reference_companion_chat_module_map`.

---

## 3. OPEN ITEMS — pick up here

### Decisions for the operator

- **PUSH?** 11 commits unpushed; push → iOS build. Recommend pushing so the context fix + facelift reach his phone — ask first.
- **Web-search quality (he flagged):** local model (`companion-v1`) answered "latest Drake song" with a 2023 song — it didn't use/trust the live search (the search tool itself is fine: Perplexity→Firecrawl, both live). Options awaiting his pick: (1) route "latest/current/news" queries to a cloud model; (2) wire Ollama's hosted web search (he now has an Ollama Pro key); (3) strengthen the search prompt (cite dates, don't answer current events from memory); (4) train companion-v1 to call tools. Recommend **#1 + #3**. Evidence thread: `chat-u6coxkki`.
- **Spaces ↔ threads design:** he wants "The Den" as a _home space_ grouping threads, alongside project spaces. Today it's the `default` thread pinned + highlighted. Needs a short design pass (he's open to mockups) before the sidebar build.
- **Stack audit (soon):** Claude Max + **Ollama Pro** (~$20/mo, ~50× free usage, 3 concurrent cloud models, full big-model catalog incl. qwen3-coder/deepseek/glm/gpt-oss, hosted web search, no per-token billing, prompts not logged) + Gemini bucket; weighing Cursor Pro re-sub. Keep/dump/archive deliberately.

### Operator tasks open

- **Sidebar slide animation + top safe-area fix** — sidebar runs under the dynamic island (close button confirmed off-screen). Add `pt-safe` + slide-in. Next UI chunk; ties into the spaces design above.
- **iOS keyboard-open delay** — operator reports lag opening the keyboard on chat threads. No app-side bug from desktop (input already 16px, no deferred autofocus). Suspect: always-on `.app-aurora` + `backdrop-blur-2xl` recompositing during the keyboard animation, and/or Capacitor WKWebView keyboard resize mode (no `@capacitor/keyboard` config present). **Diagnose on-device with the operator** before changing the look.

### Deferred refactor (audit-confirmed future work, NOT regressions)

- `realtime-voice.svelte.ts` (~829 lines) → split STT / reply-stream / TTS.
- Legacy `routes/api/chat/+server.ts` (~600 lines, @cc/@agy/image-gen non-stream path) → consolidate into the sdk-stream pipeline (PR 2b.2).
- Extract workspace-context state from `+page.svelte` → controller.
- Extract the inline popover-dismiss `$effect` → reusable controller.
- hex→token color remap (`#ec2d78`→`bg-brand` etc.) — deferred (no visible benefit, drift risk; only if exact-match verified).
- Layer 4 procedural memory (from prior session, still open — see §6).

### Housekeeping

- Stray verification threads in the chat DB: `chat-un6qavhh` ("say hi"), maybe `chat-rvwbl`. **KEEP `chat-smw58`** (the Pixel/treehouse/17 cross-model demo) + `chat-u6coxkki` (Drake evidence). Delete needs archive-first (`PATCH` then `DELETE /api/chat/threads/[id]`) or the sidebar "Clear all".

---

## 4. Gotchas / landmines (don't re-learn these)

- **Chat context is assembled SERVER-side** in `chat/stream_prepare.ts` (hot-window 20 from `chat_messages` + Layer-1 summary + Layer-3 facts). The frontend sends ONLY the current turn (`streaming.svelte.ts` resets `sdkChat.messages=[]`). Any send-path change MUST keep the server loading the hot window or model switches go amnesiac. (`reference_companion_chat_context_architecture`.)
- **Verify in the browser, not from code.** "Context passes to all providers" was wrong until a live cross-model test caught it. (`feedback_browser_verify_required_for_ui`.)
- **Cursor/Codex audits = candidates, not gospel.** Their refactor audit's "don't break the mobile check" constraint was backwards (the check was already broken). Verify removal claims before acting.
- `buildSystemPrompt` is **async** — any new caller must `await` it + pass the user message, or you get `[object Promise]` in the prompt.
- Semantic recall filters by `embed_model` — **changing the embed model orphans existing vectors**. Needs `ollama pull mxbai-embed-large`.
- `serverConfig.memoryDbPath` defaults to the shared orchestrator DB; the `.env` `LOGUEOS_MEMORY_DB_PATH` override points to the private `companion.db`. **Keep the override** or personal facts leak into the team DB.
- `chat_messages.sender` ∈ `operator`/`local`/`cc`/`agy`/`system` — **never** `user`/`assistant` (the model mapping happens in `stream_prepare.ts`).
- Opus is `claude-opus-4-8` (bumped this session). Sonnet/Opus route via the **CLI bridge** (OAuth/Max), not API key.
- The iOS shell loads the **remote** tailnet URL — frontend changes deploy by rebuilding locally + restart (no reinstall/CI); only **native** changes (push, plugins, icon, permissions) need a CI build.
- Svelte 5 runes only. Preserve all `aria-label` / `data-popover(-trigger)` / `data-testid` (`sdk-tool-row`, `pwa-update-prompt`) + the selectors `mobile-pwa-check.mjs` clicks.

---

## 5. Project shape & services (durable)

- **Two repos:** `~/dev/LogueOS-Companion` (app, :18769) + `~/dev/companion-speech` (STT :18770 / TTS :18771, on-demand to free the GPU).
- **Design spec (source of truth):** `docs/superpowers/specs/2026-05-30-sully-companion-rebuild-design.md`; UI language in the `companion-ui-design` skill (D7, magenta = identity only).
- **Brain:** `companion-v1` (qwen3:14b) via `COMPANION_DEFAULT_MODEL`. **Embed:** `mxbai-embed-large`. **Auto** tier → local `companion-v1`.
- **4-layer memory (L1–L3 shipped):** L1 working summary (`working_memory.ts`), L2 episodic (`episode_extractor.ts`, `remember_flag`), L3 semantic (`semantic.ts`, cosine, threshold 0.42). Memory rides in the system prompt so it persists across model switches.
- **URLs:** tailnet-only `https://room.taila28611.ts.net:8444/companion` (needs Tailscale + MagicDNS on the phone; iCloud Private Relay breaks MagicDNS) · public Funnel `https://room.taila28611.ts.net/companion`.

## 6. Older roadmap still open

- **Layer 4 — procedural memory:** the seam is ready (`buildSystemPrompt` composes layers). Needs a design: a companion-owned `sully_rules` store (do NOT read the orchestrator's `lessons` table — it's team-ops) + a population mechanism (operator rules and/or promotion from high-importance episodic facts) + inject as `## Rules I follow:`. Brainstorm-worthy.
- **iOS Build 2 = push notifications:** add `@capacitor/push-notifications`, `aps-environment` entitlement in `ci-ios-patch.sh`, the `plugins.PushNotifications` block, register/listener in the web app (guarded by `Capacitor.isNativePlatform()`), wire APNs `.p8` into the push dispatcher, gate the web SW off in native. iOS pipeline runbook: `docs/ios-build-runbook.md`. Apple: bundle `com.dreighto.sully`, Team `G3KJW4VXM9`. (Note: this session's pushes go through **GitHub Actions** `.github/workflows/` now, not Codemagic.)

## 7. Verify before declaring done

```
cd ~/dev/LogueOS-Companion
npm run build           # must succeed
npx vitest run          # 115 passed
npx svelte-check        # 0 errors (1 pre-existing DispatchChips warning OK)
sudo systemctl restart logueos-companion
# Browser smoke at 390x844 via Playwright MCP — dismiss the "Update ready" toast first.
```
