# companion-v3 Training Plan
*Drafted 2026-06-02 by the fine-tune CC instance for Captain's review*

## Recommendation in one paragraph

**WHAT:** Train Sully v3 as Qwen3-14B QLoRA on a **rebuilt** corpus (clean the tool-call placeholder pollution out of CH, drop the bland 10× Companion oversample, switch to native Qwen3 chat template with the empty-think wrapper preserved), running inside the **NVIDIA NGC PyTorch 26.05 container** (not the poisoned host venv), with hyperparameters drawn from the official Unsloth Qwen3-14B notebook except **lower LR (1e-4 instead of 2e-4)** and a real **EarlyStoppingCallback** so `load_best_model_at_end` actually picks the optimum. **WHY:** Three independent research streams converged on the same diagnosis — v2 shipped on the wrong chat template, on a corpus contaminated with `"This block is not supported on your current device yet."` placeholders (25.7% of CH pairs), with the persona-anchor oversample reinforcing generic-assistant boilerplate rather than Captain's-Sully voice, and on a host venv that is exactly the stack that lost us the v2 best-checkpoint debugging cycle. **EXPECTED OUTCOME:** v3's raw eval loss may go *up* (because eval-leak no longer artificially deflates it), but response-only NLL on Sully turns drops ≥2%, persona-style linter scores within 5% of corpus target on ≥80% of Sully's 8 markers, and LLM-judge pairwise win-rate ≥55% vs v2 over 150 prompts. Wall-clock: **~7–10 hours end-to-end** (container setup → corpus rebuild → train → eval → GGUF → Ollama register), with most of that being the 3–4 hr training run.

---

## Decisions that need Captain's call

These are the forks where research didn't pick a clear winner. Each has a recommendation but Captain should sign off before we start.

### Decision 1: Thinking-mode strategy — strip it, preserve the wrapper, or train it in?

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Strip entirely** (`enable_thinking=False` end-to-end) | What v2 effectively did. No `<think>` block ever appears. | Simplest. Smallest output. | **One-way door.** Per the [Qwen3-14B model card](https://huggingface.co/Qwen/Qwen3-14B): when `enable_thinking=False`, `/think` is permanently ignored. Locks Sully out of reasoning forever without a retrain. |
| **B. Hybrid — preserve empty wrapper** ⭐ | Train every assistant turn prefixed with `<think>\n\n</think>\n\n`, serve with `enable_thinking=True` + default `/no_think` injection in system prompt. | Same inference behavior as A today. Future optionality intact — Captain can flip `/think` on per-thread later. Matches Unsloth's documented Qwen3 non-thinking template byte-for-byte. ~80ms one-time overhead per turn. | Slightly more complex training pipeline. Small risk that wrapper bleeds into voice-mode TTS (mitigation: parser strips it; smoke-test confirmed). |
| **C. Add 25% reasoning data** | Synthesize 1,000 reasoning examples in Sully's domain. | Preserves thinking-mode capability with measurable headroom. | 1–2 week side project. Off-mission — Sully is a persona companion, not a reasoner. Captain is moving heavy reasoning to cloud models anyway. |

**WHO recommends:** thinking-mode research stream. **WHAT:** Option B (Hybrid). **WHY:** The two research streams contradicted (corpus-quality stream said "add reasoning per Unsloth's 75/25 guide"; thinking-mode stream said "the 75/25 is *optional*, only matters if you want preserved CoT — Sully doesn't need it"). The Hybrid path resolves the contradiction: we get persona fidelity *now* without burning the bridge to reasoning *later*.

---

### Decision 2: LoRA rank — match Unsloth's notebook exactly (r=32) or hold v2's r=16?

| Option | What it means |
|---|---|
| **A. r=32, alpha=32 (ratio 1)** ⭐ | What the [official Unsloth Qwen3-14B notebook](https://colab.research.google.com/github/unslothai/notebooks/blob/main/nb/Qwen3_(14B)-Reasoning-Conversational.ipynb) actually uses (verified by direct WebFetch). More adaptation capacity. |
| **B. r=16, alpha=32 (ratio 2)** | What v2 used. What the generic Unsloth guide recommends. |
| **C. r=16, alpha=16 (ratio 1)** | What [Ivan Potapov's practitioner Qwen3 recipe](https://blog.ivan.digital/finetuning-qwen3-with-lora-done-right-94d6343e1814) uses. Tighter, less overfit risk. |

**WHO recommends:** hardware-hyperparam stream. **WHAT:** Option A (r=32). **WHY:** Trust the model-specific notebook over generic guidance. The only counter-argument is "if v2 already felt *over*-persona-fit, drop to r=16." Captain's call: **did v2 feel under-persona-fit or over-persona-fit?** Answer dictates rank.

---

### Decision 3: Synthetic data for the persona oversample

The 38 Companion source pairs are dominated by bland topics ("what time is it", "hi/hey", "can you access the internet"). Only **1 pair** (Pixel/treehouse/17) actually exercises Captain's-Sully voice with depth. The 10× oversample is amplifying generic-assistant idiom, not Sully.

| Option | What it means |
|---|---|
| **A. Drop oversample to 2–3×** | Smaller signal but no amplification of noise. Sully voice will be weak. |
| **B. Hand-curate 20–30 NEW on-brand pairs** | Captain writes them in a 1–2 hour session. Most authentic. |
| **C. Synthetic — generate via Claude w/ Sully system prompt** ⭐ | 200 high-quality on-brand examples via Claude in ~30 min. Risk: synth-data drift. |

**WHO recommends:** corpus-quality stream. **WHAT:** Option B if Captain has 1–2 hours of writing capacity; otherwise Option C with Captain reviewing the synthetic batch before it goes into training. **WHY:** Both beat shipping bland boilerplate as the persona anchor. **Captain needs to pick A, B, or C — this is the gating decision for corpus rebuild.**

---

### Decision 4: Eval baseline — run v2 through the new 5-pillar eval BEFORE training v3?

| Option | What it means |
|---|---|
| **A. Run v2 baseline first (~4–6 hr)** ⭐ | Apples-to-apples promotion criteria for v3. Adds half a day to total wall-clock. |
| **B. Skip — only score v3** | Saves time. We have no real baseline to compare against. "Better than v2" becomes a vibes call. |

**WHO recommends:** eval-methodology stream. **WHAT:** Option A. **WHY:** We're rebuilding the corpus and the chat template; v2's old eval_loss number is no longer comparable to v3's number. Without a fresh v2 baseline, we can't honestly say v3 is better.

---

### Decision 5: Capability eval scope — full BIG-bench-Lite or just the persona-critical subset?

| Option | Time | Detail |
|---|---|---|
| **A. Full BIG-bench-Lite (24 tasks)** | ~2 hr per model | Comprehensive capability-preservation check. |
| **B. Custom 50-prompt subset + safety probes** ⭐ | ~20 min per model | Faster iteration; targeted at Sully's actual use cases. |

**WHO recommends:** eval-methodology stream. **WHAT:** Option B for v3, file Option A as v4 work. **WHY:** Our priority is "does Sully sound like Sully?" not "did we win MMLU?" — and the full BIG-bench adds 4+ hours to total wall-clock for a question that isn't load-bearing for ship/no-ship.

---

## The recipe (assuming Captain approves the recommendations above)

### Stack install

**Path:** NGC PyTorch 26.05 container (CUDA 13.2.1 + PyTorch 2.12.0a, matches our driver 595 exactly) — NOT the host venv.

**Why container:** The host venv is already poisoned for sm_120 (torch 2.10.0+cu128 → cuBLAS hole per [Unsloth issue #5154](https://github.com/unslothai/unsloth/issues/5154); xformers not built for arch 12.0). Fixing it requires 6 sequential rebuild steps, each with silent-failure modes. `setup_env.sh` has ALREADY drifted (pins torch 2.5.* but disk has 2.10.0). Container = one immutable artifact.

**Step 1 — Stop GPU-consuming services (CRITICAL — VRAM is NOT free):**
```bash
# nvidia-smi currently shows 15052/16311 MiB used. Free it first.
sudo systemctl stop logueos-companion.service
sudo systemctl stop logueos-companion-tts.service
sudo systemctl stop logueos-companion-stt.service
sudo systemctl stop logueos-shadow-loop.service
# Likely also need:
ollama stop companion-v1
# Verify free:
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
# Should show no processes, ~16 GB free.
```
**Time:** 2 min. **Risk:** If something else is squatting on VRAM, training will OOM at model load — must verify before proceeding.

**Step 2 — Install nvidia-container-toolkit (one-time):**
```bash
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```
**Time:** ~10 min.

**Step 3 — Pull NGC image (one-time):**
```bash
docker pull nvcr.io/nvidia/pytorch:26.05-py3
```
**Time:** ~15 min (10 GB pull).

**Step 4 — Smoke-test sm_120 detection:**
```bash
docker run --rm --gpus all nvcr.io/nvidia/pytorch:26.05-py3 \
  python -c 'import torch; print("CC:", torch.cuda.get_device_capability(0)); print("Device:", torch.cuda.get_device_name(0))'
# Expect: CC: (12, 0)
# Expect: Device: NVIDIA GeForce RTX 5060 Ti
```
**Time:** 1 min.

**Step 5 — Verify bitsandbytes + xformers inside container:**
```bash
docker run --rm --gpus all -it nvcr.io/nvidia/pytorch:26.05-py3 \
  bash -lc 'pip install --no-cache-dir unsloth unsloth_zoo bitsandbytes peft trl && \
            python -c "import bitsandbytes; import xformers.ops; print(\"bnb OK, xformers backend:\", xformers.ops.memory_efficient_attention.__module__)"'
```
**Time:** ~5 min (pip install).
**Decision point:** If xformers backend is the sm_120-capable kernel → proceed. If it falls back to "math" → rebuild xformers from source with `TORCH_CUDA_ARCH_LIST=12.0` (one-time, ~15–30 min compile). Per Unsloth's Blackwell guide, FA2 is NOT a substitute on sm_120 ([upstream issue #1763](https://github.com/Dao-AILab/flash-attention/issues/1763) still open).

**Total install time:** ~35 min if xformers prebuilt is fine, ~60 min if we have to rebuild it.

---

### Corpus prep

**Current state:** `/home/dreighto/dev/training-corpora/blend-v1-2026-06-01/` — 3,886 train / 395 eval pairs, but:
- 256 of 995 CH pairs (25.7%) contain `"This block is not supported on your current device yet."` placeholder pollution
- 38 Companion source pairs at 10× oversample, dominated by bland generic-assistant topics (only 1 pair sounds like Captain's-Sully)
- 100% single-turn, 0% reasoning, qwen-2.5 chat template (wrong)
- 4.8% train/eval leakage on low-signal phatic prompts ("Yes", "Done", `<<autonomous-loop-dynamic>>`)

**Action — rebuild into `blend-v2-2026-06-02/`:**

1. **Filter the CH placeholder pollution.** Re-run the CH extractor with a regex that strips `"This block is not supported on your current device yet."` lines from assistant content. Pairs that become empty after stripping get dropped. Expect CH count to drop from 995 → ~739–900 depending on how many were salvageable.

2. **Drop boilerplate CC noise.** Filter pairs where assistant reply is in `{"No response requested.", "Invalid API key · Fix external API key"}` or user prompt is in `{"done", "[Request interrupted by user]", "continue", "<<autonomous-loop-dynamic>>"}`. Expect to drop ~5–8% of CC pairs.

3. **Replace the bland Companion oversample.** Per **Decision 3**: either Captain hand-writes 20–30 on-brand pairs OR we synthesize 200 via Claude with the Sully system prompt. Seed at 5× rather than 10×. Use the Pixel/treehouse/17 pair as the style anchor exemplar.

4. **Wrap every assistant message with the empty think block** (per **Decision 1**):
   ```python
   assistant_text = "<think>\n\n</think>\n\n" + original_assistant_text
   ```

5. **Switch chat template loader** in `build_dataset.py` from qwen-2.5 to native Qwen3:
   ```python
   text = tokenizer.apply_chat_template(messages, tokenize=False, enable_thinking=True)
   ```
   (`enable_thinking=True` because the empty wrapper is now baked into the data — we want the canonical Qwen3 non-thinking shape preserved.)

6. **Strict de-dup** on `hash(user_msg_normalized, assistant_msg_normalized)` across both train and eval. Stricter than the current first-200-char key.

7. **Keep `max_seq_length=2048`** — corpus-quality stream confirms 95.7% of pairs fit at 2048 (83.5% of token volume). Going to 4096 is gated on resolving the xformers-sm_120 question and is a v4 experiment.

**Expected output:** ~3,500–4,000 train pairs (similar size to blend-v1) but materially higher signal density.

**Time:** 1–2 hr (mostly Captain's hand-curation if Decision 3 = Option B; ~30 min if Option C synthetic).

---

### Training config

Single ready-to-paste block for `scripts/finetune/train_qlora.py`:

```python
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
from transformers import EarlyStoppingCallback

# --- Model load ---
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-14B",  # or unsloth/Qwen3-14B-unsloth-bnb-4bit
    max_seq_length=2048,             # KEEP at 2048 — xformers-sm_120 doesn't safely give 4096
    load_in_4bit=True,
    dtype=None,                       # let Unsloth pick bf16 on Blackwell
)

# --- LoRA config (matches official Unsloth Qwen3-14B notebook exactly) ---
model = FastLanguageModel.get_peft_model(
    model,
    r=32,                             # Decision 2: r=32, change to 16 if Captain says v2 was over-persona-fit
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],                                # ALL 7 — QLoRA-All > QLoRA-Attention per Unsloth's published chart
    lora_alpha=32,                    # ratio 1, matches notebook
    lora_dropout=0,                   # bump to 0.05 only if overfitting shows at epoch 2
    bias="none",
    use_gradient_checkpointing="unsloth",  # saves ~30% VRAM
    random_state=3407,
    use_rslora=False,
    loftq_config=None,
)

# --- Training config ---
sft_config = SFTConfig(
    output_dir="/workspace/runs/companion-v3",
    per_device_train_batch_size=1,    # bsz=1/grad_accum=8 = safer on sm_120 than bsz=2/grad_accum=4
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=8,    # effective batch = 8, identical to notebook math
    num_train_epochs=3,               # Unsloth sweet spot 1-3; early-stop picks optimum
    warmup_ratio=0.03,                # within 5-10% band
    learning_rate=1e-4,               # KEY CHANGE FROM V2 (was 2e-4)
                                       # Rationale: Unsloth stable range 1e-4 to 3e-4;
                                       # Ivan Potapov practitioner recipe uses 1e-4;
                                       # top r/LocalLLaMA comment "2e-4 seems awfully high"
    weight_decay=0.01,                # Unsloth recommends 0.01-0.1; notebook 0.001 is for demos
    lr_scheduler_type="cosine",       # practitioner default for multi-epoch
    optim="adamw_8bit",               # matches notebook; paged_adamw_8bit is OOM-fallback only
    seed=3407,
    bf16=True,                        # Blackwell supports bf16 natively
    fp16=False,
    logging_steps=10,
    save_strategy="steps",
    save_steps=50,                    # ~5-6 evals per epoch at our corpus size
    save_total_limit=10,              # already-patched
    eval_strategy="steps",
    eval_steps=50,
    load_best_model_at_end=True,      # already-patched
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    report_to="none",                 # or "tensorboard" if you want graphs
    dataset_text_field="text",
    max_seq_length=2048,
    packing=False,                    # safer default; v4 experiment to enable
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    args=sft_config,
    callbacks=[
        EarlyStoppingCallback(
            early_stopping_patience=3,
            early_stopping_threshold=0.0,
        ),
    ],
)

trainer.train()
```

---

### Run sequence

End-to-end order of operations. Each step is gated on the previous.

```bash
# === PRE-FLIGHT (~10 min) ===
# 1. Stop services, free VRAM
sudo systemctl stop logueos-companion.service logueos-companion-tts.service \
                    logueos-companion-stt.service logueos-shadow-loop.service
ollama stop companion-v1 2>/dev/null
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
# CONFIRM: empty output. If anything is squatting, kill it before proceeding.

# 2. Verify GPU thermals/clocks not throttling (5060 Ti has been 65°C steady; confirm)
nvidia-smi --query-gpu=temperature.gpu,clocks.current.graphics,clocks.current.memory --format=csv
# Expect: <70°C, ~2800 MHz core, full memory clock

# 3. Verify Docker + GPU works
docker run --rm --gpus all nvcr.io/nvidia/pytorch:26.05-py3 \
  python -c 'import torch; assert torch.cuda.get_device_capability(0)==(12,0)'

# === CORPUS REBUILD (~30 min - 2 hr depending on Decision 3) ===
# 4. Rebuild corpus into blend-v2-2026-06-02/
cd /home/dreighto/dev/LogueOS-Companion
python scripts/finetune/build_dataset.py \
    --output /home/dreighto/dev/training-corpora/blend-v2-2026-06-02 \
    --strip-ch-placeholders \
    --filter-cc-boilerplate \
    --wrap-think-empty \
    --chat-template qwen3-native \
    --companion-oversample 5 \
    --strict-dedup

# 5. Verify corpus stats look right
python scripts/finetune/corpus_analysis.py \
    /home/dreighto/dev/training-corpora/blend-v2-2026-06-02

# === V2 BASELINE EVAL (Decision 4 = A; ~4-6 hr; OPTIONAL but recommended) ===
# 6. Build the 5 eval scripts FIRST, then score v2
# (See "Eval methodology" section below)
python scripts/finetune/eval/eval_intrinsics.py --model companion-v1 \
    --corpus /home/dreighto/dev/training-corpora/blend-v2-2026-06-02/eval.jsonl
python scripts/finetune/eval/eval_persona_linter.py --model companion-v1
python scripts/finetune/eval/eval_llm_judge.py --baseline companion-v1 --candidate companion-v1 \
    # (self-comparison sanity check; should land at ~50% win rate ±5%)
python scripts/finetune/eval/eval_operational.py --model companion-v1 \
    --quants Q4_K_M,Q5_K_M

# === TRAINING (3-4 hr) ===
# 7. Launch v3 training in container
docker run --rm --gpus all -it \
  -v /home/dreighto/dev/LogueOS-Companion:/workspace \
  -v /home/dreighto/dev/training-corpora:/corpora \
  -e NVIDIA_IMEX_CHANNELS=0 \
  -w /workspace/scripts/finetune \
  nvcr.io/nvidia/pytorch:26.05-py3 \
  bash -lc 'pip install --no-cache-dir unsloth unsloth_zoo bitsandbytes peft trl && \
            python train_qlora.py --corpus /corpora/blend-v2-2026-06-02 --out /workspace/runs/companion-v3'

# 8. Monitor first 100 steps for OOM/loss-curve sanity
# In another terminal:
nvidia-smi --loop=10
# Watch for: peak VRAM < 15.5 GB (safe), loss decreasing monotonically

# === V3 EVAL (~2-3 hr) ===
# 9. Score v3 on the same eval suite
python scripts/finetune/eval/eval_intrinsics.py --model runs/companion-v3/best
python scripts/finetune/eval/eval_persona_linter.py --model runs/companion-v3/best
python scripts/finetune/eval/eval_llm_judge.py --baseline companion-v1 --candidate runs/companion-v3/best
python scripts/finetune/eval/eval_capability.py --model runs/companion-v3/best
python scripts/finetune/eval/eval_operational.py --model runs/companion-v3/best \
    --quants Q4_K_M,Q5_K_M,Q6_K,Q8_0

# === DECISION POINT — check all 5 gates (see Eval methodology) ===
# If any gate fails → investigate, do NOT promote. Possibly bump LR to 2e-4 and retrain.
# If all pass → continue.

# === GGUF + OLLAMA REGISTER (~30 min) ===
# 10. Merge LoRA into base, convert to GGUF, quantize
bash scripts/finetune/merge_and_gguf.sh \
    --adapter runs/companion-v3/best \
    --base unsloth/Qwen3-14B \
    --out runs/companion-v3/gguf \
    --quants Q4_K_M,Q5_K_M

# 11. Register in Ollama with Qwen3 native template
ollama create companion-v3 -f runs/companion-v3/gguf/Modelfile

# 12. Verify it loads and serves with the wrapper preserved
ollama run companion-v3 "Hey Sully, you online?"
# Expect: response prefixed with <think></think> wrapper (parser strips for display)

# === POST-TRAINING CLEANUP ===
# 13. Restart services
sudo systemctl start logueos-companion-tts.service logueos-companion-stt.service \
                     logueos-shadow-loop.service logueos-companion.service

# 14. Return to main
cd /home/dreighto/dev/LogueOS-Companion
git status  # ensure clean working tree
git checkout main
```

---

### Eval methodology

**5 new scripts under `scripts/finetune/eval/`** — built BEFORE v3 training, run on v2 first to establish baseline.

| Script | What it measures | Time per model |
|---|---|---|
| `eval_intrinsics.py` | Response-only NLL on assistant tokens (the real signal), Acc@1/@5, length-KS divergence, per-source breakdown (CH / CC / Sully) | ~30 min |
| `eval_persona_linter.py` | Deterministic StyleScore for Sully's 8 markers (em-dashes, no exclamations, contractions, no emoji, etc.). Hard-fail flags for forbidden tokens. | ~5 min |
| `eval_llm_judge.py` | Pairwise v2-vs-v3 via Claude Opus judge. 150 prompts. Position-swap. CoT rationale. Tie option. Win rate + 95% CI. | ~20 min (network-bound) |
| `eval_capability.py` | Custom 50-prompt subset + 50 Anthropic HHH safety probes. (Decision 5 = B; full BIG-bench is v4 work.) | ~20 min |
| `eval_operational.py` | TTFT, TPS, peak-VRAM across Q4_K_M / Q5_K_M / Q6_K / Q8_0 via `llama-bench`. Pareto-frontier CSV. | ~1 hr per quant |

**Shared:** `eval_common.py` (model loader, corpus iterator, role-mask helper).

**Decision criteria for v3 promotion — all 5 gates required:**

| Gate | Threshold |
|---|---|
| **1. Intrinsic** | Response-only NLL on Sully turns drops ≥2% vs v2; length-KS within 5% |
| **2. Style** | StyleScore within 5% of target on ≥80% of 8 markers; ZERO hard violations (no `!`, no emoji, no markdown headers) on Sully strata |
| **3. Judge** | v3 win rate ≥55% (ties = 0.5) over 150-prompt pairwise with position-swap |
| **4. Capability** | No task regression >5pp vs v2 |
| **5. Operational** | At Q4_K_M, TTFT and TPS within 10% of v2 |

**Miss any gate → investigate before promotion.** Miss Gates 1+2 → v3 is a regression on its primary purpose; retrain with adjusted hyperparams (likely bump LR to 2e-4 OR drop rank to r=16).

---

## Expected outcomes

### Quantitative

| Metric | v2 | v3 (expected) | Notes |
|---|---|---|---|
| Eval loss (raw) | 1.853 | **likely HIGHER** | Eval-leak removed; less artificial deflation. This is the correct direction. |
| Response-only NLL on Sully turns | unmeasured | drops ≥2% | Primary signal; we didn't measure this on v2. |
| Length-KS divergence (Sully) | unmeasured | within 5% of corpus target | v2 likely over-elaborates; v3 should match Sully's terse register. |
| LLM-judge v3-vs-v2 win rate | n/a | ≥55% (target 60–65%) | 150 prompts, position-swap, Claude Opus judge. |
| Q4_K_M GGUF size | ~8.5 GB | ~8.5 GB (unchanged) | LoRA merge doesn't change base size. |
| TTFT at Q4_K_M | ~250 ms | within 10% of v2 | Operational regression-test. |

### Qualitative

- **Persona match:** Sully should sound like the locked design-system aesthetic — warm + slightly cheeky + uses "Captain" + bullet-point + tactical tone. The Pixel/treehouse/17 pair is the style anchor.
- **Capability preservation:** No degradation on basic factual/code/arithmetic prompts. Hybrid thinking-mode wrapper preserves Qwen3's reasoning channel for future `/think` re-enablement.
- **Tool-call placeholder pollution:** GONE. v2 occasionally emitted `"This block is not supported on your current device yet."` mid-reply because 25.7% of its CH training pairs contained it. v3 won't.
- **Boilerplate noise:** GONE. "No response requested." and "Invalid API key" filtered out of training.

### Operational

- **Wall-clock:** 3–4 hr training (was likely similar for v2; we get back the early-stop benefit).
- **VRAM:** peak <14 GB at bsz=1/grad_accum=8/seq=2048 (vs ~15.5 GB if we'd used bsz=2/grad_accum=4).
- **Inference latency:** Same as v2 at same quant. The empty `<think></think>` wrapper adds ~4 tokens (~80ms one-time per turn) — negligible.

---

## Open risks

Things that could still go wrong despite the research:

1. **xformers inside NGC 26.05 may not be prebuilt for sm_120.** If the smoke test (Step 5) shows it falls back to "math" backend, we need to rebuild from source inside the container with `TORCH_CUDA_ARCH_LIST=12.0`. Adds ~15–30 min compile time. **Mitigation:** smoke-test BEFORE committing to full training run.

2. **bitsandbytes Blackwell support on CUDA 13.2 is unverified.** The prior research brief noted "cu129 preserves bnb compatibility but cu130 breaks it." NGC 26.05 is on cu132. **Mitigation:** smoke-test in Step 5; fallback is NGC 25.10 (documented working with `NVIDIA_IMEX_CHANNELS=0`).

3. **Something is currently holding 11 GB of VRAM that isn't the named TTS/STT processes.** Likely Ollama keeping companion-v1 loaded. If not freed, training will OOM at model load. **Mitigation:** verify in Step 1, kill whatever it is.

4. **LR=1e-4 may underfit.** Three research streams agree it's the right starting point, but if v3 eval loss is meaningfully higher than v2's response-only baseline, the recovery move is bump to LR=2e-4 and re-run. ~3–4 hr cost.

5. **Hybrid `<think></think>` wrapper may bleed into voice-mode TTS.** Parser should strip it cleanly, but worth a 20-prompt smoke test after merge. If it leaks, add an explicit strip step in `stream_prepare.ts`.

6. **Captain-curated Sully pairs (if Decision 3 = B) may take longer than the 1–2 hr estimate.** Hand-writing 20–30 on-brand examples is non-trivial. **Mitigation:** fall back to Decision 3 = C (synthetic via Claude with Captain reviewing the batch).

7. **5060 Ti thermal throttling over 3–4 hr sustained load is untested.** Current operating point is 65°C steady at idle/light load; we don't know what happens at sustained 100% utilization. **Mitigation:** 5-min warm-up dry-run with `nvidia-smi --loop=5` before kicking off the full run.

8. **GMI silent-feature-removal risk if any worker dispatches this.** If we dispatch any part of this to GMI, the GMI PR-review skill applies — verify the diff doesn't strip the EarlyStoppingCallback or the wrapper preservation.

---

## Time budget

| Phase | Time | Confidence |
|---|---|---|
| Pre-flight + service stop | 10 min | High |
| nvidia-container-toolkit install (one-time) | 10 min | High |
| NGC image pull (one-time) | 15 min | High |
| sm_120 smoke tests | 5 min | High |
| xformers rebuild if needed | +15–30 min | Medium |
| Corpus rebuild | 1–2 hr | Medium (Captain hand-curation is the variable) |
| **v2 baseline eval** (Decision 4 = A) | **4–6 hr** | Medium |
| v3 training | 3–4 hr | High |
| v3 eval (all 5 pillars) | 2–3 hr | Medium |
| Merge + GGUF + Ollama register | 30 min | High |
| Service restart + smoke test | 10 min | High |

**Total wall-clock (with v2 baseline):** **~12–17 hours** of work over a 1–2 day window.
**Total wall-clock (skip v2 baseline, Decision 4 = B):** **~7–10 hours** in a single day.

**Confidence interval:** ±30%. The corpus rebuild and xformers smoke-test outcomes are the main variance.

---

## Sources

### Hyperparameter recommendations
- [Unsloth Qwen3 fine-tuning tutorial](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune) — official 75/25 reasoning mix guidance, max_seq_length=2048 recommendation
- [Unsloth LoRA hyperparameters guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide) — all-7-target-modules rationale, early-stopping recipe, LR stable range
- [Unsloth Blackwell guide](https://unsloth.ai/docs/blog/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth) — xformers TORCH_CUDA_ARCH_LIST=12.0 build, FA2 unavailability
- [Unsloth gradient-accumulation bug fix blog](https://unsloth.ai/blog/gradient) — bsz/grad_accum equivalence
- [Official Unsloth Qwen3-14B Colab notebook](https://colab.research.google.com/github/unslothai/notebooks/blob/main/nb/Qwen3_(14B)-Reasoning-Conversational.ipynb) — verified r=32/alpha=32, adamw_8bit, lr=2e-4
- [Ivan Potapov: Finetuning Qwen3 with LoRA done right](https://blog.ivan.digital/finetuning-qwen3-with-lora-done-right-94d6343e1814) — practitioner LR=1e-4 recipe
- [Kaitchup hyperparameter guide](https://kaitchup.substack.com/p/a-guide-on-hyperparameters-and-training) — optimizer selection
- [r/LocalLLaMA: Findings from LoRA Finetuning for Qwen3](https://www.reddit.com/r/LocalLLaMA/comments/1kkl39r/findings_from_lora_finetuning_for_qwen3/) — community LR consensus

### Thinking-mode strategy
- [Qwen3-14B model card](https://huggingface.co/Qwen/Qwen3-14B) — hard/soft switch asymmetry
- [QwenLM/Qwen3 GitHub](https://github.com/QwenLM/Qwen3) — Qwen3-Instruct-2507 thinking-off tool-use validation
- [Mueller end_thinking write-up](https://muellerzr.github.io/til/end_thinking.html) — empty wrapper token cost analysis

### Container / NGC stack
- [NGC PyTorch 26.05 release notes](https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-26-05.html) — CUDA 13.2.1 + PyTorch 2.12.0a
- [Unsloth GitHub issue #5154](https://github.com/unslothai/unsloth/issues/5154) — torch 2.10.0+cu128 cuBLAS sm_120 hole
- [Dao-AILab flash-attention #1763](https://github.com/Dao-AILab/flash-attention/issues/1763) — sm_120 kernels still missing
- [unsloth/unsloth Docker Hub](https://hub.docker.com/r/unsloth/unsloth) — alternative image

### Eval methodology
- [Cameron Wolfe: LLM-as-a-Judge](https://cameronrwolfe.substack.com/p/llm-as-a-judge) — pairwise comparison best practices
- [BentoML LLM Inference Metrics](https://bentoml.com/llm/llm-inference-basics/llm-inference-metrics) — TTFT/TPS framing
- [Mozilla Foundation: Evaluation Harness](https://www.mozillafoundation.org/en/blog/evaluation-harness-is-setting-the-benchmark-for-auditing-large-language-models/) — lm-evaluation-harness as standard
- [BIG-bench GitHub](https://github.com/google/BIG-bench/) — capability eval suite
- [arXiv 2504.12491v2](https://arxiv.org/html/2504.12491v2) — response-only loss methodology
- [arXiv 2510.09369v1](https://arxiv.org/html/2510.09369v1) — Acc@k interpretability
- [NAACL 2025 SRW #41](https://aclanthology.org/2025.naacl-srw.41/) — deterministic style metrics

### On-disk references
- `/home/dreighto/dev/training-corpora/blend-v1-2026-06-01/blend.json` — current corpus manifest
- `/home/dreighto/dev/training-corpora/blackwell-finetune-research-2026-06-02.md` — prior research brief (Fork 4 thinking-mode recommendation, now superseded by Hybrid)
- `/home/dreighto/dev/LogueOS-Companion/data/peer_reviews/model_work/2026-06-02_unsloth-qwen3-14b-recipe.md` — Unsloth Qwen3-14B specific recipe doc
- `/home/dreighto/dev/LogueOS-Companion/scripts/finetune/train_qlora.py` — current training script (will be patched per the config block above)
- `/home/dreighto/dev/LogueOS-Companion/scripts/finetune/setup_env.sh` — DRIFTED, do not trust (pins torch 2.5.* but disk has 2.10.0)
- `/home/dreighto/dev/LogueOS-Companion/scripts/finetune/merge_and_gguf.sh` — GGUF pipeline (works as-is)
- `/tmp/corpus_analysis_out.txt` — full corpus quality analysis output