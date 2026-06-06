# Qwopus3.5:9b vs local models — bench (2026-06-06)

5 reasoning/coding tasks via Ollama, temp 0.2. Auto-pass = crude substring/answer check (treat coding "fails" as possible formatting misses; latency/verbosity are the hard signal).

| model                          | pass    | avg latency | avg out tokens |
| ------------------------------ | ------- | ----------- | -------------- |
| **hermes4:14b**                | **5/5** | **3.6s**    | **100**        |
| qwen2.5:7b                     | 4/5     | 1.8s        | 132            |
| qwen3:14b                      | 4/5     | 22.3s       | 840            |
| **fredrezones55/Qwopus3.5:9b** | 4/5     | **48.9s**   | **2652**       |

Per task (pass / latency):

| task                  | Qwopus9b        | qwen3:14b | hermes4   | qwen2.5   |
| --------------------- | --------------- | --------- | --------- | --------- |
| bat-ball (logic trap) | PASS/13s        | PASS/22s  | PASS/8s   | PASS/2.5s |
| 3-boxes (reasoning)   | PASS/65s        | PASS/37s  | PASS/3s   | PASS/3s   |
| palindrome (coding)   | fail/148s       | fail/200s | PASS/5s   | PASS/2.5s |
| spot-the-bug (review) | PASS/18s        | PASS/23s  | PASS/2s   | fail/0.3s |
| 17+26 (conciseness)   | PASS/1s (46tok) | PASS/7s   | PASS/0.2s | PASS/0.1s |

## Verdict: don't adopt Qwopus 9B

- It's the **slowest by ~13×** (48.9s avg vs hermes4's 3.6s) and **most verbose** (2,652 tok avg; the palindrome task = 148s / 8,167 tokens). It over-reasons hard on non-trivial prompts — the opposite of what its "fixes over-thinking" pitch claims (though it WAS concise on the trivial add: 1s/46 tok).
- It gives **no correctness edge**: 4/5, same as qwen2.5/qwen3, _below_ hermes4's 5/5.
- **hermes4:14b already wins** this bench outright — fast, correct, concise. It's your best local reasoner today.
- The 27B would be even slower (CPU-bound on the 780M) — not worth pulling for daily use.

Caveat: the palindrome "fails" for Qwopus/qwen3 are likely formatting (auto-check substring), not wrong logic — but the latency/verbosity gap is decisive regardless. Net: Opus-style reasoning distilled into a 9B didn't beat your existing stack here. Keeping hermes4 as the local reasoner; Qwopus 9B can be removed unless you want it for offline deep-reasoning where speed doesn't matter.
