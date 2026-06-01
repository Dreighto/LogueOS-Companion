#!/usr/bin/env python3
# Extract operator's CH chat history into a Sully fine-tune corpus.
#
# Input:  conversations.json from a CH (Claude Chat) data export
# Output: train.jsonl + eval.jsonl in HuggingFace chat-template format,
#         plus stats.json and a README describing the corpus.
#
# Quality filter — a pair is DROPPED when:
#   1. The operator's NEXT message in the same conversation contains a
#      correction token (actually / no. / wait / hold on / wrong / rephrase
#      / try again / redo / nope / not quite / stop / undo / that's not).
#      Treated as an implicit thumbs-down on the assistant's reply.
#   2. The pair contains credential-shaped strings (AWS / GitHub / Google /
#      Anthropic / JWT). Safe-by-default — kill the pair, not the whole conv.
#   3. The assistant reply is empty / sub-4-chars.
#
# Eval split is stratified by reply length so the held-out 10% covers the
# same distribution as the training set (no all-short or all-long eval set).
#
# Run:
#   python3 scripts/extract_ch_training_corpus.py \
#     --in /tmp/ch_data/conversations.json \
#     --out ~/dev/training-corpora/ch-2026-06-01
import argparse
import json
import os
import re
import statistics
from collections import Counter
from datetime import datetime
from pathlib import Path

CORRECTION_TOKENS = [
    r"\bactually\b",
    r"\bno\.",
    r"\bnope\b",
    r"\bwait\b",
    r"\bhold on\b",
    r"\bwrong\b",
    r"\brephrase\b",
    r"\btry again\b",
    r"\bredo\b",
    r"\bnot quite\b",
    r"\bstop\b",
    r"\bundo\b",
    r"\bthat['’]s not\b",
    r"\bdon['’]t do\b",
]
CORRECTION_RE = re.compile("|".join(CORRECTION_TOKENS), re.IGNORECASE)

SECRET_PATTERNS = [
    r"sk-[A-Za-z0-9]{20,}",
    r"sk-ant-[A-Za-z0-9_-]{20,}",
    r"ghp_[A-Za-z0-9]{20,}",
    r"gho_[A-Za-z0-9]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}",
    r"AKIA[A-Z0-9]{12,}",
    r"AIza[A-Za-z0-9_-]{20,}",
    r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}",
]
SECRET_RE = re.compile("|".join(SECRET_PATTERNS))


def message_text(m):
    t = (m.get("text") or "").strip()
    if t:
        return t
    out = []
    for blk in m.get("content") or []:
        if blk.get("type") == "text":
            out.append(blk.get("text", ""))
    return "\n".join(out).strip()


def is_correction(text):
    return bool(CORRECTION_RE.search(text or ""))


def contains_secret(text):
    return bool(SECRET_RE.search(text or ""))


def extract_pairs(conversations, max_pair_chars=24000):
    for conv in conversations:
        msgs = conv.get("chat_messages") or []
        msgs = sorted(msgs, key=lambda m: m.get("created_at") or "")
        last_human = None
        for i, m in enumerate(msgs):
            sender = m.get("sender")
            text = message_text(m)
            if not text:
                continue
            if sender == "human":
                last_human = text
            elif sender == "assistant" and last_human is not None:
                next_human = None
                for j in range(i + 1, len(msgs)):
                    nm = msgs[j]
                    if nm.get("sender") == "human":
                        nh = message_text(nm)
                        if nh:
                            next_human = nh
                            break
                if len(last_human) + len(text) <= max_pair_chars:
                    yield {
                        "h": last_human,
                        "a": text,
                        "next_h": next_human,
                        "conv": conv.get("name", ""),
                    }
                last_human = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="input", default="/tmp/ch_data/conversations.json")
    ap.add_argument(
        "--out",
        dest="output",
        default=os.path.expanduser("~/dev/training-corpora/ch-2026-06-01"),
    )
    ap.add_argument("--eval-frac", type=float, default=0.10)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(args.input) as f:
        conversations = json.load(f)

    pairs = list(extract_pairs(conversations))
    n_total = len(pairs)

    kept = []
    dropped = Counter()
    for p in pairs:
        if contains_secret(p["h"]) or contains_secret(p["a"]):
            dropped["secret_scrub"] += 1
            continue
        if len(p["a"].strip()) < 4:
            dropped["empty_reply"] += 1
            continue
        if p["next_h"] and is_correction(p["next_h"]):
            dropped["next_msg_correction"] += 1
            continue
        kept.append(p)

    # Stratified split: sort by reply length, take every Nth into eval so the
    # held-out slice spans the whole length range.
    indexed = sorted(range(len(kept)), key=lambda i: len(kept[i]["a"]))
    stride = max(1, int(round(1 / args.eval_frac)))
    eval_idx = {indexed[i] for i in range(0, len(indexed), stride)}
    train_pairs = [p for i, p in enumerate(kept) if i not in eval_idx]
    eval_pairs = [p for i, p in enumerate(kept) if i in eval_idx]

    def write_jsonl(path, items):
        with open(path, "w") as f:
            for p in items:
                rec = {
                    "messages": [
                        {"role": "user", "content": p["h"]},
                        {"role": "assistant", "content": p["a"]},
                    ]
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    write_jsonl(out_dir / "train.jsonl", train_pairs)
    write_jsonl(out_dir / "eval.jsonl", eval_pairs)

    def q(values, p):
        v = sorted(values)
        if not v:
            return None
        k = max(0, min(len(v) - 1, int(round(p * (len(v) - 1)))))
        return v[k]

    h_chars = [len(p["h"]) for p in kept]
    a_chars = [len(p["a"]) for p in kept]
    stats = {
        "extracted_at": datetime.now().isoformat(timespec="seconds"),
        "source": args.input,
        "conversations": len(conversations),
        "raw_pairs": n_total,
        "kept_pairs": len(kept),
        "dropped": dict(dropped),
        "train_size": len(train_pairs),
        "eval_size": len(eval_pairs),
        "eval_frac_target": args.eval_frac,
        "eval_frac_actual": round(len(eval_pairs) / max(len(kept), 1), 3),
        "human_chars": {"p50": q(h_chars, 0.5), "p95": q(h_chars, 0.95)},
        "assistant_chars": {"p50": q(a_chars, 0.5), "p95": q(a_chars, 0.95)},
        "total_train_chars": sum(len(p["h"]) + len(p["a"]) for p in train_pairs),
    }
    with open(out_dir / "stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    readme = f"""# CH chat history -> Sully fine-tune corpus

**Source:** {args.input}
**Generated:** {stats['extracted_at']}
**Conversations scanned:** {stats['conversations']}
**Pairs kept / extracted:** {stats['kept_pairs']} / {stats['raw_pairs']}
**Train / Eval:** {stats['train_size']} / {stats['eval_size']}
**Total training chars:** {stats['total_train_chars']:,}

## Format

Each `.jsonl` line is one training example in HuggingFace chat-template form:

```json
{{
  "messages": [
    {{"role": "user",      "content": "<operator message>"}},
    {{"role": "assistant", "content": "<CH-Claude reply>"}}
  ]
}}
```

Compatible with `tokenizer.apply_chat_template()` and Unsloth / TRL SFTTrainer
out of the box. For Qwen 3 (companion target) the tokenizer is on
`Qwen/Qwen3-14B`; chat-template is applied automatically by the trainer.

## Quality filter

Pairs dropped:
{json.dumps(stats['dropped'], indent=2)}

Filter logic:
- `next_msg_correction` — operator's next message contained
  `actually` / `no.` / `wait` / `hold on` / `wrong` / `rephrase` /
  `try again` / `redo` / `nope` / `not quite` / `stop` / `undo` /
  `that's not` / `don't do`. Treated as implicit thumbs-down.
- `secret_scrub` — pair contained a credential-shaped string
  (AWS / GitHub / Google / Anthropic / JWT). Drops the pair, not the conv.
- `empty_reply` — assistant reply was effectively empty.

## Eval split

10% held out, stratified by reply length. Never used for training.
Use it to score `companion-v0` (base Qwen3-14B + system prompt) vs
`companion-v1` (post-QLoRA) on:
- token-level loss on eval split
- stylistic match: does v1 reply sound more like the CH-Claude replies
  the operator was happy with than v0 does?

## NOT FOR COMMIT

This directory contains personal chat history. The output path lives
OUTSIDE any git repo by design (`~/dev/training-corpora/`).
"""
    with open(out_dir / "README.md", "w") as f:
        f.write(readme)

    print(json.dumps(stats, indent=2))
    print(f"\nOutputs in {out_dir}:")
    for p in sorted(out_dir.iterdir()):
        print(f"  {p.name:20s}  {p.stat().st_size:>12,} bytes")


if __name__ == "__main__":
    main()
