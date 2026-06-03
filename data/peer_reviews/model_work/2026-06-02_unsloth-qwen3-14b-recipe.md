# Unsloth recipe — fine-tuning Qwen3-14B on the 5060 Ti
*Scraped from Unsloth docs on 2026-06-02*

## TL;DR

Unsloth's official line for Qwen3-14B on a 16 GB consumer Blackwell card is **QLoRA in 4-bit at `max_seq_length=2048`** — that's the exact recipe they claim "fits comfortably in a Google Colab 16GB VRAM Tesla T4" ([source](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune)), which is the same VRAM class as our 5060 Ti. The model checkpoint to load is `unsloth/Qwen3-14B-unsloth-bnb-4bit` (Unsloth's dynamic 4-bit), NOT plain `unsloth/Qwen3-14B`. **Where our 2026-06-02 run diverges from what Unsloth would recommend:** (1) we used the `qwen-2.5` chat template — Unsloth/Qwen explicitly want the native Qwen3 template with the `enable_thinking` flag, and our `qwen-2.5` choice will silently destroy the model's thinking-mode behavior at inference; (2) our `grad_accum=8` is double Unsloth's documented default of 4 (effective batch 8 vs 8 — actually the same, but our `bsz=1` is half their `bsz=2`); (3) our `LR=2e-4` matches Unsloth's generalist default exactly; (4) our LoRA `r=16/alpha=32` is reasonable but the Unsloth docs page itself does not pin a specific r/alpha for Qwen3-14B — the live values live in the Colab notebook, not the docs page. Biggest issue: the chat template mismatch. Second biggest: we are not on the Blackwell-recommended install path (cu128 wheels + `TORCH_CUDA_ARCH_LIST=12.0` + `triton>=3.3.1`), which we should verify before the next run to avoid silent sm_120 fallbacks.

## The recipe (copy-paste)

**Install (Blackwell / 5060 Ti path — uv flow recommended by Unsloth):**

```bash
# 1. uv + Python 3.12 venv
curl -LsSf https://astral.sh/uv/install.sh | sh && source $HOME/.local/bin/env
mkdir 'unsloth-blackwell' && cd 'unsloth-blackwell'
uv venv .venv --python=3.12 --seed
source .venv/bin/activate

# 2. vLLM with the cu128 wheel (CRITICAL — default install lands cu126 which won't run on sm_120)
uv pip install -U vllm --torch-backend=cu128

# 3. Unsloth + deps
uv pip install unsloth unsloth_zoo bitsandbytes

# 4. Triton >=3.3.1 (required for Blackwell)
uv pip install -U "triton>=3.3.1"

# 5. Latest transformers (Qwen3 requires >=4.51.0 or KeyError: 'qwen3')
uv pip install -U transformers

# 6. (Optional) xformers from source for sm_120 — skip for now, PyTorch SDPA is the fallback
# export TORCH_CUDA_ARCH_LIST="12.0"
# pip install ninja && git clone --depth=1 https://github.com/facebookresearch/xformers --recursive
# cd xformers && python setup.py install && cd ..
```

**Model load (FastModel.from_pretrained — adapted from the 30B-A3B MoE example shown on the docs page; the page does NOT show this exact call for dense 14B, but the API is identical — swap the model_name):**

```python
from unsloth import FastModel
import torch

model, tokenizer = FastModel.from_pretrained(
    model_name = "unsloth/Qwen3-14B-unsloth-bnb-4bit",  # dynamic 4-bit, NOT plain bnb-4bit
    max_seq_length = 2048,           # Unsloth's recommended testing default for Qwen3
    load_in_4bit = True,             # QLoRA — the only realistic path at 16 GB
    load_in_8bit = False,
    full_finetuning = False,
)
```

**LoRA config** — *The docs page for Qwen3-14B does NOT publish exact r/alpha/target_modules values; those live inside the linked Colab notebook (`Qwen3_(14B)-Reasoning-Conversational.ipynb`) which we did not scrape this round.* Our run used `r=16, alpha=32` which is a common and reasonable choice but is NOT verified-by-source for Qwen3-14B specifically. Treat the snippet below as our best inference from Unsloth's general guidance:

```python
# UNVERIFIED for Qwen3-14B — exact values live in the Colab notebook, not the docs page
model = FastModel.get_peft_model(
    model,
    r = 16,
    lora_alpha = 32,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
    # target_modules = [...]  # let Unsloth pick its Qwen3 defaults
)
```

**Chat template + `enable_thinking` handling (THIS IS THE LOAD-BEARING PART):**

```python
# Per-turn template application during data prep
text = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=True   # Default is True. Set False for Qwen2.5-Instruct-style behavior.
)
```

For non-thinking traces, Qwen3 expects an **empty `<think></think>` block injected** so the model learns the right shape:

```
<|im_start|>user
What is 2+2?<|im_end|>
<|im_start|>assistant
<think>

</think>

```

Note: `</think>` token id is **151668** — useful if we ever want to mask thinking tokens out of loss or split assistant turns programmatically.

**SFTConfig (Unsloth's documented defaults from the general guide):**

```python
from trl import SFTConfig

args = SFTConfig(
    per_device_train_batch_size = 2,        # Unsloth default (we used 1)
    gradient_accumulation_steps = 4,         # Unsloth default (we used 8)
    # max_steps = 60,                        # for quick test
    num_train_epochs = 1,                    # Unsloth recommends 1–3 to avoid overfit (we did 3)
    learning_rate = 2e-4,                    # matches our run
    warmup_ratio = 0.05,                     # not pinned by docs; common Unsloth default
    logging_steps = 1,
    output_dir = "outputs",
    save_total_limit = 3,
    seed = 3407,
)
```

**GGUF export call** — *NOT documented on the four pages we scraped.* The Qwen3-14B run-and-fine-tune page only covers GGUF in the *inference download* direction (`snapshot_download` of pre-made Unsloth GGUFs). The fine-tune → GGUF export bridge lives at `docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf` (not in this scrape). The canonical Unsloth call is `model.save_pretrained_gguf("model_q4", tokenizer, quantization_method="q4_k_m")` but **this is not in our scraped sources** — verify before relying on it.

## What Unsloth says specifically about Qwen3-14B

- **Three published Unsloth artifacts:** `unsloth/Qwen3-14B-GGUF` (run), `unsloth/Qwen3-14B-128K-GGUF` (long context), `unsloth/Qwen3-14B-unsloth-bnb-4bit` (the one to fine-tune from). ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **Qwen3-14B is the headline fits-in-16GB-VRAM size**, validated on Colab T4 — directly applicable to our 5060 Ti. ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **Recommended fine-tuning notebook for 14B:** *Qwen3 (14B) Reasoning + Conversational notebook* (Alpaca notebook is the alternate for base models). ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **16 GB claim is conditional on:** `max_seq_length=2048` AND `load_in_4bit=True`. Unsloth does NOT claim 14B fits at bf16 or 8-bit on 16 GB. ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **Headline perf:** "Qwen3 (14B) fine-tuning is 3x faster with 70% less memory." ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Architecture:** 14.8B params total (13.2B non-embedding), 40 layers, GQA with 40 Q heads and 8 KV heads, native 32,768 context, 131,072 with YaRN. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Default `max_position_embeddings` in config.json is 40,960** (32,768 output + 8,192 prompt reserved). ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Dataset guidance to preserve reasoning:** mix 75% reasoning + 25% non-reasoning. The official Conversational notebook uses 75% NVIDIA open-math-reasoning + 25% Maxime FineTome. Fine-tuning purely on non-reasoning data degrades reasoning ability. ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **`transformers>=4.51.0` is a hard pin** — older versions raise `KeyError: 'qwen3'`. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **`</think>` token id is 151668** — needed for masking or splitting thinking tokens. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Sampling for thinking mode:** Temp=0.6, TopP=0.95, TopK=20, MinP=0. **NEVER use greedy decoding** (causes endless repetitions). ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Sampling for non-thinking mode:** Temp=0.7, TopP=0.8, TopK=20, MinP=0. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Multi-turn rule:** historical assistant turns must NOT include thinking content — only the final output. The Jinja2 chat template handles this; non-Jinja frameworks must enforce it manually. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Soft switches:** `/think` and `/no_think` in user/system messages flip mode turn-by-turn — but ONLY when `enable_thinking=True`. They are no-ops when `enable_thinking=False`. ([HF model card](https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit))
- **Freshness warning:** the docs page banner reads *"NEW! Qwen3 got an update in July 2025. Run & fine-tune the latest model: Qwen-2507"* — for the absolute newest 14B guidance also check the qwen3-next tutorial. ([qwen3-how-to-run-and-fine-tune](https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune))
- **NO explicit LoRA r/alpha, lr, batch, grad_accum, epochs, or full SFTConfig** is published on the Qwen3-14B docs page — those values live ONLY inside the Colab notebook. The docs page links to the notebook but does not inline the hyperparameters. This is a real gap.

## Where Unsloth's recommendation differs from our 2026-06-02 run

| Setting | Our run | Unsloth (sourced) | Verdict |
|---|---|---|---|
| **Chat template** | `qwen-2.5` | Qwen3 native ChatML with `enable_thinking` flag, empty `<think></think>` block for non-thinking turns | **WRONG.** The `qwen-2.5` template has no `enable_thinking` concept and will not produce the empty `<think></think>` shape that Qwen3's non-thinking mode expects. Inference behavior will drift — possibly silently. Fix before next run. |
| **Learning rate** | 2e-4 | 2e-4 (general guide default) | Matches. No change needed. |
| **per_device_train_batch_size** | 1 | 2 | Ours is half. Probably a VRAM-conservative choice; if we have headroom on the 5060 Ti, try bsz=2 + grad_accum=4 for the same effective batch but better GPU utilization. |
| **gradient_accumulation_steps** | 8 | 4 | Ours is double. Combined with bsz=1, our effective batch is 8 — same as Unsloth's bsz=2 × accum=4. Functionally equivalent in optimization terms but slower in wall-clock (we pad more, GPU sits idle more). |
| **max_seq_length** | 2048 | 2048 | Matches. |
| **LoRA r / alpha** | 16 / 32 | NOT published on the Qwen3-14B docs page — lives inside the Colab notebook only | Cannot say if we match. r=16 is reasonable; alpha=32 (2x r) is a common choice but unverified for Qwen3-14B. Open question — see Gaps. |
| **Epochs** | 3 | 1–3 (general guide recommends 1) | Within range. With ~4k examples and persona SFT, 3 may overfit — watch eval loss. |
| **save_total_limit** | 3 | Not pinned | Fine. |
| **Model checkpoint** | (unspecified) | `unsloth/Qwen3-14B-unsloth-bnb-4bit` — Unsloth dynamic 4-bit, not plain `bnb-4bit` | If we used plain `bnb-4bit` or the full-precision repo we left accuracy on the table. Verify which one we loaded. |
| **Precision rule** | (not enforced) | Train and serve in the SAME precision (4-bit train → 4-bit serve) | If we plan to deploy the LoRA on top of an Ollama Q4 quant, this matches. If we plan to merge to bf16 then serve at FP16, accuracy may drift. |

## Blackwell-specific notes from the Unsloth docs

From [docs.unsloth.ai/basics/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth](https://docs.unsloth.ai/basics/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth):

- **Blackwell is officially supported** — RTX 50-series (5060 through 5090), RTX PRO 6000, B200, B40, GB100/102, DGX Spark. Single Unsloth Docker image (`unsloth/unsloth`) works for all of them, no separate Blackwell image. The Docker path is the path of least resistance.
- **CUDA 12.8 wheels are mandatory.** vLLM must be installed with `--torch-backend=cu128` (uv) or `--extra-index-url https://download.pytorch.org/whl/cu128` (pip). Default pip install lands cu126 which **silently fails** on sm_120. This is the #1 trap.
- **`triton>=3.3.1` is required.** Older Triton has no Blackwell kernels.
- **For any from-source build (xformers especially), set `TORCH_CUDA_ARCH_LIST="12.0"`.** This is the magic Blackwell flag.
- **Xformers is OPTIONAL.** PyTorch SDPA is the fallback. For a first-pass Qwen3-14B run, skip the xformers source build — it can take 30+ min on a slow box, and the speedup is incremental. Add it later if we're throughput-bound.
- **Recommended Python is 3.12** in the uv flow.
- **WSL-specific note** (not relevant to us — we're native Linux now — but recorded for completeness): bump `.wslconfig` memory to 16GB+ for xformers compile, use `--no-build-isolation`.
- **No mention of the cuda_v13 cicc -O3 bug** that bit us on ROOM via Ollama. The Unsloth Blackwell page assumes the cu128 toolchain throughout — which sidesteps cuda_v13 entirely. Lesson: for fine-tuning on 5060 Ti, **stay on the cu128 path Unsloth documents, do NOT mix in cuda_v13 toolchain bits.**

The Blackwell page does NOT cover: fine-tuning hyperparameters, Qwen3-14B specifics, bitsandbytes Blackwell status (we assume sm_120 support is in current bnb but should verify with `bnb.nn.Linear4bit` smoke test), Flash Attention 3 status on Blackwell, or any per-model VRAM tables. It is install guidance only.

## Open questions / gaps

1. **What are the actual LoRA hyperparameters in the official Qwen3 (14B) Reasoning + Conversational Colab notebook?** The docs page links to it but does not inline `r`, `alpha`, `lora_dropout`, `target_modules`, `warmup_ratio`, or scheduler choice. We need to scrape or open the notebook directly (`Qwen3_(14B)-Reasoning-Conversational.ipynb`) to confirm our `r=16/alpha=32` matches or to correct it.
2. **What's the exact `save_pretrained_gguf` / `save_pretrained_merged` recipe Unsloth recommends for Qwen3-14B?** Not on any of the four pages scraped. Need to fetch `docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf`.
3. **For persona SFT on a small ~4k corpus, should we mix in reasoning data?** Unsloth's published guidance (75% reasoning + 25% non-reasoning) is aimed at preserving general reasoning ability. For a persona fine-tune we may *want* to reduce reasoning weight, but doing so per the docs will degrade thinking-mode quality. This is a trade-off the docs do not address — it's a design call we need to make and document.
4. **Does the bnb dynamic 4-bit checkpoint work with `bitsandbytes` on sm_120 today?** The docs imply yes (Blackwell page installs `bitsandbytes` without caveat), but no version pin or smoke test is published. Worth a 1-min `bnb.nn.Linear4bit(...)` sanity check before kicking off a 4-hour run.
5. **Qwen3 had a July 2025 refresh ("Qwen-2507").** The docs page banner says so but the page itself appears to predate the refresh. Should we be fine-tuning the original `Qwen3-14B` or a Qwen-2507 variant? Need to check the qwen3-next tutorial.
6. **For our 16GB target with `bsz=2, grad_accum=4, max_seq=2048`, what is the actual peak VRAM?** Not published. Worth measuring on the first run with `nvidia-smi --query-gpu=memory.used -l 1` so we know our headroom.
7. **Three-epoch overfit risk on ~4k examples:** the general guide recommends 1 epoch as the starting point and "1–3 to avoid overfitting." With our corpus size, 3 epochs is at the upper bound — we should hold out a validation set and watch eval loss.

## Sources

1. https://docs.unsloth.ai/models/tutorials/qwen3-how-to-run-and-fine-tune — succeeded
2. https://docs.unsloth.ai/basics/fine-tuning-llms-with-blackwell-rtx-50-series-and-unsloth — succeeded
3. https://docs.unsloth.ai/get-started/fine-tuning-llms-guide — succeeded
4. https://huggingface.co/unsloth/Qwen3-14B-unsloth-bnb-4bit — succeeded