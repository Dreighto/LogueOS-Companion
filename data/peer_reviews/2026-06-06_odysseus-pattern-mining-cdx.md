# Odysseus Pattern Mining For Sully

Read-only investigation target: `/home/dreighto/dev/odysseus`

Goal: extract implementation patterns worth adapting for Sully (`/home/dreighto/dev/LogueOS-Companion`) without lifting code across stacks.

---

## 1. Model-endpoint management

### Key files

- `/home/dreighto/dev/odysseus/routes/model_routes.py`
- `/home/dreighto/dev/odysseus/core/database.py`
- `/home/dreighto/dev/odysseus/src/model_discovery.py`
- `/home/dreighto/dev/odysseus/src/endpoint_resolver.py`
- `/home/dreighto/dev/odysseus/routes/copilot_routes.py`

### How Odysseus implements it

Odysseus treats model endpoints as first-class persisted resources in the `model_endpoints` table via `core/database.py:class ModelEndpoint`. The row stores `base_url`, encrypted `api_key`, `hidden_models`, `cached_models`, `pinned_models`, `endpoint_kind`, `supports_tools`, `model_refresh_mode`, `model_refresh_interval`, `model_refresh_timeout`, `model_type`, and `owner`. That means discovery state, operator curation, and routing hints live with the endpoint instead of being recomputed on every request.

`routes/model_routes.py` is the control plane. Important entrypoints:

- `create_model_endpoint()`
- `test_model_endpoint()`
- `list_model_endpoints()`
- `probe_local_endpoints()`
- `probe_selected()`
- `probe_models()`
- `probe_endpoint_models()`
- `list_endpoint_models()`
- `update_hidden_models()`
- `api_models()`
- `providers()`
- `discover_local()`

The create path does several practical things that are easy to miss:

- Normalizes URLs through `_normalize_base()` and `resolve_url()`.
- Rewrites loopback endpoints for Docker with `_rewrite_loopback_for_docker()`.
- Deduplicates by `base_url` plus compatible credentials before creating a new row.
- Probes `/models` or provider-native equivalents up front when needed.
- Seeds `cached_models` immediately so the picker can render without waiting for a later refresh.
- Auto-assigns the first endpoint as default if no default exists.

Docker loopback handling is especially strong. `_rewrite_loopback_for_docker()` plus `_docker_host_gateway_reachable()` and `_container_loopback_reachable()` distinguish:

- host-local servers the container should reach via `host.docker.internal`
- container-local servers that should stay on `127.0.0.1`
- wildcard binds like `0.0.0.0` that must be converted to a connectable host

That avoids the classic “localhost inside Docker points back at the app container” failure.

Provider handling is split between `model_routes.py` and `endpoint_resolver.py`:

- `build_chat_url()`
- `build_models_url()`
- `build_headers()`
- provider detection via `_detect_provider()`

It supports provider-specific URL and header behavior for:

- Ollama
- OpenAI-compatible local servers like vLLM / llama.cpp / LM Studio
- Anthropic
- OpenRouter
- Copilot

`src/model_discovery.py` handles opportunistic discovery rather than just configured endpoints. `ModelDiscovery.discover_models()` scans:

- `8000-8020` for OpenAI-compatible local servers
- `1234` for LM Studio
- `11434` for Ollama
- extra ports parsed from env vars like `OLLAMA_BASE_URL`, `OLLAMA_URL`, and `LM_STUDIO_URL`

It also expands host candidates through:

- `LLM_HOSTS`
- `host.docker.internal`
- Tailscale peer discovery from `tailscale status --json`

Finally, Odysseus separates instant model listing from live probing. `api_models()` is cache-first and fast; `_refresh_caches_bg()` refreshes endpoint caches in the background with:

- per-endpoint refresh policy
- single-flight protection
- failure cooldown backoff
- “keep stale cache on failure” behavior

That is a very good operator-experience pattern.

### Borrow this for Sully

1. Build an `endpoints` registry in Sully, even if Ollama is the main engine today.
   Include fields like `provider`, `base_url`, `scope`, `worker_capabilities`, `cached_models`, `supports_tools`, `last_probe_at`, `last_probe_error`, `refresh_mode`, and `visibility`.

2. Split “discover” from “select”.
   Sully already has a worker roster and local Ollama. Add a background discovery service that populates model metadata without blocking the model picker or worker routing UI. Keep the picker cache-first.

3. Port the Docker/Tailscale URL normalization ideas.
   Sully will likely need the same rewrite rules for local Ollama, remote Ollama, and LAN/Tailscale-served workers. A Node service equivalent to `_rewrite_loopback_for_docker()` and `resolve_url()` is worth building early.

4. Persist operator curation separately from raw discovery.
   Odysseus’s `hidden_models` and `pinned_models` are roadmap-grade patterns. Sully should let the operator hide noisy models, pin trusted models per worker, and maintain “safe defaults” even when providers return huge model lists.

### Gotchas

- Odysseus’s `discover_models()` scans ports broadly; on a busier workstation this can get noisy or slow. Sully should make active scanning opt-in or scoped.
- Matching endpoints by bare `base_url` is useful but brittle if multiple credentials or routing layers share a URL. Sully should use stable endpoint IDs everywhere in the UI and worker routing.
- Odysseus has some endpoint fallback logic that can still drop to “first enabled endpoint” in a few places; Sully should avoid silent fallback when worker or task semantics matter.

---

## 2. Agent tool-loop + MCP

### Key files

- `/home/dreighto/dev/odysseus/src/agent_loop.py`
- `/home/dreighto/dev/odysseus/src/agent_tools.py`
- `/home/dreighto/dev/odysseus/src/tool_execution.py`
- `/home/dreighto/dev/odysseus/src/tool_index.py`
- `/home/dreighto/dev/odysseus/src/mcp_manager.py`
- `/home/dreighto/dev/odysseus/routes/chat_routes.py`
- `/home/dreighto/dev/odysseus/routes/mcp_routes.py`
- `/home/dreighto/dev/odysseus/routes/codex_routes.py`
- `/home/dreighto/dev/odysseus/src/tool_implementations.py`

### How Odysseus implements it

The main loop is `stream_agent_loop()` in `src/agent_loop.py`. It is an SSE-first orchestration loop that:

- builds a tool-constrained system prompt
- decides whether to send native OpenAI-style function schemas or rely on fenced tool blocks
- streams model output round by round
- detects tool calls
- executes them
- feeds tool results back into the next round
- emits structured events like `tool_start`, `tool_progress`, `tool_output`, `agent_step`, `metrics`, and `rounds_exhausted`

Important design choices:

- Native function calling is used when the endpoint can handle it; fenced blocks remain the fallback.
- The loop tracks `max_rounds`, `max_tool_calls`, repeated-call signatures, and “stuck rounds” to break runaway loops.
- There is a verifier pass before accepting a tool-free “done” answer in some cases.
- It supports `plan_mode`, which disables mutating tools while still allowing investigation.

Tool selection is not “send every tool every time”. `src/tool_index.py` builds a RAG index over tool descriptions. The loop then combines:

- `ALWAYS_AVAILABLE`
- RAG-retrieved `relevant_tools`
- keyword fallbacks
- document-context additions like `edit_document`
- owner/admin gating

That is a strong pattern for keeping prompts small while preserving capability.

Execution is centralized in `src/tool_execution.py`. It does three useful jobs:

1. It confines file access.
   `_resolve_tool_path()` and `_resolve_tool_path_in_workspace()` block sensitive paths and keep reads/writes inside allowed roots or an active workspace.

2. It normalizes subprocess execution.
   `_run_subprocess_streaming()` streams progress, keeps tails, applies long but bounded timeouts, and cleans up on cancellation.

3. It routes legacy tool names through MCP when possible.
   `_MCP_TOOL_MAP` maps tools like `bash`, `python`, `read_file`, `write_file`, `web_search`, `web_fetch`, and `generate_image` onto MCP-backed implementations, with direct fallbacks if the MCP server is unavailable.

MCP is managed by `src/mcp_manager.py`. Important behaviors:

- `connect_server()` supports `stdio`, `sse`, and streamable `http`.
- Tools are discovered per server with `list_tools()`.
- Tools are exposed to the LLM as namespaced functions like `mcp__{server_id}__{tool_name}` via `get_all_openai_schemas()`.
- Tool parameter hints are schema-sanitized and length-bounded before being spliced into prompts.
- `plan_mode_blocked_mcp()` fail-closes on MCP writes by allowing only clearly read-only tools.
- Builtin MCP servers can auto-reconnect after crash.

`routes/mcp_routes.py` is the admin surface:

- add/delete/enable/disable servers
- list all tools
- disable selected tools per server
- manage OAuth-related config

The chat surface wires this all together. `routes/chat_routes.py` computes the actual `disabled_tools` set from:

- UI toggles
- global settings
- compare mode
- plan mode
- admin/public capability restrictions

Finally, `routes/codex_routes.py` exposes a narrower bridge surface for external Codex/plugin use. It wraps existing handlers with scope-checked endpoints for todos, email, memory, calendar, documents, and cookbook operations instead of opening the full internal API.

### Borrow this for Sully

1. Keep Sully’s worker roster separate from Sully’s tool registry, but let them meet in a capability layer.
   Odysseus’s pattern suggests a Sully `capability registry` that answers:
   which worker can act, which models can call tools, which tools are visible, and which endpoint can satisfy the request.

2. Add RAG-based tool surfacing for the Work Surface.
   Sully already has tool use; the next leap is narrowing tools per turn. A SvelteKit/Node equivalent of `tool_index.py` will reduce context load and make multi-worker prompts more stable.

3. Treat MCP servers as admin-managed adapters, not just raw connections.
   Persist each server’s transport, auth state, disabled tools, health, and last error. Namespaced tool IDs like `mcp__calendar__create_event` are a good convention for Sully too.

4. Port plan-mode and compare-mode tool stripping.
   Sully’s Work Surface would benefit from explicit “inspect only” and “compare safely” execution modes that mechanically remove write tools rather than trusting prompt wording.

### Gotchas

- Odysseus supports both fenced blocks and native function calls, which adds complexity. Sully should decide when dual-path support is actually worth it.
- The agent loop contains lots of defensive heuristics because local-model behavior is messy. Sully should expect similar guardrails if it leans on Ollama-hosted models for tool use.
- MCP availability and tool drift are operational problems, not just code problems. Sully needs health telemetry for each server, not just a “connected” boolean.

---

## 3. Deep-research multi-step synthesis

### Key files

- `/home/dreighto/dev/odysseus/src/deep_research.py`
- `/home/dreighto/dev/odysseus/src/research_handler.py`
- `/home/dreighto/dev/odysseus/routes/research_routes.py`
- `/home/dreighto/dev/odysseus/src/visual_report.py`
- `/home/dreighto/dev/odysseus/static/js/research/panel.js`
- `/home/dreighto/dev/odysseus/static/js/researchSynapse.js`
- `/home/dreighto/dev/odysseus/src/search/core.py`
- `/home/dreighto/dev/odysseus/src/search/providers.py`

### How Odysseus implements it

The core engine is `DeepResearcher` in `src/deep_research.py`. It is not a one-shot “search then summarize” pipeline. It runs an iterative loop:

1. planning with `_create_plan()`
2. category detection with `_classify_category()`
3. query generation with `_generate_queries()`
4. search and extraction with `_search_and_extract()`
5. synthesis with `_synthesize()`
6. stop/continue decision with `_should_stop()`
7. final long-form report with `_final_report()`

Important details:

- `current_date_context()` is injected so queries use the real current year.
- Query generation explicitly differs between round 1 and follow-up rounds.
- URLs are deduped in `urls_fetched`; queries are deduped in `queries_used`.
- Extraction concurrency is bounded with a semaphore.
- Search provider fallback is explicit through `_build_provider_chain()`.
- The engine tracks `providers_used`, `findings`, `evolving_report`, and `research_plan`.
- If synthesis fails but findings exist, `_fallback_report()` returns something useful instead of discarding the run.

`src/research_handler.py` turns that engine into a durable job system. It maintains `_active_tasks`, persists results to `data/deep_research/<session_id>.json`, exposes `get_status()`, `get_result()`, `get_sources()`, `get_raw_findings()`, and supports cooperative cancellation.

`routes/research_routes.py` adds the UI and ownership layer:

- `research_start()` launches panel-driven jobs
- `research_stream()` streams live progress over SSE
- `research_result_peek()` fetches report data without consuming it
- `research_library()` exposes completed jobs for the library
- `research_report()` renders the visual HTML report
- `research_spinoff()` creates a fresh chat seeded with the report as system context

Two especially strong patterns:

- Research jobs are not tied to a live chat tab. They can survive refresh and later become a chat context via `research_spinoff()`.
- Reports persist both the polished output and the raw source/findings data, so the UI can show quick cards, visual reports, copyable markdown, and follow-up chat handoff without re-running the research.

The frontend in `static/js/research/panel.js` makes this feel like a product, not a backend demo. It renders:

- live progress cards
- a synapse visualization host
- source counts
- category badges
- copy / visual report / discuss / delete actions

The “Discuss” path calls `/api/research/spinoff/{id}` so the user can turn a research artifact into a new conversation.

### Borrow this for Sully

1. Make Sully research a background artifact, not just a long chat message.
   Create durable “research jobs” with status, findings, sources, provider trace, and final report. Then let the Work Surface open, compare, or dispatch off that artifact.

2. Build a spinoff-to-chat path.
   Odysseus’s `research_spinoff()` is highly applicable. Sully should let the operator turn a completed research run into a fresh worker thread or mission card with the research report injected as context.

3. Separate raw findings from final synthesis.
   Sully’s roadmap should store:
   `plan`, `queries`, `sources`, `findings`, `final_report`, `providers_used`, `duration`.
   That supports audits, retries, UI visualizations, and later synthesis upgrades.

4. Add a “research control surface” in the Work Surface.
   The visualization itself is optional, but the product pattern is valuable: show phase, round, source count, and operator actions like cancel, discuss, copy, and archive.

### Gotchas

- Deep research is expensive and failure-prone on slow local models. Sully should make model selection explicit and favor stronger hosted models for synthesis-heavy runs.
- Owner-scoping matters. Odysseus has multiple ownership checks because reports persist on disk outside chat sessions.
- Without careful source-quality filtering, the system will happily synthesize junk. Sully should keep a low-quality filter equivalent to `is_low_quality()`.

---

## 4. Model A/B comparison

### Key files

- `/home/dreighto/dev/odysseus/core/database.py`
- `/home/dreighto/dev/odysseus/routes/compare_routes.py`
- `/home/dreighto/dev/odysseus/static/js/compare/index.js`
- `/home/dreighto/dev/odysseus/static/js/compare/selector.js`
- `/home/dreighto/dev/odysseus/static/js/compare/stream.js`
- `/home/dreighto/dev/odysseus/static/js/compare/vote.js`
- `/home/dreighto/dev/odysseus/static/js/compare/models.js`
- `/home/dreighto/dev/odysseus/static/js/compare/state.js`

### How Odysseus implements it

Persistence is minimal but intentional. `core/database.py:class Comparison` stores:

- `prompt`
- `model_a`, `model_b`
- `endpoint_a`, `endpoint_b`
- `response_a`, `response_b`
- `metrics_a`, `metrics_b`
- `winner`
- `is_blind`
- `blind_mapping`
- `owner`
- `voted_at`

The start flow in `routes/compare_routes.py:start_comparison()` does three key things:

1. creates ephemeral `[CMP]` chat sessions
2. randomizes left/right mapping in blind mode
3. copies the matched endpoint API key into each helper session so each pane can stream independently

Blind mode is protected carefully:

- helper sessions are named `Model A` / `Model B`
- `/api/compare/start` withholds the mapping and model identities when blind mode is on
- `/api/compare/{id}/vote` reveals the mapping only after the user votes

The frontend compare system is more ambitious than a simple two-column diff.

`static/js/compare/index.js`:

- owns compare mode lifecycle
- creates per-model sessions
- rewires the main layout into a compare grid
- forces tool toggles and mode behavior by compare type
- supports up to many panes, not just two

`static/js/compare/selector.js`:

- offers compare types: `chat`, `agent`, `search`, `research`
- persists per-mode selections in localStorage
- supports blind mode, sequential vs parallel, shuffle, and save-on-close
- probes candidate models before starting

`static/js/compare/stream.js`:

- streams each pane independently from `/api/chat_stream`
- sends `compare_mode=true`
- disables document and memory injection
- strips tools differently by compare type
- renders research/web sources and tool events inside the pane

`static/js/compare/vote.js`:

- supports per-pane voting, tie, reveal, reset, and scoreboard
- persists vote history locally
- posts a lightweight record to `/api/compare/record`

This means Odysseus is not just comparing text output. It is comparing whole execution modes:

- plain chat
- agent/tool use
- search-backed answers
- research-backed answers

That is the more interesting product pattern.

### Borrow this for Sully

1. Build compare as a first-class Work Surface mode, not a hidden eval tool.
   Sully already has multiple workers and local models. A multi-pane compare mode for “same prompt, different worker+model+tool profile” is a natural fit.

2. Compare bundles, not just models.
   Odysseus’s “type” distinction maps well to Sully. Compare:
   worker + model + tool profile + endpoint + reasoning mode.
   For Sully that is more useful than model-only A/B tests.

3. Preserve blind evaluation.
   Randomized pane mapping plus post-vote reveal is worth copying. Sully will need this if the operator is comparing AGY vs CC vs CDX vs GMI output honestly.

4. Probe before compare.
   The Odysseus selector verifies models/providers before starting the run. Sully should do the same for workers, MCP availability, and endpoint reachability so compare runs fail fast and legibly.

### Gotchas

- Odysseus creates ephemeral sessions and later cleans them up; Sully needs clear lifecycle rules or the Work Surface will accumulate junk runs.
- Blind mode can be accidentally broken by tiny UI leaks like pane names, model chips, or saved history labels. Sully needs to audit every label path if it ships blind compare.
- Multi-pane compare becomes much more useful when metrics are normalized. Sully should record latency, tool count, token/cost estimate, and completion status per pane from day one.

---

## Top 5 things to steal for Sully

1. An endpoint registry with cached discovery, probe history, pinned/hidden models, and Docker/Tailscale normalization.

2. RAG-based tool surfacing plus hard execution modes like inspect-only, compare-safe, and worker-specific tool profiles.

3. Durable research jobs that can become follow-up chats or dispatch contexts, instead of dumping long reports straight into chat history.

4. Blind multi-pane compare across worker bundles, not just models, with preflight health checks and post-vote reveal.

5. Persisted operator curation everywhere:
   endpoints, tools, research artifacts, compare votes, and worker preferences should all survive refresh and be reusable in the Work Surface.

---

## Sully-specific roadmap implications

- Near-term: endpoint registry, model discovery cache, and compare-safe worker bundles fit Sully immediately.
- Mid-term: durable research jobs plus chat spinoff are strong Work Surface upgrades.
- Long-term: unify worker roster, endpoints, MCP servers, and tool policies into one “execution capability graph” so Sully can route intentionally instead of inferring everything at prompt time.
