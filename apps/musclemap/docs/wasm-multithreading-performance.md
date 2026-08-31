# WebAssembly multithreading performance

Status: research note, 2026-08-28

## Recommendation

GitHub Pages does not apply the repository's `_headers` file. MuscleMap 1.4.4 therefore keeps its ORT worker assets under `/musclemap/`, inside the app's isolation service-worker scope. The composite builder still shares ORT with other apps and retains only MuscleMap's checksum-matched local copy. A browser smoke test creates a real ORT session, requests the shared isolated-worker thread policy, and completes one inference.

MuscleMap already uses ONNX Runtime Web's multithreaded WebAssembly path. Do not add another proxy worker or assume that an ONNX Runtime upgrade will unlock a new CPU-threading mode. Measure `1`, `2`, `4`, and `8` threads and separate time spent in `session.run()` from the JavaScript pipeline. Keep the shared isolated-all-logical-core policy until that benchmark establishes a faster cap.

Test ONNX Runtime 1.29 and its native WebGPU build on a separate branch. That upgrade changes more than threading and needs the existing output-fidelity gates.

## Current state

MuscleMap pins ONNX Runtime Web 1.21.0 in [`web/setup.sh`](../web/setup.sh) and the shared [runtime asset manifest](../../../runtime-assets/manifest.json). It vendors both `ort-wasm-simd-threaded.wasm` for CPU inference and `ort-wasm-simd-threaded.jsep.wasm` for the WebGPU-capable JSEP build.

[`getOptimalWasmThreads()`](../../../packages/components/src/worker/runtime.js) returns `1` unless the worker is cross-origin isolated. In an isolated worker, it returns the finite integer reported by `navigator.hardwareConcurrency`. The worker assigns that value to `ort.env.wasm.numThreads` before the first session is created. A value of eight means one calling thread and seven PThread workers because ORT creates `numThreads - 1` workers. The setting initializes ORT's global intra-op pool, so it affects ONNX operators rather than MuscleMap's JavaScript resampling, tile assembly, logit accumulation, connected-component cleanup, or metric calculation. [ORT 1.21 factory source](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/web/lib/wasm/wasm-factory.ts#L137-L146) [ORT runtime initialization](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/web/lib/wasm/wasm-core-impl.ts#L76-L96)

The current worker already keeps inference off the UI thread. [`MuscleMapPipeline`](../web/js/controllers/MuscleMapPipeline.js) configures the shared `PipelineExecutor`, which creates `inference-worker.js` as a module worker. The supplied neck result of 238.6 seconds at eight threads is therefore evidence that threads were requested, not evidence that eight is the best count or that ORT accounts for the whole runtime.

Production declares `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` in [`web/_headers`](../web/_headers). The development server uses `credentialless`, and [`coi-serviceworker.js`](../web/coi-serviceworker.js) is the fallback for hosts that do not set the headers.

### Live production result

A fresh Chromium visit to `https://webapps.neurodesk.org/musclemap/` on 2026-08-28 reached `crossOriginIsolated === true`, exposed `SharedArrayBuffer`, and reported eight logical processors. The service worker supplied the page isolation. Model-part download and SHA-256 verification completed in about nine seconds.

Session creation then stalled at 23%, "Loading ONNX model...". During `ort.InferenceSession.create()`, eight requests for `https://webapps.neurodesk.org/_runtime/ort-web/1.21.0/ort-wasm-simd-threaded.jsep.mjs` returned HTTP 200, but Chromium marked every response `net::ERR_BLOCKED_BY_RESPONSE`. The JSEP WASM file downloaded, yet the session did not initialize within 60 seconds.

This is the current deployment blocker. A successful page-level `crossOriginIsolated` check proves that shared memory is available to the existing inference worker. It does not prove that a new dedicated PThread worker can start. The HTML worker algorithm checks the new worker response's embedder policy against its owner's policy and converts an incompatible response into a network error. [HTML Standard worker processing](https://html.spec.whatwg.org/multipage/workers.html#worker-processing-model) [HTML Standard embedder-policy check](https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy)

The COI service worker lives at `/musclemap/coi-serviceworker.js`, so its default registration scope is `/musclemap/`. A service worker's scope defines the URLs that it can control, and the default is the directory that contains its script. [MDN service-worker scope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/scope) [MDN `register()` scope rules](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#parameters) ORT's PThread entry is under `/_runtime/`, outside that scope, and its origin response has no COEP, COOP, or CORP headers. Chromium receives the bytes with status 200, then rejects the worker during the embedder-policy check. That explains why the network panel shows both a successful HTTP response and `ERR_BLOCKED_BY_RESPONSE`.

## Thread controls in ORT Web 1.21 and 1.29

ONNX Runtime 1.29.0 is the current stable release as of this note. [ORT 1.29 release](https://github.com/microsoft/onnxruntime/releases/tag/v1.29.0)

| Control | ORT Web 1.21 | ORT Web 1.29 | MuscleMap action |
| --- | --- | --- | --- |
| `ort.env.wasm.numThreads` | Global count, including the calling thread. `1` disables worker threads. With no explicit value, an isolated browser uses half of `hardwareConcurrency`, capped at four. | Same behavior. | Benchmark explicit values. Do not use every reported logical processor without data. |
| `executionMode` | A WASM session accepts `sequential` or `parallel`; the default is `sequential`. | Same behavior. | Benchmark after choosing a thread count. The mostly sequential convolution graph may not benefit. |
| `intraOpNumThreads`, `interOpNumThreads` | The JavaScript type marks both as Node.js and React Native only. | Still not browser controls. | Do not add them to browser session options. |
| `ort.env.wasm.proxy` | Optional main-page-to-worker proxy, disabled by default. | Same public control. | Keep it off because MuscleMap already owns a worker. |
| `ort.env.wasm.simd` | The distributed build requires fixed-width SIMD. | Accepts fixed or relaxed SIMD feature detection. The flag does not select a matching binary. | Keep the distributed fixed-SIMD artifact until a separate runtime build proves a gain. |

The default thread policy is unchanged between [ORT 1.21](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/web/lib/backend-wasm.ts#L36-L55) and [ORT 1.29](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/web/lib/backend-wasm.ts#L37-L56). `navigator.hardwareConcurrency` is an estimate of available logical processors, and browsers may report a lower value. It is not a performance recommendation for one workload. [MDN `hardwareConcurrency`](https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/hardwareConcurrency)

Both releases expose `executionMode` to WASM, while their per-session intra-op and inter-op counts remain limited to Node.js and React Native. [ORT 1.21 session options](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/common/lib/inference-session.ts#L57-L104) [ORT 1.29 session options](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/common/lib/inference-session.ts#L58-L105)

ORT 1.29 extends `env.wasm.simd` with relaxed-SIMD detection, but its contract says that the flag does not switch runtimes. The application must also supply the corresponding WASM binary. [ORT 1.29 SIMD contract](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/common/lib/env.ts#L47-L63) This is not a low-risk one-line optimization for the current vendored runtime.

## Cross-origin isolation is a release requirement

Browser shared memory requires a secure context and cross-origin isolation. A document becomes isolated with `Cross-Origin-Opener-Policy: same-origin` plus either `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`, unless `Permissions-Policy: cross-origin-isolated` blocks it. The application can verify the result through `self.crossOriginIsolated` inside the inference worker. [MDN `WorkerGlobalScope.crossOriginIsolated`](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated) [MDN `SharedArrayBuffer` security requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)

If isolation is unavailable, ORT changes a requested count greater than one to one and logs a warning. [ORT 1.21 capability check](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/web/lib/wasm/wasm-factory.ts#L89-L109) MuscleMap currently logs the requested count before ORT initializes, so the UI can claim eight threads even when ORT later falls back. A release smoke test must check `self.crossOriginIsolated === true` on the deployed URL and record the post-initialization value.

The live production failure adds a second requirement. Every dedicated worker that participates in the isolated agent cluster needs a compatible embedder policy. If the worker's policy is incompatible with its owner's policy, the browser reports a worker-initialization COEP violation and turns the response into a network error. [HTML Standard embedder-policy check](https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy) The release smoke test must therefore create an actual multithreaded ORT session. Checking only `crossOriginIsolated` and `SharedArrayBuffer` misses this failure.

`require-corp` can block cross-origin scripts, models, images, or embedded content unless those responses opt in through CORP or CORS. `credentialless` instead omits credentials for cross-origin `no-cors` requests. [MDN COEP directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy) Test the real release host, embedded deployments, model downloads, and the current jsDelivr `localforage` import under the production headers.

### Deployment fix options

| Fix | Result | Tradeoff | Recommendation |
| --- | --- | --- | --- |
| Add origin headers to `/_runtime/*` | The shared `.mjs` worker response carries a COEP policy compatible with its isolated owner. `Cross-Origin-Resource-Policy: same-origin` also makes the same-origin sharing intent explicit. The hosting layer can apply the same COOP and COEP policy used by the app where appropriate. | Requires a deployment or CDN-header change and cache invalidation. Every app can continue using one checksummed runtime store. | Preferred. It fixes the shared runtime once for MuscleMap and other threaded apps. |
| Keep ORT worker assets under `/musclemap/` | The COI service worker can control the worker URL and add the isolation headers, as it already does for app-scoped responses. | Duplicates ORT assets across apps and bypasses the shared `/_runtime/` store. The assembled site must stop removing or rewriting this app's ORT copies. | Good fallback when the host cannot set headers on `/_runtime/*`. Also matches the standalone release layout. |
| Force `ort.env.wasm.numThreads = 1` | ORT does not create PThread workers, so it avoids the blocked worker initialization path. | Disables CPU parallelism and can make inference slower. It hides the header defect, and page isolation alone cannot decide when to remove it. | Temporary unblock only. Remove it after a real multithreaded session smoke test passes. |

For the shared-runtime fix, the worker entry itself needs `Cross-Origin-Embedder-Policy: require-corp` or `credentialless` so its policy is compatible with the isolated owner. [HTML Standard embedder-policy check](https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy) Keep `Cross-Origin-Opener-Policy: same-origin` on application documents. Serve shared same-origin runtime assets with `Cross-Origin-Resource-Policy: same-origin` to state that only this origin may embed them. [MDN CORP directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy#directives)

## Proxy workers do not help this architecture

ORT documents `env.wasm.proxy` as a UI-responsiveness feature, not a model-speed feature. The proxy cannot work with the JSEP WebGPU path because GPU buffers are not transferable, and a restrictive Content Security Policy can block its Blob worker. [ORT environment flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmproxy)

ORT also enables its proxy only when `document` exists. [`inference-worker.js`](../web/js/inference-worker.js) runs in a dedicated worker where `document` is absent, so setting `env.wasm.proxy = true` there has no effect. [ORT 1.29 proxy condition](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/web/lib/wasm/proxy-wrapper.ts#L21-L22) MuscleMap's existing worker is the correct UI-isolation layer. ORT's PThread workers remain available underneath it when cross-origin isolation succeeds.

## SIMD, JSEP, and WebGPU are separate choices

The current CPU artifact already combines fixed-width SIMD and threads. ORT's deployment guide identifies `ort-wasm-simd-threaded.wasm` as the CPU artifact and the `.jsep.wasm` variant as the build that powers WebGPU and WebNN in the existing JSEP architecture. [ORT Web deployment artifacts](https://onnxruntime.ai/docs/tutorials/web/deploy.html#webassembly-binaries)

WebGPU is a different execution provider, not a newer WASM thread mode. MuscleMap imports the module-worker `ort.webgpu.bundle.min.mjs`, detects `navigator.gpu`, and creates sessions with `['webgpu', 'wasm']`. The fallback lets unsupported nodes run on WASM, where `numThreads` still matters. ORT recommends WebGPU for compute-intensive models and WASM for smaller models or devices without suitable GPU support. [ORT WebGPU guide](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

ORT 1.29 deprecates JSEP and recommends its native WebGPU execution provider. [ORT 1.29 release notice](https://github.com/microsoft/onnxruntime/releases/tag/v1.29.0#user-content-announcements--breaking-changes) In that release, the `./webgpu` build uses the native WebGPU EP with `.asyncify.wasm`, while the default JSEP build uses `.jsep.wasm`. ORT has scheduled only the deprecation phase, and it lists proxy, I/O binding, global settings, profiling, and build-parity gaps that must close before the default changes. [ORT's JSEP-to-native-WebGPU design](https://github.com/microsoft/onnxruntime/blob/v1.29.0/docs/design/onnxruntime_web_jsep_to_webgpu_ep_migration.md#1-summary)

For MuscleMap, 1.29 is not a drop-in asset replacement. Its JavaScript bundle and WASM binary must come from the same build, and ORT warns that mismatched minimized symbols fail initialization. [ORT `wasmPaths` requirement](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmwasmpaths) The upgrade also needs full segmentation parity because it changes WebGPU implementation and operator coverage.

Graph capture is not the first optimization to attempt. ORT limits it to static shapes whose kernels all run on WebGPU. [ORT graph-capture requirements](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#enablegraphcapture) [`inferSliceLogits()`](../web/js/inference-worker.js) sizes the input with `batchTiles.length`, so the final batch can have a different shape. A graph-capture experiment would first need fixed dimensions and padded final batches, then parity and memory testing.

I/O binding can avoid CPU-to-GPU or GPU-to-CPU copies only while tensors remain on the GPU. [ORT WebGPU I/O binding](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html#keep-tensor-data-on-gpu-io-binding) MuscleMap reads each output tensor in JavaScript to blend logits and select labels, so the current pipeline requires a CPU-visible output after every tile batch. Redesign that accumulation before expecting I/O binding to help.

## Expected performance and memory tradeoffs

WebAssembly threads share one linear memory across workers, so ORT does not need one full model heap per thread. Shared WASM memory uses a `SharedArrayBuffer`. [MDN WebAssembly threads](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Understanding_the_text_format#webassembly-threads) Each extra ORT thread still creates another worker with stack and runtime state, and it adds scheduling and synchronization work. ORT's source confirms that the pool has `numThreads - 1` workers. [ORT 1.29 factory](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/web/lib/wasm/wasm-factory.ts#L183-L192)

More threads help only the parallel part of `session.run()`. They cannot shorten the serial JavaScript phases, and gains can flatten when kernels become limited by memory bandwidth or when the browser schedules other work. This is why end-to-end speedup must be measured instead of inferred from core count. The extra workers also operate inside WASM32's 4 GiB address-space limit, which includes model weights, activations, and runtime allocations. [ORT Web large-model memory limit](https://onnxruntime.ai/docs/tutorials/web/large-models.html#webassembly-memory-limit)

Running another preprocessing worker pool alongside an eight-thread ORT pool can oversubscribe the CPU. If profiling later justifies moving resampling or cleanup into threaded WASM, use one shared concurrency budget across preprocessing and inference.

## Benchmark plan

Build a repeatable browser benchmark around the existing controlled cases in [`upstream-reference-cases.json`](../model-sources/upstream-reference-cases.json). A fresh inference worker is required for every configuration because ORT reads global WASM flags before the first session.

1. Add test-only timing around worker initialization, model download and verification, session creation, JavaScript preprocessing, tile creation, each `session.run()`, logit blending, inverse transforms, cleanup, and metrics. Record `crossOriginIsolated`, `hardwareConcurrency`, the requested and effective thread counts, ORT version, execution provider, model digest, browser version, and device class.
2. Run an ORT-only screen with the three deterministic patches already used by `validate_browser_model.mjs`. Compare ORT 1.21.0 and 1.29.0 at `1`, `2`, `4`, and `min(8, hardwareConcurrency)` threads. Use one warm-up and at least ten measured runs per cell. Compare `executionMode: 'sequential'` and `'parallel'` only after selecting the best thread counts.
3. Run the complete `vhp-neck`, `vhp-pelvis`, and `s0175_mri` pipelines. Preserve each case's overlap, source-chunk size, model bytes, and browser settings. Use one cold run and three warm runs per cell. The neck tests a common station, the pelvis tests memory-safe small chunks, and `s0175_mri` tests a larger living-subject volume.
4. Record median and p95 wall time, summed `session.run()` time, preprocessing and postprocessing time, peak JavaScript and WASM memory where the browser exposes it, session-creation time, worker count, crashes, and output fidelity. Keep the existing affine, overall-agreement, foreground-Dice, and per-label-Dice gates unchanged.
5. Repeat the winning WASM configurations on at least one four-core laptop, one eight-core desktop, and one higher-core desktop. Run Chrome or Edge, Firefox, and Safari where available. Test a low-memory device separately because the output logits and accumulators, not only the model, set the peak.
6. Benchmark ORT 1.29 native WebGPU as a separate matrix. Compare cold and warm time, GPU memory failures, operator fallback, and the same output-fidelity gates. Do not mix this result into the CPU thread-count decision.

Adopt a new automatic thread cap only if it improves median end-to-end time by at least 10% on two device classes, does not regress p95 by more than 5%, stays within the current memory/crash budget, and passes every segmentation gate. Store the raw JSON results with runtime and model hashes so the test can be repeated after browser or ORT updates.

## Low-risk implementation order

1. Add compatible response headers to the shared `/_runtime/ort-web/1.21.0/` worker assets. If that deployment change is unavailable, keep MuscleMap's ORT assets under `/musclemap/`. Use `numThreads = 1` only as a time-limited release fallback.
2. Add a release-host smoke test that creates a real session with `numThreads > 1` and completes one inference. Assert that the worker is isolated and fail on `ERR_BLOCKED_BY_RESPONSE`, session-init timeout, or a fallback to one thread.
3. Report the effective runtime state. Log `self.crossOriginIsolated`, `navigator.hardwareConcurrency`, requested threads, effective threads after initialization, ORT version, and the selected provider.
4. Make the benchmark accept a test-only thread count and `executionMode`. Keep release behavior unchanged until results exist.
5. If no device matrix is available yet, use ORT's automatic policy rather than all logical processors: `Math.min(4, Math.ceil(hardwareConcurrency / 2))` when isolated and `1` otherwise. ORT uses this policy in both 1.21 and 1.29.
6. Keep `env.wasm.proxy` disabled. MuscleMap already isolates the full pipeline in its own worker.
7. Upgrade ORT in one atomic change that vendors a matched JavaScript bundle and WASM artifacts, updates the shared runtime manifest and checksums, and runs unit, browser-model, full-volume parity, WebGPU, and release-host isolation checks.
8. Prefer the 1.29 native WebGPU build as an experiment, not as an automatic replacement for the validated 1.21 JSEP path. Keep WASM fallback until the device and fidelity matrix passes.
9. Consider custom threaded WASM for resampling or cleanup only if phase timing shows that serial JavaScript dominates after ORT tuning. That is a larger implementation and should follow the low-risk measurements above.
