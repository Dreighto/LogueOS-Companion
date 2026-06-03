# Addendum — GGUF export for Qwen3-14B
*Scraped from Unsloth docs on 2026-06-02 to fill the gap flagged in the main recipe*

## TL;DR

Unsloth ships a one-line helper, `model.save_pretrained_gguf(...)`, that takes a trained QLoRA model + tokenizer and writes a quantized GGUF that Ollama/llama.cpp can ingest — under the hood it auto-clones and builds llama.cpp from source, then runs `convert_hf_to_gguf.py`. The single most important gotcha for our setup is **chat-template mismatch** (per Unsloth docs, the #1 cause of gibberish/endless generations after export to Ollama) — but the gotcha that bit us on 2026-06-02 is **not in their docs**: Unsloth writes the GGUF output into a sibling directory named `<your_dir>_gguf/` rather than the `<your_dir>/` you passed in, so post-export glob patterns and Modelfile `FROM` paths that assume the literal directory you specified will silently miss the file.

## The call

The exact Unsloth call to export to a Q4_K_M GGUF that Ollama can ingest. This is the VERBATIM snippet from [docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf](https://docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf):

```python
model.save_pretrained_gguf("directory", tokenizer, quantization_method = "q4_k_m")
model.save_pretrained_gguf("directory", tokenizer, quantization_method = "q8_0")
model.save_pretrained_gguf("directory", tokenizer, quantization_method = "f16")
```

For Qwen3-14B targeting Ollama on the 5060 Ti 16 GB, use `q4_k_m` (Unsloth-recommended: Q6_K for half of `attention.wv` and `feed_forward.w2` tensors, Q4_K for the rest — best quality-per-byte trade for our VRAM budget).

If you want to push straight to Hugging Face instead of writing locally:

```python
model.push_to_hub_gguf("hf_username/directory", tokenizer, quantization_method = "q4_k_m")
```

## All quantization options

Every value Unsloth accepts for `quantization_method` (from the `ALLOWED_QUANTS` dict on the page — these are layered on top of llama.cpp's `quantize.cpp` types):

- `not_quantized` — Fast conversion. Slow inference, big files. *Use only if you need a baseline.*
- `fast_quantized` — Fast conversion. OK inference, OK file size. *Unsloth's recommended quick default.*
- `quantized` — Slow conversion. Fast inference, small files. *Unsloth's recommended ship-quality default.*
- `f32` — 100% accuracy, super slow + memory hungry. *Don't.*
- `f16` — 100% accuracy, slow + memory hungry. *Use as an intermediate format for further quantization, not for serving.*
- `q8_0` — Fast conversion, high resource use, generally acceptable. *Best quality of the integer quants.*
- `q6_k` — Uses Q8_K for all tensors. *Near-Q8 quality, smaller.*
- `q5_k_m` — Q6_K for half of `attention.wv` and `feed_forward.w2`, else Q5_K. *Recommended high-quality option if VRAM allows.*
- `q5_k_s` — Q5_K for all tensors.
- `q5_1` — Even higher accuracy than q5_0, higher resource use, slower inference.
- `q5_0` — Higher accuracy than q4_*, higher resource use, slower inference.
- `q5_k` — Alias for `q5_k_m`.
- **`q4_k_m`** — Q6_K for half of `attention.wv` and `feed_forward.w2`, else Q4_K. ***Unsloth-recommended. This is our default for Qwen3-14B on the 5060 Ti.***
- `q4_k_s` — Q4_K for all tensors. *Slightly smaller than `q4_k_m`, slightly lower quality.*
- `q4_k` — Alias for `q4_k_m`.
- `q4_1` — Higher accuracy than q4_0 but lower than q5_0; quicker inference than q5.
- `q4_0` — Original 4-bit quant. *Legacy; prefer `q4_k_m`.*
- `q3_k_l` — Q5_K for `attention.wv`, `attention.wo`, `feed_forward.w2`, else Q3_K.
- `q3_k_m` — Q4_K for `attention.wv` and `feed_forward.w2`, else Q3_K.
- `q3_k_s` — Q3_K for all tensors.
- `q3_k_xs` — 3-bit extra small quantization.
- `q2_k` — Q4_K for `attention.wv` and `feed_forward.w2`, Q2_K for the rest. *Smallest mainstream quant; expect quality drop.*
- `iq3_xxs` — 3.06 bpw quantization. *Experimental, very small.*
- `iq2_xs` — 2.31 bpw quantization. *Experimental, tiny.*
- `iq2_xxs` — 2.06 bpw quantization. *Experimental, tiniest.*

Note: `bf16` shows up only in the manual `convert_hf_to_gguf.py --outtype bf16` path. It is **not** a valid value to pass to `save_pretrained_gguf`'s `quantization_method` kwarg per the live ALLOWED_QUANTS list — if you need a bf16 GGUF you must drop to the manual llama.cpp path below.

## Pre-requirements

**What Unsloth's docs say you need:** the `save_pretrained_gguf` call shells out to build llama.cpp from source. On Debian/Ubuntu, Unsloth runs (or expects you to have run):

```bash
apt-get update
apt-get install pciutils build-essential cmake curl libcurl4-openssl-dev -y
```

Plus a CUDA toolchain on the host if you want the GPU-accelerated llama.cpp build (the cmake flags are `-DGGML_CUDA=ON -DLLAMA_CURL=ON`).

**What actually happened on 2026-06-02:** Unsloth's auto-build path on the ROOM box (Ubuntu 24.04) tried to install those apt packages via `sudo apt`, which **blocked on an interactive sudo prompt** that the Python process can't satisfy. The export failed silently from Python's perspective — it looked like a cmake error, but the underlying issue was `sudo` asking for a password.

**Pre-flight before calling `save_pretrained_gguf` on a fresh host:**

```bash
# Run these BEFORE invoking save_pretrained_gguf so the auto-build doesn't trip sudo
sudo apt-get update
sudo apt-get install -y pciutils build-essential cmake curl libcurl4-openssl-dev
# Optionally pre-clone llama.cpp so Unsloth skips the clone step
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
```

Note: the canonical repo is now `ggml-org/llama.cpp` — older docs/scripts pointing at `ggerganov/llama.cpp` are stale.

**OOM mitigation knob** — if `save_pretrained_gguf` crashes during the merge step (Qwen3-14B in fp16 will fight for VRAM on the 5060 Ti 16 GB), lower the peak memory ceiling:

```python
model.save_pretrained(..., maximum_memory_usage = 0.5)  # default is 0.75
```

## Modelfile + Ollama register flow

**What Unsloth actually produces:** the GGUF file plus (per Unsloth's broader Ollama tutorials, NOT this specific docs page — the page we scraped is GGUF-only and does **not** show a Modelfile example) an auto-written `Modelfile` placed next to the GGUF. The Modelfile bakes in the chat template that was used at training time, which is the whole point — see Known Gotchas.

**Wiring it to Ollama** — once the GGUF + Modelfile are on disk:

```bash
# From inside the directory that has the .gguf and the Modelfile
ollama create sully-qwen3-14b -f Modelfile

# Verify it loaded
ollama list | grep sully-qwen3-14b

# Smoke-test
ollama run sully-qwen3-14b "Say hi."
```

If for any reason the Modelfile isn't generated (e.g., you went down the manual `convert_hf_to_gguf.py` path), the minimum hand-rolled Modelfile looks like:

```
FROM ./model-Q4_K_M.gguf
TEMPLATE """<the EXACT chat template used during training>"""
PARAMETER stop "<eos_token used during training>"
```

The `TEMPLATE` and `stop` parameter MUST match what you trained with — see Known Gotchas.

## Known gotchas

- **Output directory naming — Unsloth writes to `<dir>_gguf/`, not `<dir>/`.** This is NOT in Unsloth's docs — we discovered it on 2026-06-02. If you call `model.save_pretrained_gguf("gguf", tokenizer, ...)`, Unsloth creates a sibling directory called `gguf_gguf/` (the literal string `_gguf` appended) and writes the `.gguf` + `Modelfile` there. Anything downstream that globs `gguf/*.gguf` or hardcodes `FROM ./gguf/model.gguf` will silently miss the file. Fix: either pass a base name that won't read awkwardly when `_gguf` is appended (e.g., pass `"sully"` → get `sully_gguf/`), or `ls -la <parent_dir>` after the call and follow the actual path Unsloth chose.

- **Interactive sudo prompt on first run.** `save_pretrained_gguf` shells out to `sudo apt install ...` to install llama.cpp build deps if they're missing. On a fresh host this blocks on a password prompt that the Python process cannot answer — the export appears to hang or to fail with a confusing cmake error. Mitigation: run the apt install yourself BEFORE the first GGUF export (see Pre-requirements). Once `cmake`, `build-essential`, `libcurl4-openssl-dev`, and `libssl-dev` are present, subsequent runs are non-interactive.

- **Chat-template mismatch is the #1 cause of garbage output after export** (per Unsloth's troubleshooting section on [docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf](https://docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf)). You MUST inference with the EXACT chat template used at training time. If your Ollama session produces gibberish, endless/infinite generations, or repeated outputs, this is almost always why. Use Unsloth's conversational notebooks (the Qwen-3 14B notebook is the relevant one for us) to lock the template in at training time.

- **Wrong EOS token = gibberish on long generations.** Unsloth's docs flag this specifically — confirm the `stop` parameter in your Modelfile matches the EOS token used during training.

- **BOS / start-of-sequence token mismatch.** Some inference engines silently add (or omit) a BOS token. If outputs look subtly wrong, check both hypotheses — does your engine inject BOS that the model wasn't trained to expect, or strip one it was?

- **Manual GGUF path requires the merged 16-bit model FIRST.** You cannot point `convert_hf_to_gguf.py` at a raw QLoRA adapter directory. You must first call:
  ```python
  model.save_pretrained_merged("merged_model", tokenizer, save_method = "merged_16bit")
  ```
  …then run `python llama.cpp/convert_hf_to_gguf.py merged_model --outfile model-Q4_K_M.gguf --outtype f16 --split-max-size 50G` (then quantize). For Qwen3-14B merged-fp16 this will write ~28 GB to disk before quantization — make sure the volume has headroom.

- **`bf16` is only available via the manual path, not via `save_pretrained_gguf`.** It's a valid `--outtype` for `convert_hf_to_gguf.py` but is NOT in `ALLOWED_QUANTS` for the one-line helper.

- **OOM during save.** Lower `maximum_memory_usage` from the default `0.75` to `0.5` (or lower) in `model.save_pretrained(..., maximum_memory_usage = 0.5)` if the GGUF export OOMs on the 5060 Ti.

- **llama.cpp build flags assume CUDA.** The auto-build uses `-DGGML_CUDA=ON`. On a CPU-only or ROCm/Metal host you have to override those flags. ROOM is CUDA so this is fine for us.

## Sources

| URL | Status |
|---|---|
| https://docs.unsloth.ai/basics/inference-and-deployment/saving-to-gguf | OK (fetched 2026-06-02; page footer reads "Last updated 15 days ago") |
| https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf | OK (mirror — same content as the `docs.unsloth.ai` page) |

Note: the previously documented URL `/basics/inference-and-deployment/saving-models` returns 404 — Unsloth restructured that section. The Modelfile + `ollama create` workflow is **not** on either of the two URLs above; that content lives on a separate Unsloth Ollama tutorial page which was not scraped for this addendum.