#!/usr/bin/env python3
# Extract Claude Code session transcripts into a Sully fine-tune corpus.
#
# Input:  ~/.claude/projects/*/*.jsonl  (every CC session across every project)
# Output: train.jsonl + eval.jsonl in HuggingFace chat-template format
#
# CC sessions are tree-structured (parentUuid chains, sidechains for sub-
# agents) and heavily tool-call-decorated. We want only the human/assistant
# *prose* exchanges — strip every kind of synthetic / mechanical record:
#
#   USER records dropped when:
#     - isSidechain: true   (sub-agent dispatch, not operator)
#     - content has any tool_result block
#     - content begins with <local-command-...>, <system-reminder,
#       <command-name>, <command-message>, <command-args>
#     - content is the `[Image #N pasted to disk]` placeholder only
#     - content is empty / whitespace
#
#   ASSISTANT records dropped when:
#     - isSidechain: true
#     - contains only tool_use blocks (no text block)
#     - all text blocks are empty
#
# Pairing rule: within each session file, walk records in order; pair the
# next eligible USER text with the next eligible ASSISTANT text. Same simple
# pattern as the CH extractor — no parentUuid graph walk needed because we
# already filtered out sidechains.
#
# Run:
#   python3 scripts/extract_cc_sessions_corpus.py \
#     --root ~/.claude/projects \
#     --out  ~/dev/training-corpora/cc-2026-06-01
import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

CORRECTION_TOKENS = [
    r"\bactually\b", r"\bno\.", r"\bnope\b", r"\bwait\b", r"\bhold on\b",
    r"\bwrong\b", r"\brephrase\b", r"\btry again\b", r"\bredo\b",
    r"\bnot quite\b", r"\bstop\b", r"\bundo\b",
    r"\bthat['’]s not\b", r"\bdon['’]t do\b",
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

SYNTHETIC_PREFIXES = (
    "<local-command-",
    "<system-reminder",
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<bash-stderr>",
    "<bash-stdout>",
    "Caveat: The messages",
    # CC compaction resume — the harness injects a large summary block with
    # this exact prefix when context overflows. Not an operator prompt.
    "This session is being continued from a previous conversation",
    # Continuation prompt injected after summary blocks
    "Please continue the conversation from where",
    # Skill activation preamble — the Skill tool injects a "Base directory
    # for this skill: …" header alongside the skill body.
    "Base directory for this skill:",
    # CI monitor hook event — automated PR-comment / check-run notifications
    # the kernel injects into the session as a user-shaped message.
    "<ci-monitor-event>",
    # Activity feed event the listener pushes back during dispatch
    "<activity-event>",
)
IMAGE_PLACEHOLDER_RE = re.compile(r"^\s*\[Image #\d+ pasted to disk[^]]*\]\s*$")


def is_synthetic_user_text(text):
    if not text:
        return True
    s = text.lstrip()
    if any(s.startswith(p) for p in SYNTHETIC_PREFIXES):
        return True
    if IMAGE_PLACEHOLDER_RE.match(s):
        return True
    return False


def has_correction(text):
    return bool(CORRECTION_RE.search(text or ""))


def contains_secret(text):
    return bool(SECRET_RE.search(text or ""))


def extract_user_text(record):
    msg = record.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        # Skip any record containing a tool_result block — those are
        # mechanical responses to the assistant's tool_use, not real prompts.
        for blk in content:
            if isinstance(blk, dict) and blk.get("type") == "tool_result":
                return None
        texts = [
            blk.get("text", "")
            for blk in content
            if isinstance(blk, dict) and blk.get("type") == "text"
        ]
        joined = "\n".join(t for t in texts if t).strip()
        return joined or None
    return None


def extract_assistant_text(record):
    msg = record.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content.strip() or None
    if isinstance(content, list):
        texts = [
            blk.get("text", "")
            for blk in content
            if isinstance(blk, dict) and blk.get("type") == "text"
        ]
        joined = "\n".join(t for t in texts if t).strip()
        return joined or None
    return None


def iter_session_records(path):
    """Yield parsed records from a CC session jsonl, tolerating partial lines."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    # Truncated trailing line from a concurrently-writing
                    # session — just skip.
                    continue
    except OSError:
        return


def extract_pairs_from_session(path, max_pair_chars=24000):
    """Yield (user_text, assistant_text, next_user_text_or_None, session_path)."""
    pending_user = None
    pending_user_idx = -1
    pairs_buf = []
    user_texts_in_order = []
    records_after = []
    # First pass — collect eligible (idx, role, text) tuples in order.
    seq = []
    for rec in iter_session_records(path):
        if not isinstance(rec, dict):
            continue
        if rec.get("isSidechain"):
            continue
        rtype = rec.get("type")
        if rtype == "user":
            t = extract_user_text(rec)
            if t and not is_synthetic_user_text(t):
                seq.append(("user", t))
        elif rtype == "assistant":
            t = extract_assistant_text(rec)
            if t:
                seq.append(("assistant", t))
    # Second pass — pair user->next-assistant; capture the user message
    # AFTER that as the quality signal.
    i = 0
    n = len(seq)
    while i < n:
        if seq[i][0] != "user":
            i += 1
            continue
        u_text = seq[i][1]
        # Find next assistant
        j = i + 1
        while j < n and seq[j][0] != "assistant":
            j += 1
        if j >= n:
            break
        a_text = seq[j][1]
        # Find next user after that for the quality signal
        k = j + 1
        while k < n and seq[k][0] != "user":
            k += 1
        next_u = seq[k][1] if k < n else None
        if len(u_text) + len(a_text) <= max_pair_chars:
            yield {"h": u_text, "a": a_text, "next_h": next_u, "session": str(path)}
        i = j + 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument(
        "--out",
        default=os.path.expanduser("~/dev/training-corpora/cc-2026-06-01"),
    )
    ap.add_argument("--eval-frac", type=float, default=0.10)
    ap.add_argument("--min-reply-chars", type=int, default=20)
    args = ap.parse_args()

    root = Path(args.root)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    sessions = sorted(root.glob("*/*.jsonl"))
    print(f"Scanning {len(sessions):,} session files under {root}...", file=sys.stderr)

    raw = []
    per_project = Counter()
    for s in sessions:
        project = s.parent.name
        before = len(raw)
        for p in extract_pairs_from_session(s):
            raw.append(p)
        per_project[project] += len(raw) - before

    n_raw = len(raw)
    print(f"  raw pairs extracted: {n_raw:,}", file=sys.stderr)

    # Filter
    kept = []
    dropped = Counter()
    seen_hashes = set()
    for p in raw:
        if contains_secret(p["h"]) or contains_secret(p["a"]):
            dropped["secret_scrub"] += 1
            continue
        if len(p["a"].strip()) < args.min_reply_chars:
            dropped["empty_or_tiny_reply"] += 1
            continue
        if p["next_h"] and has_correction(p["next_h"]):
            dropped["next_msg_correction"] += 1
            continue
        # Dedup on a hash of the first 200 chars of each side — catches
        # exact-replay pairs from /resume etc. without nuking near-duplicates.
        sig = hashlib.sha256(
            (p["h"][:200] + "||" + p["a"][:200]).encode("utf-8")
        ).hexdigest()
        if sig in seen_hashes:
            dropped["duplicate"] += 1
            continue
        seen_hashes.add(sig)
        kept.append(p)

    # Stratified split by reply length
    indexed = sorted(range(len(kept)), key=lambda i: len(kept[i]["a"]))
    stride = max(1, int(round(1 / args.eval_frac)))
    eval_set = {indexed[i] for i in range(0, len(indexed), stride)}
    train_pairs = [p for i, p in enumerate(kept) if i not in eval_set]
    eval_pairs = [p for i, p in enumerate(kept) if i in eval_set]

    def write_jsonl(path, items):
        with open(path, "w", encoding="utf-8") as f:
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
        "root": str(root),
        "sessions_scanned": len(sessions),
        "raw_pairs": n_raw,
        "kept_pairs": len(kept),
        "dropped": dict(dropped),
        "train_size": len(train_pairs),
        "eval_size": len(eval_pairs),
        "eval_frac_actual": round(len(eval_pairs) / max(len(kept), 1), 3),
        "human_chars": {"p50": q(h_chars, 0.5), "p95": q(h_chars, 0.95)},
        "assistant_chars": {"p50": q(a_chars, 0.5), "p95": q(a_chars, 0.95)},
        "total_train_chars": sum(len(p["h"]) + len(p["a"]) for p in train_pairs),
        "raw_pairs_per_project": dict(per_project.most_common()),
    }
    with open(out_dir / "stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    readme = f"""# CC session transcripts -> Sully fine-tune corpus

**Source:** {root}
**Generated:** {stats['extracted_at']}
**Sessions scanned:** {stats['sessions_scanned']:,}
**Pairs kept / extracted:** {stats['kept_pairs']:,} / {stats['raw_pairs']:,}
**Train / Eval:** {stats['train_size']:,} / {stats['eval_size']:,}
**Total training chars:** {stats['total_train_chars']:,}

## Register

These are operator <-> CC working-mode exchanges. Much terser than the CH
corpus, more status-update / task-execution shaped. Pair them with
`ch-2026-06-01/` (planning / reflective mode) and
`companion-2026-06-01/` (in-persona mode) for full register coverage when
blending into the fine-tune.

## What was stripped

- Sub-agent (sidechain) dispatches — not operator messages
- `tool_result` blocks — mechanical responses, not prose
- `tool_use` blocks — no text content
- `<local-command-*>`, `<system-reminder>`, `<command-name|message|args>`,
  `<bash-stdout|stderr>` wrappers — synthetic harness traffic
- `[Image #N pasted to disk]` placeholders — no usable text
- Pairs containing AWS / GitHub / Google / Anthropic / JWT credential
  shapes — privacy guard

## Quality filter drops

{json.dumps(stats['dropped'], indent=2)}

`next_msg_correction` is the implicit thumbs-down signal — your next
message contained correction tokens (`actually` / `no.` / `wait` /
`hold on` / `wrong` / `rephrase` / `try again` / `redo` / `nope` /
`not quite` / `stop` / `undo` / `that's not` / `don't do`).

## Per-project raw-pair distribution

{json.dumps(dict(list(per_project.most_common())), indent=2)}

## Format

```json
{{
  "messages": [
    {{"role": "user",      "content": "<operator message>"}},
    {{"role": "assistant", "content": "<CC reply>"}}
  ]
}}
```

## NOT FOR COMMIT — personal coding history. Path lives outside any git tree.
"""
    with open(out_dir / "README.md", "w") as f:
        f.write(readme)

    print(json.dumps(stats, indent=2))
    print(f"\nOutputs in {out_dir}:")
    for p in sorted(out_dir.iterdir()):
        print(f"  {p.name:20s}  {p.stat().st_size:>12,} bytes")


if __name__ == "__main__":
    main()
