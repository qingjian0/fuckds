# Local Management API

The management API is additive and separate from the existing OpenAI/Anthropic API surface.

## Enable

Set a dedicated key in the app-private `.env`:

```sh
ADMIN_API_KEY=$(openssl rand -hex 32)
```

The key must be at least 32 bytes. Never reuse `API_KEY` and never place this value in the APK's static assets. The Android host will generate a random key in app-private storage, inject it into the Node runtime environment before startup, and pass it to the WebView through a narrowly scoped native bridge. The browser UI keeps it in memory only.

If the key is unset or shorter than 32 bytes, all management routes return `503 admin_not_configured`.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/status` | Engine status and process uptime |
| GET | `/admin/accounts` | Masked saved account list and runtime state |
| GET | `/admin/config` | Read whitelisted effective settings |
| PATCH | `/admin/config` | Validate and atomically update whitelisted `.env` settings |
| GET | `/admin/logs` | Read the bounded redacted in-memory log buffer |
| GET | `/admin/logs/stream` | Subscribe to live log entries using SSE |
| POST | `/admin/accounts` | Add, replace or remove saved tokens |
| POST | `/admin/accounts/check` | Verify Browser login or send a Direct engine probe |

All requests require `Authorization: Bearer <ADMIN_API_KEY>`.

Account changes write the existing `data/auth.json` schema and return `restartRequired: true`; the active engine is not mutated in place. If tokens are supplied by `DEEPSEEK_USER_TOKEN(S)` environment variables, account writes are rejected with `409 accounts_env_managed`. The Direct check is a real one-message probe and may consume account quota.

## Security controls

- Only loopback socket clients are accepted (`127.0.0.1`, `::1`).
- Host must be `localhost`, `127.0.0.1` or `::1`; an Origin, when present, must match that local Host.
- Bearer comparison uses constant-time comparison after length validation.
- Responses are `no-store`; request bodies are capped at 64 KiB.
- User tokens are never returned in plaintext; only the existing mask format is returned.
- The admin key is distinct from the client-facing `API_KEY`.
- No arbitrary file path or engine-internal mutation endpoint is exposed.

Configuration writes accept only existing non-secret settings (engine, thinking/search toggles, concurrency, timeouts, overflow controls, Browser viewport/locale and related runtime values). Values are validated, unknown keys are rejected, existing .env comments/unknown keys are preserved, and the file is replaced atomically with restrictive permissions. Changes are restart-required; the active engine is never mutated in place. Environment variables supplied externally still take precedence.

The logger is wrapped at process startup with a 500-entry in-memory ring buffer. It captures only levels enabled by the configured logger, redacts configured tokens/API keys and common Bearer/secret fields, and supports incremental reads plus SSE. Clearing the UI only clears the view; it does not delete server-side logs.

The API still does not expose arbitrary file access or service restart. Restart remains the responsibility of the Android foreground-service host; it must not be faked by the WebUI.
