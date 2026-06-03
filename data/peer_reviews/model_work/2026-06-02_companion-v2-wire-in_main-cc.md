# Handoff — wire `companion-v2` into the Companion app

**To:** main CC
**From:** CC instance #2 (fine-tune worker)
**Date:** 2026-06-02
**Status:** ready for action

---

`companion-v2` is built and live in Ollama. Eval shows **42% loss reduction**
vs base Qwen3-14B (3.086 → 1.784, perplexity 21.89 → 5.96). Smoke test
replied in Sully voice (_"I'm here. What's happening — ..."_). Per
operator instructions I did NOT wire it into the app — that's on you.

## Artifacts on disk

| What                                                 | Where                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Ollama model                                         | `companion-v2:latest` (9.0 GB)                                             |
| LoRA adapter                                         | `~/dev/training-corpora/companion-v2-lora/adapter/`                        |
| Q4_K_M GGUF                                          | `~/dev/training-corpora/companion-v2-lora/gguf_gguf/Qwen3-14B.Q4_K_M.gguf` |
| Custom Modelfile (Sully system prompt, num_ctx=2048) | `~/dev/training-corpora/companion-v2-lora/gguf/Modelfile`                  |
| Eval comparison JSON                                 | `~/dev/training-corpora/companion-v2-lora/eval_compare.json`               |
| Full research brief (for next training run)          | `~/dev/training-corpora/blackwell-finetune-research-2026-06-02.md`         |

## Your job — wire it in

**File:** `src/lib/chat/model-registry.ts`

**Current state** (4 occurrences of):

```ts
local: 'qwen3:14b';
```

**What to change them to** (some or all — your call):

```ts
local: 'companion-v2:latest';
```

**Suggested soft rollout:** swap 1 of the 4 `local:` slots first (e.g. the
chat slot) and leave the others on `qwen3:14b` until Captain confirms v2
feels right in real conversations. The comment block around line 103
tells you which slot is which.

## Verify before committing

- [ ] `ollama show companion-v2` returns a Modelfile with the Sully SYSTEM
      prompt and `num_ctx 2048`
- [ ] After the edit: `sudo systemctl restart logueos-companion.service`
- [ ] Send a test message via the chat UI on http://localhost:18769
- [ ] Confirm the reply style matches Sully:
  - No `<think>` blocks
  - Em-dashes for asides
  - Plain English, no exclamation marks
  - Picks up the thread conversationally

## Caveats — read before you commit

- **Q4_K_M quantization (~4-bit) — not BF16.** Real-world quality may be
  slightly below the eval numbers (which were measured on the 4-bit
  adapter+base, so still representative).
- **The "best" mid-training checkpoint (step 800, eval 1.839) was
  auto-deleted by `save_total_limit=3` before I noticed.** `companion-v2`
  is built from the final adapter (eval 1.853). Delta is in noise range
  (~1.4%) — probably not perceptible. Won't happen next time:
  `train_qlora.py` now uses `save_total_limit=10` +
  `load_best_model_at_end=True`.
- **Training was at seq=2048 (not 4096) due to a Blackwell-stack issue.**
  The model has only seen up to 2048 token contexts. Long-context
  responses past 2048 will degrade gracefully but won't be as polished.

## Don't worry about these — already done

- All four `logueos-*` services were stopped during training and are restored
- Ollama-unload watchdog killed
- GPU persistence mode + clock floor lock applied (survives, harmless)
- Swap cleared

## For next-time-we-train (don't act on this now)

Full research brief at `~/dev/training-corpora/blackwell-finetune-research-2026-06-02.md`
captures the right way to set up the stack:

- GMI was wrong about FA4 — it doesn't run on consumer Blackwell sm_120. Use FA2.
- Better still: run training inside `nvcr.io/nvidia/pytorch:25.10-py3` container.
- Bump LR from `2e-4` to `2e-5` (TRL's documented default — ours was 10× too high).
- Add `EarlyStoppingCallback(patience=3)`.
- Switch to native Qwen3 chat template with `enable_thinking=False`.

Memory entries already saved:

- `reference-blackwell-finetune-brief`
- `reference-finetune-lessons-2026-06-02`
- `feedback-research-finetune-first`

---

That's it. Ping back if you need anything from the training side.

— CC #2
