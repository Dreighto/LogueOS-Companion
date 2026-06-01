#!/usr/bin/env python3
# Extract operator <-> Sully chats from the Companion app DB into a
# fine-tune corpus. Smallest of the three sources but the highest signal:
# these are the actual in-persona conversations.
#
# Schema (chat_messages):
#   id INTEGER pk, sender TEXT, message TEXT, trace_id TEXT, ticket_id TEXT,
#   interactive_action TEXT, status TEXT default 'sent',
#   timestamp TEXT default CURRENT_TIMESTAMP, thread_id TEXT default 'default'
#
# Pairing rule: within each thread (ordered by id), each operator message
# pairs with the NEXT non-operator, non-system message — the assistant
# response to that prompt. Senders in use today: operator, local (Sully's
# in-app reply), cc (dispatched CC summary), agy (dispatched AGY summary),
# system (audit lines). We keep operator -> local primarily, and optionally
# operator -> cc/agy when --include-dispatch is set.
#
# Run:
#   python3 scripts/extract_companion_db_corpus.py \
#     --db ~/dev/LogueOS-Companion/data/companion.db \
#     --out ~/dev/training-corpora/companion-2026-06-01
import argparse
import json
import os
import re
import sqlite3
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
    r"sk-[A-Za-z0-9]{20,}", r"sk-ant-[A-Za-z0-9_-]{20,}",
    r"ghp_[A-Za-z0-9]{20,}", r"gho_[A-Za-z0-9]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}", r"AKIA[A-Z0-9]{12,}",
    r"AIza[A-Za-z0-9_-]{20,}",
    r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}",
]
SECRET_RE = re.compile("|".join(SECRET_PATTERNS))


def has_correction(t):
    return bool(CORRECTION_RE.search(t or ""))


def contains_secret(t):
    return bool(SECRET_RE.search(t or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--db", default=os.path.expanduser("~/dev/LogueOS-Companion/data/companion.db")
    )
    ap.add_argument(
        "--out",
        default=os.path.expanduser("~/dev/training-corpora/companion-2026-06-01"),
    )
    ap.add_argument("--eval-frac", type=float, default=0.10)
    ap.add_argument(
        "--include-dispatch",
        action="store_true",
        help="Also include operator->cc and operator->agy pairs (dispatch summaries).",
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.execute(
        "SELECT id, sender, message, thread_id "
        "FROM chat_messages "
        "WHERE message IS NOT NULL AND TRIM(message) <> '' "
        "ORDER BY thread_id, id"
    )
    rows_by_thread = {}
    for r in cur:
        rows_by_thread.setdefault(r["thread_id"], []).append(r)
    con.close()

    assistant_senders = {"local"}
    if args.include_dispatch:
        assistant_senders.update({"cc", "agy"})

    raw = []
    sender_seen = Counter()
    for thread_id, rows in rows_by_thread.items():
        i = 0
        while i < len(rows):
            sender_seen[rows[i]["sender"]] += 1
            if rows[i]["sender"] != "operator":
                i += 1
                continue
            # find next assistant-class message
            j = i + 1
            while j < len(rows) and rows[j]["sender"] not in assistant_senders:
                # but if we hit another operator before any assistant, abandon this op
                if rows[j]["sender"] == "operator":
                    break
                j += 1
            if j >= len(rows) or rows[j]["sender"] not in assistant_senders:
                i += 1
                continue
            u_text = rows[i]["message"].strip()
            a_text = rows[j]["message"].strip()
            # look one more step ahead for the next operator msg (quality signal)
            k = j + 1
            while k < len(rows) and rows[k]["sender"] != "operator":
                k += 1
            next_u = rows[k]["message"].strip() if k < len(rows) else None
            raw.append(
                {
                    "h": u_text,
                    "a": a_text,
                    "next_h": next_u,
                    "thread_id": thread_id,
                    "assistant_sender": rows[j]["sender"],
                }
            )
            i = j + 1

    kept = []
    dropped = Counter()
    for p in raw:
        if contains_secret(p["h"]) or contains_secret(p["a"]):
            dropped["secret_scrub"] += 1
            continue
        if len(p["a"]) < 4:
            dropped["empty_reply"] += 1
            continue
        if p["next_h"] and has_correction(p["next_h"]):
            dropped["next_msg_correction"] += 1
            continue
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
                    ],
                    "meta": {
                        "thread_id": p["thread_id"],
                        "assistant_sender": p["assistant_sender"],
                    },
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
    by_sender = Counter(p["assistant_sender"] for p in kept)

    stats = {
        "extracted_at": datetime.now().isoformat(timespec="seconds"),
        "db": args.db,
        "include_dispatch": args.include_dispatch,
        "threads_scanned": len(rows_by_thread),
        "messages_by_sender_raw": dict(sender_seen),
        "raw_pairs": len(raw),
        "kept_pairs": len(kept),
        "kept_pairs_by_assistant_sender": dict(by_sender),
        "dropped": dict(dropped),
        "train_size": len(train_pairs),
        "eval_size": len(eval_pairs),
        "eval_frac_actual": round(len(eval_pairs) / max(len(kept), 1), 3),
        "human_chars": {"p50": q(h_chars, 0.5), "p95": q(h_chars, 0.95)},
        "assistant_chars": {"p50": q(a_chars, 0.5), "p95": q(a_chars, 0.95)},
        "total_train_chars": sum(len(p["h"]) + len(p["a"]) for p in train_pairs),
    }
    with open(out_dir / "stats.json", "w") as f:
        json.dump(stats, f, indent=2)

    readme = f"""# Companion DB chats -> Sully fine-tune corpus

**Source:** {args.db}
**Generated:** {stats['extracted_at']}
**Threads scanned:** {stats['threads_scanned']}
**Pairs kept / extracted:** {stats['kept_pairs']} / {stats['raw_pairs']}
**Train / Eval:** {stats['train_size']} / {stats['eval_size']}
**Total training chars:** {stats['total_train_chars']:,}

## Register

These are the **highest-signal pairs we have** — actual in-persona Sully
chats with the operator, recent (post-companion-app deployment). Sully's
system prompt was already in force; replies reflect the target tone.

## Sender breakdown (raw counts)

{json.dumps(stats['messages_by_sender_raw'], indent=2)}

## Kept pairs by assistant sender

{json.dumps(stats['kept_pairs_by_assistant_sender'], indent=2)}

`--include-dispatch` mixes in operator->cc and operator->agy pairs (the
dispatch-result summaries). Off by default — those are working-mode
artifacts, not Sully's voice. Off = local-only.

## Quality filter drops

{json.dumps(stats['dropped'], indent=2)}

## Format

```json
{{
  "messages": [
    {{"role": "user",      "content": "<operator message>"}},
    {{"role": "assistant", "content": "<Sully reply>"}}
  ],
  "meta": {{"thread_id": "...", "assistant_sender": "local"}}
}}
```

Trainers ignore the `meta` key; it's there so you can re-bucket by thread or
sender later without re-extracting.

## NOT FOR COMMIT — operator's private chat history.
"""
    with open(out_dir / "README.md", "w") as f:
        f.write(readme)

    print(json.dumps(stats, indent=2))
    print(f"\nOutputs in {out_dir}:")
    for p in sorted(out_dir.iterdir()):
        print(f"  {p.name:20s}  {p.stat().st_size:>12,} bytes")


if __name__ == "__main__":
    main()
