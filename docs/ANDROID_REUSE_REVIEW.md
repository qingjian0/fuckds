# Android APK Reuse Review

Date: 2026-11-01
Target branch: `android/apk-native-host`
Base: `feat/android-native-webui`

## Decision

Build a small Kotlin Android host with a WebView and an embedded Node runtime. Keep the existing fuckds engine as the engine payload. Do not introduce a Linux rootfs, PRoot, Docker, or a general container manager in the first APK.

## Reusable references

### 1. Node.js Mobile / fogtape recipe

- Repository: https://github.com/fogtape/nodejs-mobile
- Reviewed branch: `recipe`
- README currently identifies Node 24.22.1, upstream tag commit `ce7aaf1cee78b8cf0ce17364260535c418d3ed26`.
- Android artifacts include `libnode.so` for arm64-v8a, armeabi-v7a and x86_64, with 16 KB page-size support documented.
- Reuse: upstream Node source pin, recipe reconstruction, Android build scripts, JNI embedding pattern, and test-app lifecycle as references.
- Do not blindly vendor a binary. Pin an exact release/recipe commit, verify checksums, inspect the mobile patch series and licenses, and reproduce the build in CI before shipping.

### 2. Node.js Mobile Android sample

- Guide: https://code.janeasystems.com/nodejs-mobile/android/node-project-folder
- Reuse: package the JS project as assets, copy it to app-private writable storage, and start Node from that extracted directory.
- Adaptation: the sample uses an Activity-owned lifecycle; fuckds must instead be owned by a Kotlin foreground service so WebView recreation does not kill the engine.

### 3. electerm Android

- Repository: https://github.com/electerm/electerm-android
- License shown by repository: MIT.
- Reuse as an architecture reference: WebView frontend -> loopback HTTP -> on-device Node backend; native Android shell; runtime starts independently of the web UI.
- Do not copy its Capacitor application wholesale. fuckds requires a small native Kotlin host, and its Node/Playwright/Go-PoW compatibility constraints differ.

## Runtime compatibility gate

Node.js Mobile documents that APIs creating processes, including `child_process.spawn()` and `fork()`, run into permission issues on mobile. The current fuckds Direct PoW adapter starts the Go solver through a child process. Therefore:

1. Embedded Node alone is not sufficient to claim Direct mode works.
2. Preserve the existing desktop child-process implementation.
3. Add an Android-only adapter behind the existing PoW boundary, calling the same Go PoW implementation in-process (JNI/N-API or another verified native bridge).
4. Test cancellation, stream/protocol compatibility, known-answer vectors and ARM64 performance on a real device.
5. Playwright Browser mode remains present and unchanged for desktop; Android Browser support is a separate compatibility gate, not a reason to remove or silently substitute the engine.

## Minimal APK boundary

- Kotlin: Activity, foreground service, runtime bootstrap, WebView host.
- Native runtime: pinned Node Mobile `libnode.so` and the narrow JNI bridge.
- Engine: existing fuckds JavaScript sources and production dependencies, copied to app-private storage before start.
- UI: existing web assets served on loopback; WebView may load only the expected local origin.
- Data: app-private auth/config/log/cache directories, excluded from Android backup where appropriate.

## Explicit non-goals for this first slice

- No PRoot/Linux rootfs or Docker/containerd.
- No Termux dependency.
- No rewrite of reverse proxying, prompts, Agent/tool behavior, serializers, API contracts, account rotation, Direct/Browser semantics or PoW algorithm.
- No fake UI actions or claims of device verification before an actual device test.

## Exit criteria for the first runtime slice

- [ ] Reproducible Node 24.22.1 ARM64 build and verified artifact provenance/checksum.
- [ ] APK loads the runtime and starts/stops it from a foreground service.
- [ ] Engine assets are extracted atomically to app-private storage.
- [ ] Node serves the existing `/healthz` route on loopback.
- [ ] Existing WebUI loads in a navigation-restricted WebView.
- [ ] Android PoW adapter passes existing Go known-answer vectors and the existing JS protocol tests.
- [ ] Desktop tests and protected core files remain unchanged.
- [ ] Real Android ARM64 device smoke test passes before claiming Direct support.
