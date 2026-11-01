# Android Runtime Feasibility Spike

Date: 2026-11-01
Target: Android ARM64 native APK, embedded Node runtime

## Findings

### Node version

The repository declares Node.js >=20.11. The official nodejs-mobile release page currently exposes v18.20.4 as its latest released core-library artifact. That binary is below this repository's runtime floor and must not be substituted silently.

A promising alternative is the public fork/recipe at https://github.com/fogtape/nodejs-mobile:
- Its recipe branch pins upstream Node.js v24.22.1 at commit ce7aaf1cee78b8cf0ce17364260535c418d3ed26.
- It provides Android arm64-v8a libnode.so artifacts and a reproducible source-reconstruction recipe.
- Its documentation describes Android build requirements (Linux host and Android NDK r27d), device smoke tests, 16 KB page-size coverage, and a full Node 24 runtime line.
- This is a third-party maintained fork, not the official nodejs-mobile release. Before shipping, pin an exact release asset and checksum, inspect its patch set, license and provenance, and reproduce the build in CI.

References:
- Official releases: https://github.com/nodejs-mobile/nodejs-mobile/releases
- Candidate runtime: https://github.com/fogtape/nodejs-mobile
- Candidate build instructions: https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/BUILDING.md
- Candidate embedding instructions: https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/EMBEDDING.md

### Critical child-process incompatibility

The candidate runtime's FAQ explicitly warns that child_process.spawn(), fork() and other APIs creating new processes run into permission issues on mobile.

The current Direct engine's PowSolver in src/direct/pow.mjs starts bin/ds-pow using child_process.spawn(). Therefore, merely embedding Node 24 and copying the current Go executable into the APK will not make Direct mode work.

The mobile PoW design must change behind the existing PowSolver interface. Candidate approaches, in preferred investigation order:
1. In-process Android native binding: expose the existing Go PoW implementation through an Android JNI library and a narrow N-API bridge or host-provided native interface. Preserve the existing input/output data contract, not the subprocess.
2. WebAssembly fallback: compile the pure Go PoW implementation to wasm and invoke it in Node's V8 runtime, then benchmark on representative ARM64 devices.
3. Pure JS/Kotlin implementation only if the above options fail and correctness/performance are demonstrated.

The desktop implementation must continue to use the existing child-process solver unchanged.

### Browser engine

Playwright launches browser processes and a desktop Chromium binary. Because mobile Node runtimes do not support general child-process creation and the repository does not include an Android Chromium integration, Browser mode is not part of the first Android runtime target. Desktop Browser support must remain intact.

### Android runtime environment

The embedded runtime must receive app-private paths before Node initialization:
- TMPDIR -> Android cache directory.
- HOME -> app files or no-backup directory, depending on usage.
- DATA_DIR -> app no-backup directory for credentials and durable service state.
- NODE_COMPILE_CACHE -> app cache directory.
- A bounded V8 heap option appropriate to phone memory.

The Node runtime must be started and stopped by a Kotlin foreground service. Activity/WebView lifecycle must not own the Node process lifecycle.

## Decision

Use fogtape/nodejs-mobile Node 24.22.1 as the leading feasibility candidate, not yet as an approved dependency. First create a minimal Android ARM64 runtime proof that:
1. Loads the exact pinned libnode.so from an APK.
2. Starts the repository's Node entrypoint in-process.
3. Sets TMPDIR, HOME and DATA_DIR before Node initialization.
4. Serves /healthz and /app on loopback.
5. Loads the WebUI in a locked-down WebView.
6. Executes the PoW path through a non-child-process Android binding or WASM backend.
7. Passes the existing API compatibility suite on desktop and a reduced real-device smoke suite on Android.

Do not publish an APK or claim Direct mode support until these checks pass on an Android ARM64 device.

## Reproducible Node 24 candidate details

The candidate was inspected at recipe branch commit `d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5`. Its `upstream-base.txt` pins official Node.js v24.22.1 at `ce7aaf1cee78b8cf0ce17364260535c418d3ed26`. The recipe reconstructs the source by applying an ordered patch series, overlaying mobile-only files and checking `expected-tree.txt` before a build. The Android build helper supports a single `arm64` target and outputs `out_android/arm64-v8a/libnode.so`.

The documented Android build prerequisites are Linux, Android NDK r27d (27.3.13750724), Python 3.12/3.13 with setuptools, build-essential and multilib. This is a source build, not a prebuilt artifact dependency. A CI job can pin the recipe commit, run `scripts/prepare.sh`, build only ARM64, and upload the library plus generated Node headers as a workflow artifact.

The recipe's own Android test app demonstrates the supported embedding path:
- load `libnode.so` and an app JNI bridge;
- call `node::Start(argc, argv)` on a dedicated Java thread;
- set app-private working directory and environment before Node starts;
- copy the JS project into app-private storage;
- redirect native stdout/stderr to Android logging.

This is a concrete integration reference, but it is a third-party recipe and must still pass our independent source/license review and runtime smoke tests. Pinning the commit does not itself constitute approval.

### PoW adapter direction without changing the PoW algorithm or desktop engine

The existing Go package `pow` already exports `SolvePow`, `SolvePowWorkers` and `Warmup`. The existing `cmd/powd` executable is only a JSON-lines process wrapper around that package. This separation permits an Android-only in-process wrapper to call the same Go solver without changing its algorithm.

Preferred implementation experiment:
1. Build the existing Go `pow` package for Android ARM64 as a C archive (or shared library if the NDK/Go toolchain requires it).
2. Expose a narrow N-API addon that calls the Go solver asynchronously.
3. Load it through an Android-only Node preload.
4. In that preload, intercept only the existing `child_process.spawn(<configured ds-pow path>)` call and provide a compatible in-memory stdin/stdout/stderr child-process facade backed by the native addon. Call `syncBuiltinESMExports()` so the existing ESM named import sees the adapter.
5. Leave every other child-process operation untouched; unsupported operations must fail clearly rather than being silently emulated.
6. Run the existing `src/direct/pow.mjs` request/response protocol tests and Go known-answer tests on desktop and Android.

This approach keeps `src/direct/pow.mjs`, `cmd/powd`, and the DeepSeekHashV1 implementation unchanged. It is an experiment until the N-API ABI, cancellation, stream semantics and device performance are verified.
