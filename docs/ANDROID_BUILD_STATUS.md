# Android APK Build Status

Date: 2026-11-01
Branch: `android/apk-native-host`

## Implemented in the first host slice

- Minimal Kotlin Android application, ARM64 only, minSdk 26.
- WebView loads the existing `/app` page from `127.0.0.1:8787`; external navigation is blocked.
- Node runtime is embedded as Android/Bionic `libnode.so`, not executed as a glibc Linux binary.
- A separate Android service process (`:node`) owns the Node event loop, so Activity recreation does not own the engine lifecycle.
- Runtime assets are extracted to app-private no-backup storage; auth/config data stays under app-private files.
- The app generates a random 256-bit ADMIN_API_KEY and offers a one-time copy action for the existing admin UI.
- GitHub Actions builds the Node Mobile runtime from pinned recipe commit `d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5` (Node 24.22.1 line), then builds an ARM64 debug APK.
- The asset packager copies the existing `src/`, `web/`, and required Playwright JS packages. It does not rewrite the engine.

## Important current limitation

The host slice is not yet a fully functional Android AI engine.

- Android currently boots with `ENGINE=auto` and `WARMUP=false` so the local management UI and health endpoint can start before an Android PoW adapter exists.
- With no Go PoW executable, the existing engine selector falls back to Browser. Playwright's desktop Chromium process is not an Android browser backend, so real chat requests are not yet verified/supported on Android.
- The next required implementation is an Android-only PoW adapter that invokes the exact existing Go PoW implementation in-process (WASM or native binding), while leaving desktop `src/direct/pow.mjs` subprocess behavior unchanged.
- Do not claim Android Direct mode works until the existing Go known-answer vectors, PoW request protocol tests, and real DeepSeek smoke test pass on an ARM64 device.
- Browser mode remains in the repository and unchanged for desktop. Android Browser support requires its own validated backend.

## Verification status

- [x] New Android project and build workflow committed.
- [x] Runtime recipe commit pinned.
- [ ] GitHub Actions APK build completed successfully.
- [ ] APK installed on an Android ARM64 device.
- [ ] Embedded Node starts and `GET /healthz` succeeds on-device.
- [ ] Existing WebUI loads on-device.
- [ ] Android PoW adapter passes known-answer and protocol tests.
- [ ] Direct API streaming/auth/image/tool regression tests pass on-device.

A committed workflow or source file is not evidence of a successful build or device test. Update this document only with observed results.
