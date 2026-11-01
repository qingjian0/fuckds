# fuckds Android Feature Inventory

Baseline: `master` at the time of the Android adaptation audit.
Scope: preserve every existing product/core behavior; add Android hosting and a mobile management UI.

## 1. What exists today

The upstream repository is a headless HTTP bridge, not a management dashboard. Its only built-in HTML page is `GET /`, an API documentation/usage page. There is no existing account/settings/logs administration frontend to port. The new `web/` directory is therefore a new management UI, not a rewrite of an existing frontend.

### Existing public HTTP contract (must remain unchanged)

| Method + path | Purpose | Existing behavior |
|---|---|---|
| GET `/healthz`, `/health` | Health/status | Returns process uptime, PID, engine-specific status and version |
| GET `/` | Landing page | Existing API usage/documentation page |
| GET `/v1/models` | OpenAI model list | Existing auth semantics |
| GET `/v1/models/:id` | Model detail | Existing auth semantics |
| POST `/v1/chat/completions` | OpenAI chat | Streaming/non-streaming, tools, images where supported |
| POST `/v1/completions` | Legacy OpenAI completion | Existing compatibility behavior |
| POST `/v1/messages` | Anthropic Messages | Streaming/non-streaming, tools, thinking |
| POST `/v1/messages/count_tokens` | Anthropic token estimate | Existing response format |

No Android work may rename, remove, proxy differently, or alter the request/response contract of these routes.

## 2. Existing capabilities to expose, not reimplement

### Runtime and engines
- Engine selection: `direct`, `browser`, `auto`.
- Direct engine: DeepSeek internal HTTP calls, account pool, session lifecycle, PoW challenge/solver, SSE patch parsing, retry/failover, image and attachment upload, overflow-to-attachment.
- Browser engine: Playwright + Chromium, session injection, page lifecycle, DOM stream capture plus raw completion capture, retry/cooldown, login check.
- Shared chat runner: prompt creation, upload/overflow coordination, output normalization and fabrication protection.
- Existing warm-up and graceful shutdown behavior.

### Account and authentication
- User token normalization accepts raw token and the documented localStorage JSON shape.
- Token persistence is `data/auth.json`, mode 0600, with deduplication and multi-account support.
- CLI supports add/replace, masked list and login check.
- Direct engine account pool tracks masked token, cooldown, request counts, failures and auth-failed state; selection/rotation and failover remain in the engine.
- Browser engine currently uses configured token and exposes login/session state, not the same Direct account-pool telemetry.

### Request/protocol features
- OpenAI and Anthropic request normalization and response serializers.
- SSE streaming, thinking/reasoning output, usage estimates, tool-call conversion and output sanitization.
- DeepSeek-specific prompt protocol, DSML/tool syntax compatibility, overflow-to-attachment, image upload, retry and anti-fabricated-tool-result behavior.
- Model aliases and thinking/search controls.
- These are core AI/protocol behaviors and are strictly outside the Android UI rewrite scope.

### Configuration
- Environment and `.env` based configuration loaded at process startup.
- Configuration groups: server host/port/API key/CORS; engine and PoW binary; DeepSeek URL/token/model/thinking/search/device profile/cold start/human timing; Browser Chromium/viewport/locale/launch; runtime concurrency/queue/timeouts/retries/stream capture/overflow/artifacts.
- There is currently no runtime configuration REST API and no general live-reload contract. UI must not pretend settings can be applied live until a separate, explicit lifecycle design exists.

### Logs and process control
- Logger writes to stdout/stderr with error/warn/info/debug/trace levels and scoped child loggers.
- `npm run up/down/status` uses a detached process, PID file and `data/server.log`; process discovery uses Linux `pgrep`/`ps`.
- There is currently no in-memory log ring buffer, log subscription API or structured log management endpoint.
- Android lifecycle must be owned by a Kotlin foreground service, not by the WebView Activity. Existing shell process-control scripts are not an Android lifecycle implementation.

## 3. New mobile UI feature requirements

| UI area | Required real functionality | Current state |
|---|---|---|
| Overview | Health, engine, uptime, PID, version, account/queue/engine diagnostics where actually available | Initial health view only |
| Accounts | View masked accounts and status; add/replace/remove tokens; validate login; show per-account cooldown/failover state where engine provides it | Connected through authenticated admin API; saved changes require restart |
| Engine | Show selected engine and actual readiness; preserve Direct/Browser/Auto choices; clearly explain Android compatibility gates | Not connected |
| Settings | Read current effective config; edit only whitelisted settings; validate; persist safely; restart/reload through host lifecycle | Whitelisted config read/write implemented; restart still pending Android host |
| Logs | Bounded recent logs, level filtering, secret redaction, live updates, pause/resume, reconnect and clear-view (not delete source logs) | 500-entry in-memory redacted buffer + authenticated list/SSE; mobile viewer implemented |
| API Playground | OpenAI chat/completions and Anthropic Messages; stream/non-stream; thinking/tools/image inputs only when supported; status, headers and raw/parsed output | All existing OpenAI/Anthropic endpoints exposed through editable raw JSON; SSE output supported |
| Diagnostics | Health snapshots, runtime capabilities, storage checks, engine-specific diagnostics and exportable redacted report | Not connected |
| Service control | Start/stop/restart/status through Android foreground service; startup and crash recovery | Not implemented |
| API compatibility | Display/copy existing endpoints and preserve all existing client-facing behavior | Endpoint shortcuts only |

The UI must not expose raw DeepSeek user tokens, API keys, cookies, device identifiers or unredacted request headers. Secrets are entered through a protected input path and masked thereafter.

## 4. Integration boundaries

Allowed:
- New Android Gradle project, Kotlin Application/Activity/Foreground Service, WebView shell, local assets and navigation.
- New platform-specific runtime bootstrap and filesystem mapping.
- New additive, separately authenticated management API namespace.
- New logging sink/adapter that observes existing logger output without changing message generation or protocol logic.
- New management facade that calls existing exported auth/config/status helpers where safe.
- Android-only adapters behind narrow interfaces when a platform API differs.

Not allowed:
- Changes to prompt construction, agent/tool behavior, reverse-proxy request construction, protocol serializers, account rotation/failover policy, Direct/Browser engine semantics, PoW algorithm, or any existing public API behavior.
- Fake data, fake buttons, placeholder features represented as completed.
- UI writes directly to internal engine state or arbitrary files.

Any unavoidable platform adapter must be opt-in/platform-gated, leave desktop behavior intact, and have focused compatibility tests.

## 5. Android feasibility gates (not feature deletions)

- Embedded Node runtime must satisfy the repository's declared Node >=20.11 requirement and be pinned/provenanced.
- Direct PoW currently launches `bin/ds-pow` through `child_process.spawn()`; Android process restrictions mean a plain copied Go executable is not yet proven. A platform PoW adapter is required, while the desktop subprocess implementation stays unchanged.
- Browser mode depends on Playwright launching desktop Chromium. Android WebView is not a drop-in Playwright Chromium executable. Browser support requires a separately proven Android browser-control adapter or an external supported runtime; until then mark it as an explicit compatibility gate, do not silently switch engines or delete Browser support.
- Native service owns Node lifecycle; WebView only presents UI.
- Use app-private storage for auth/config/logs, restrictive file permissions where supported, loopback-only binding, origin/host validation, management authentication and CSRF protection.

## 6. Definition of full completion

1. All existing API contract tests pass unchanged on desktop.
2. Existing core/AI files have no functional diff from the baseline unless a strictly necessary platform adapter is isolated and reviewed.
3. Every row in section 3 is backed by a real operation, or is explicitly blocked by a documented Android platform gate (never a placeholder).
4. Android ARM64 APK installs, starts/stops the foreground service, survives Activity recreation, persists app-private data, and loads the local WebView UI.
5. Direct mode is verified on a real ARM64 device including PoW known-answer tests and real authenticated smoke tests.
6. Browser mode remains present and desktop-verified; Android support is only claimed after a real device integration test.
7. OpenAI/Anthropic API compatibility, SSE, tools, images, overflow and error semantics are regression-tested unchanged.
8. Security tests cover management auth, origin/host checks, CSRF, secret redaction, path traversal and untrusted WebView navigation.
