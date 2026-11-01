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
