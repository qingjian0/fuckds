# Android Native WebUI Implementation Plan

Baseline: qingjian0/fuckds master @ 11f80cbcd3a7ce07a5705066c7f193541a106ceb
Branch: feat/android-native-webui

## Release strategy

Keep the current desktop distribution working. Android is an additional target and must not force desktop users to adopt an embedded runtime or alter existing API defaults.

## Workstreams and gates

### P0 — Compatibility and security foundation
- Freeze current API route and response behavior with regression tests.
- Add tests proving /v1/* behavior is unchanged by admin routing.
- Design an independent admin authentication/session mechanism.
- Remove secrets from HTML output and add tests for landing-page redaction.
- Keep admin listener loopback-only by default; validate Host and Origin; protect mutations against CSRF.
- Add structured, bounded, redacted log access.

Exit gate: existing Node test suite passes; admin security tests pass; no token/API-key leakage in HTML, JSON, logs, or UI.

### P1 — Mobile WebUI
- Add standalone static frontend under web/ (TypeScript/HTML/CSS).
- Implement responsive navigation and five sections: Dashboard, Accounts, Settings, Logs, Playground.
- Use same-origin requests and EventSource for logs/SSE.
- Add viewport/safe-area, keyboard, touch-target, narrow-screen, dark/light theme support.
- Keep secrets masked and never prefill token fields from server responses.

Exit gate: frontend build is reproducible; responsive smoke checks at 360dp, 390dp, 430dp; all actions use authenticated admin APIs.

### P2 — Android host and runtime feasibility
- Add Kotlin Android application skeleton and WebView host.
- Add foreground service and notification-backed lifecycle controls.
- Decide and pin embedded Node runtime only after Android ARM64 prototype demonstrates Node >=20.11 compatibility and required Node APIs.
- Package app-private writable data directory and bundled read-only assets.
- Validate local origin, cleartext policy, WebView navigation allowlist, process shutdown and restart.
- Cross-compile Go PoW daemon for Android ARM64 with CGO_ENABLED=0 and run on a physical ARM64 device/emulator.

Exit gate: APK starts embedded Node, /healthz responds, Direct PoW works on ARM64, WebView loads the local UI, service survives Activity recreation.

### P3 — Core management operations
- Status/diagnostics read model.
- Account list with masked values, add/remove/replace and explicit validation.
- Configuration schema with allowlist, validation, atomic persistence and restart-required indicators.
- Service lifecycle commands routed through Android host; no generic shell API.
- Bounded logs and SSE reconnect support.

Exit gate: no raw credentials returned; invalid config rejected without corrupting active config; restart is serialized and observable.

### P4 — Playground and hardening
- OpenAI and Anthropic request testing, including streaming and cancellation.
- Model listing, error rendering, reasoning and tool-call inspection.
- Request limits, rate limits, CSRF, origin validation, CSP, WebView external-navigation blocking.
- API compatibility regression and security tests.

Exit gate: API contract suite passes; Android smoke test passes; desktop test suite remains green.

## Implementation order

1. Land this audit and plan without touching core behavior.
2. Implement security fixes that do not alter /v1/* contracts.
3. Add admin API behind a feature flag and independent auth.
4. Build the mobile frontend against mocked admin fixtures, then connect it to real APIs.
5. Prototype Android ARM64 Node + Go runtime independently; stop and reassess if Node 20.11+ cannot be embedded reliably.
6. Integrate WebView and foreground service.
7. Implement management operations and Playground incrementally.

## Validation matrix

| Area | Desktop regression | Android build | Android device |
|---|---|---|---|
| OpenAI non-streaming | Required | N/A | Required |
| OpenAI SSE | Required | N/A | Required |
| Anthropic Messages | Required | N/A | Required |
| Models / auth | Required | N/A | Required |
| Direct engine | Required | ARM64 binary | Required |
| Browser engine | Required | Not bundled initially | Explicitly unsupported |
| Admin auth / CSRF | Required | Required | Required |
| WebView origin / navigation | N/A | Required | Required |
| Foreground service lifecycle | N/A | Required | Required |

## Definition of done

- Existing API routes, payloads, streaming semantics and error shapes remain compatible.
- Desktop Direct and Browser behavior remains intact.
- Android APK runs the supported Direct path without requiring Termux or a separately installed Node.
- All secrets stay in app-private storage and are never returned to WebView.
- UI remains usable on narrow Android phones and handles process/service lifecycle correctly.
- Tests and build evidence are recorded; unrun device tests are explicitly marked unverified.
