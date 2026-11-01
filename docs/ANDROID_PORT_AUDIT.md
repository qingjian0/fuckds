# Android Native Port Audit

Audit date: 2026-11-01
Repository: qingjian0/fuckds
Base branch: master
Base commit: 11f80cbcd3a7ce07a5705066c7f193541a106ceb
Working branch: feat/android-native-webui

## Executive summary

The repository is a Node.js HTTP compatibility service with a Go PoW subprocess. It currently has no Android project and no standalone frontend application. The root route serves a server-generated HTML landing page. The OpenAI and Anthropic APIs are implemented in the existing Node HTTP server and must remain backward compatible.

The safest first Android target is the Direct engine, with the existing API handlers and protocol transformation code retained. Browser/Playwright must be treated as a desktop-only capability until a separately validated Android browser backend exists.

## Verified repository inventory

- Node runtime requirement: >=20.11 (package.json).
- Go module: Go 1.23 (go.mod).
- Runtime dependency: Playwright ^1.49.1 (package.json).
- HTTP server: Node built-in http (src/server.mjs).
- Existing API routes: GET /healthz, /health, /, /v1/models, /v1/models/:id; POST /v1/chat/completions, /v1/completions, /v1/messages, /v1/messages/count_tokens.
- Direct engine: Node implementation calling DeepSeek web endpoints, backed by Go PoW process (src/direct/*, cmd/powd/*).
- Browser engine: Playwright driver (src/browser/*).
- Authentication data: data/auth.json, written with mode 0600 by src/auth.mjs; data/ is gitignored.
- Server defaults: HOST=127.0.0.1, PORT=8787; API_KEY may be empty; CORS defaults to * (src/config.mjs, .env.example).
- Existing tests use Node's built-in test runner under test/*.test.mjs.
- No Android Gradle project, Android manifest, frontend bundler, or dedicated admin API exists on the audited tree.

## Architecture constraints and risks

### Runtime

1. The Android APK needs an embedded ARM64 Node runtime or a separately managed runtime. Simply packaging JavaScript is insufficient.
2. The current PoW executable is built for the host platform by scripts/build-pow.mjs. Android requires an explicit Android ARM64 cross-build and runtime execution test.
3. The Go PoW daemon uses stdin/stdout JSON lines and is spawned by src/direct/pow.mjs. Preserve that process protocol initially.
4. Playwright's bundled desktop Chromium cannot be assumed to run on Android. Do not report Browser mode as Android-supported without device validation.
5. The Linux Chromium dependency workaround is not proof of native Android Browser support.

### API compatibility

1. Existing /v1/* route behavior and payloads are compatibility-critical.
2. New management endpoints must live under a separate /admin/* namespace and must not change existing API auth semantics.
3. Management operations must not call engine internals in ways that alter active request handling.
4. Configuration changes that affect engine construction require a controlled restart/recreate operation.

### Security findings

1. API_KEY is optional and requireAuth returns without authentication when it is empty. This behavior is existing API compatibility and must not be silently changed for /v1/*.
2. CORS defaults to *; this is unsuitable as the sole protection for a privileged management UI.
3. /healthz returns web.status(); README documents account-level availability and last-error fields. Avoid exposing that diagnostic payload to untrusted origins in the new UI.
4. The root landing page is unauthenticated. landingPage interpolates the configured API key into example commands when API_KEY is set. Review this before embedding the page in an APK or exposing a non-loopback listener.
5. The admin surface must have independent authentication, loopback binding by default, strict Host/Origin validation, CSRF protection, no token echo, and log/config redaction.
6. Token storage mode 0600 is a useful POSIX default but Android app-private storage and backup exclusion need to be defined.

## Recommended target architecture

- Android application: Kotlin, Android Gradle Plugin, foreground service for server lifetime, notification and lifecycle integration.
- Embedded runtime: select and prove an Android ARM64 Node runtime before committing to a runtime distribution strategy.
- Core: retain the current Node service modules and API handlers.
- PoW: cross-compile the existing Go daemon for Android ARM64; preserve its JSON-lines IPC.
- UI: standalone static TypeScript/HTML/CSS application served from app-bundled assets by the local Node service.
- WebView: load only the loopback origin; no general-purpose JavaScript bridge. Use narrowly scoped native capabilities only where unavoidable.
- Browser engine: desktop-only on the first Android release; show an explicit unsupported state on Android rather than silently falling back.
- Admin API: independent /admin/v1/* namespace and auth/session model; do not overload /healthz or /v1/*.

## Non-goals for the first implementation slice

- Rewriting the DeepSeek protocol.
- Replacing the OpenAI or Anthropic adapters.
- Porting Playwright Chromium to Android without evidence.
- Exposing userToken or API_KEY to JavaScript.
- Adding a general plugin framework or arbitrary shell execution endpoint.
