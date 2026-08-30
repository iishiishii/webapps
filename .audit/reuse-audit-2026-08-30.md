# Webapps reuse & consistency audit — 2026-08-30

Goal audited: multiple webapps with a consistent interface and functionality, reusing as many
components as possible so a bugfix in one app benefits the others.

Verdict: the **infrastructure** for this goal is largely built and working (registry-driven CI,
composite theming, scaffold, parity-test discipline), but the **shared library is written and not
consumed** — most of `packages/components` has zero app consumers while 5–6 apps ship private
forks of exactly that code, and several real bugfixes have already failed to propagate.

---

## 1. What is working well (keep doing this)

- `registry/apps.yml` + `scripts/lib/apps-registry.mjs` genuinely drive CI (`scripts/app-plan.mjs`,
  `.github/workflows/ci.yml`/`release.yml` have no hardcoded app lists except one) and composite
  assembly (`scripts/build-site.mjs` iterates the registry).
- The composite-site app bar is uniform across all 14 apps and enforced by
  `test/composite-site.smoke.mjs` (exactly one theme link/shell script/GA4 loader, nav reads
  `About Cite Privacy Light More Apps GitHub`).
- `packages/runtime-support` (COI service worker) adoption is essentially complete for the static
  apps; `packages/analytics` reaches all 14 apps via the build layer by design.
- Parity-test discipline exists and is real: `test-utils/ui-parity.mjs`, per-app
  `shared-components-parity.test.js`, frozen `*.original.js` fixtures.
- `scripts/new-app.mjs` + `templates/app-template` scaffold with a CI generator-contract job.

## 2. The core finding: extraction happened, re-import didn't

Only **5 of 12** `packages/components` subpaths are consumed by any app, and the two adopter
groups are **disjoint**:

- Vite/imaging-workspace apps (browserqc, deface, niimath, surfannotate, zarro) use only
  `core/mount-imaging-workspace` + `styles/base.css` — nothing else.
- Static-html apps (calmar, musclemap, spinalcordtoolbox, vesselboost) use only `ui/*` and
  `file-io/*` helpers — never the workspace shell or base.css.

Zero-consumer shared modules (each with live app-local forks): `viewer/ViewerController` (6 forks),
`inference/PipelineExecutor` + `workerProtocol` (5 forks), all of `volume/*` except
`computeAutoWindow`, all of `pipeline/*`, all `plugins/*`, `mask/MaskState`, the bucketed
`FileIOController`, all 13 `NiftiUtils` exports, and the flagship `core/createNeuroWebapp` (a third
shell design no app uses, still documented as *the* shell in `packages/components/docs`).

Ironies worth noting:
- qsmbly is documented as the **origin** of `EchoNavigator`, `CommandPreview`, bucketed
  `FileIOController`, and the mask ops (`packages/components/docs/components/source-map.md`) — the
  code was extracted upward and never re-imported; qsmbly has no vendor script or import map, so its
  declared dependency can never resolve. Same for seedseg.
- `apps/musclemap/scripts/generate_model_contracts.mjs` generates and CI-verifies
  `packages/components/src/plugins/musclemap/index.js` — which no runtime code loads.
- qsmbly and seedseg import `DicompareReportRenderer` **over HTTPS from dicompare.neurodesk.org**
  (`apps/qsmbly/js/qsm-app-romeo.js:21`, `apps/seedseg/web/js/seedseg-app.js:10`) while a local
  shared copy exists in the workspace.
- dicompare declares `@neurodesk/webapp-components` as a dependency and uses none of it.

## 3. Bugfixes that already failed to propagate (fix now)

These are direct instances of the failure mode the goal is meant to prevent:

1. **Truncated-model cache poisoning** — `fetchModel` retry with `cache: 'reload'`, size guard, and
   `localforage` purge exists in calmar + spinalcordtoolbox workers; **absent in musclemap,
   vesselboost, seedseg**, which can cache a truncated ONNX model forever.
2. **`cal_max` mis-windowing** — calmar/sct set `cal_max` from the actual label max in
   `createOutputNifti`; musclemap/vesselboost/seedseg hardcode `1`, mis-windowing multi-label masks.
3. **dcm2niix hang** — `apps/browserqc/src/dcm2niix/index.ts:75-88` wraps `init()`/`run()` in
   `withTimeout` because a failed WASM fetch never settles and wedges the queue;
   `apps/deface/src/dcm2niix/index.ts:75-76` is the unpatched copy and still hangs.
4. **Progress clamping** — shared `ProgressManager.setProgress` clamps to [0,1]; seedseg's
   byte-identical-to-pre-extraction fork does not. seedseg/qsmbly UI modules are byte-identical (md5)
   to the frozen `*.original.js` parity fixtures the other four apps migrated away from.
5. **qsmbly guided tour unreachable on the hosted site** — `#openGuide` (its only trigger,
   `apps/qsmbly/index.html:175`) lives in `.app-header`, which the shell blanks via
   `[data-neurodesk-top-bar-host] > :not(.nd-app-bar){display:none!important}`; only
   `#tutorialBtn, #resetAll` are rescued (`site/app-shell.js:160`).
6. **dicompare dark-mode desync** — its own `ThemeContext` (`.dark` class, 457 `dark:` utilities)
   is not wired to `site/theme.js`'s `data-neurodesk-theme` / `neurodesk-theme-change` event, and its
   toggle lives in the header the shell replaces, so the Tailwind dark variants freeze at load state.

## 4. Duplication inventory (prioritized extraction candidates)

- **P0 — Worker imaging toolkit** (5 near-identical `inference-worker.js`; up to 100% identical
  functions; ~600–900 dup lines/app). Blocker: musclemap/vesselboost/sct/seedseg are *classic*
  workers (`importScripts`); calmar already runs a module worker and is the migration template.
  Most functions already have homes in `volume/*` and `file-io/NiftiUtils`; new home needed only for
  message plumbing + `fetchModel` + `getOptimalWasmThreads` (`packages/components/src/worker/`).
- **P1 — `InferenceExecutor`** (5 copies; vb/calmar/sct share a 100%-identical checkpoint/abort
  state machine, ~480/518 identical lines). `PipelineExecutor.js` exists unused.
- **P2 — Step-pipeline UI state machine** vesselboost ↔ spinalcordtoolbox (~20 byte-identical
  functions in the two ~2000-line app files).
- **P3 — Viewer window/contrast control bindings** (4 copies, 93–99% identical, incl. 74-line
  `setupWindowControls`).
- **P4 — `createNiftiFromVolume` / `saveScreenshot` / `downloadCurrentVolume`** (5 copies each) —
  already exported by `NiftiUtils.js` / `download.js`; pure delete-and-import.
- **P5 — `ViewerController`** (6 forks, more diverged; sct's injectable `niivueFactory` is the
  keeper design).
- **P6 — seedseg/qsmbly UI modules** — import-rewiring only; deps already declared, back-compat
  shims already in the shared versions.
- **P7 — CSS**: six apps copy the identical 34-token `:root` block plus ~60 selectors present in
  all six; `base.css` covers 101 selectors and is imported only by the *other* five apps; the two
  token namespaces (`--color-*` vs `--nd-color-*`) name the same roles.
- **P8 — browserqc ↔ deface**: 220 matching lines in main.ts, deface's CSS 82% a subset,
  8 byte-identical tracked `src/niimath/` files.
- **P9 — Tracked vendored wrappers**: `dcm2niix/{index,worker,dcm2niix}.js` + `nifti-js/index.js`
  byte-identical in 6 apps; belongs in `packages/runtime-support` emitted by
  `scripts/vendor-runtime-support.mjs`.
- **P10 — Six independent NIfTI writer implementations** (browserqc, calmar, deface, dicom2vid,
  easy-mp2rage, zarro) — mostly legitimately different, but `qformAffine` + gunzip are unifiable.
- **P11** — `connected-components.js` (musclemap ↔ seedseg 94/98 lines match while the shared
  version has drifted from both), `DicomController` (calmar/sct/vesselboost reduced theirs to 7-line
  shims; musclemap/seedseg/qsmbly have not), dicompare-embed wiring (59-line `runDicompareReport`
  100% identical in seedseg + qsmbly), drop-zone logic in 9 apps / 4 idioms while
  `filesFromDataTransferItems` already solves the hard part.

Intentionally app-local (leave alone): musclemap IMF/Dixon metrics, qsmbly phase
unwrapping/background-field removal, surfannotate surface algorithms, zarro zarr/mosaic/stain stack,
deface mindgrab, sct totalspineseg/vertebrae/lesion modules, calmar registration/parcel modules,
dicompare Pyodide/React, per-app `stepInference` bodies.

## 5. UI consistency findings

- The registry `shell:` field is **decorative** — validated and asserted in `test/navigation.test.mjs`
  but never branched on by `build-site.mjs`; per-shell divergence is instead hardcoded as app-ID
  branches in `site/app-shell.js:171-190` and app-ID CSS blocks in `site/app-theme.css`
  (~130 surfannotate-specific lines).
- Three header contracts coexist: the injected `.nd-app-bar` (composite only), the
  `mountImagingWorkspace` header (More Apps only — no About/Cite/Privacy/version), and the
  static-html house header (five controls). `createNeuroWebapp` is a dead fourth.
- Only zarro themes its **standalone** build (`theme-app-dist.mjs` in its build script); the other
  13 standalone builds/previews show unbranded legacy chrome.
- Help/tutorial affordances handled five different ways (qsmbly Guide broken, niimath Help has no
  shell slot, dicom2vid/easy-mp2rage rescued by hardcode, dicompare TutorialContext).
- Copy divergence: five different privacy sentences (sct's mentions "telemetry" and contradicts the
  shell's privacy copy); `Cite` vs `Citations`; five `<title>` conventions none derived from the
  registry; `MRI2Vid` vs registry `DICOM2Vid`; `SpinalCordToolbox` vs `Spinal Cord Toolbox` vs path
  `sct`.
- File input: four patterns + three apps with drag-drop only and no visible input; `accept`
  attributes inconsistent (`.nii,.gz` … none).
- `<meta description>` in 3/14; no og/Twitter cards; favicon missing in 6/14 — all derivable from
  the registry.
- Modal semantics split three ways; six apps' `.modal-overlay` divs have no `role="dialog"`,
  `aria-modal`, or Escape handling (and shared `ModalManager` has none either). No `<h1>` in five
  apps. Zero `@media` queries in browserqc/deface/niimath. `theme.js` ignores
  `prefers-color-scheme` (dark unconditionally).
- The app bar carries no Neurodesk logo (landing page does).

## 6. Build/test/CI findings

- Two build paths chosen by each app's `package.json` script, not the registry; Vite `base` is
  hardcoded per app though the registry knows `app.path`; zarro re-implements dev theme injection
  locally and is double-themed (own build + release.yml).
- `apps/*/web/{run,setup}.sh`: 10 near-duplicate files, all different md5s — divergent cache
  headers, one server missing COOP/COEP entirely (seedseg), 5 copies of the same ORT 1.21.0 download
  loop that `runtime-assets/manifest.json` already pins by checksum.
- `_headers` copy-pasted in 5 places with `require-corp` while `build-site.mjs` writes
  `credentialless` at the root — dead weight in composite, silent divergence standalone.
- Three browser-test harness styles: shared `test-utils/playwright-static-app.mjs` (3 apps),
  hand-rolled configs (musclemap's is a literal copy of what the helper produces), raw playwright +
  hand-written vite-preview spawn (browserqc/deface ~90% identical smoke.mjs). Runners fragmented:
  node --test / jest / vitest / cargo test.
- Test holes: browserqc, deface, niimath, dicompare have no meaningful unit tests (niimath's
  `test` is a syntax check); deface's WebGPU e2e suite **never runs** (`shared_runtime: false`
  gates e2e); dicom2vid's browser smoke has no npm script; seedseg consumes the shared runtime but
  is excluded from the shared-runtime e2e gate.
- Composite checks (`test:smoke`, `audit:artifacts`, runtime-assets test) skipped on app-scoped PRs.
- Hardcoded app lists: `release.yml` `matrix.app == 'musclemap'` (cemented by
  `test/release-workflow.test.mjs`), `test/runtime-assets.test.mjs` 5-app worker list,
  `test/source-links.test.mjs` 14-entry repo map duplicating registry `source`,
  `site/app-shell.js` 4 branches, `site/app-theme.css` 3 app selectors, musclemap/qsmbly special
  cases in the shared smoke servers.
- `scripts/new-app.mjs` appends raw YAML (can emit an invalid registry) and always scaffolds
  `react-vite`/`imaging-workspace`/`data-preparation` regardless of intent.

## 7. Recommended roadmap (by leverage ÷ cost)

**Wave 1 — propagate the lost bugfixes + free wins (import rewiring only)**
1. Port the deface dcm2niix `withTimeout` fix; fold `fetchModel` hardening and the `cal_max` fix
   into every worker (or at least copy them across now, ahead of extraction).
2. Rescue `#openGuide` in `site/app-shell.js` (and make the rescue list a per-app declaration).
3. Wire dicompare's ThemeContext to `neurodesk-theme-change`.
4. seedseg + qsmbly: add vendor script + import map, replace forked UI modules with shared ones
   (P6); reduce their `DicomController` to the 7-line shim the other three apps use.
5. Replace the 5 `createNiftiFromVolume`/download-helper copies with imports (P4).
6. Replace the HTTPS dicompare-embed import with the workspace module; drop dicompare's unused dep.

**Wave 2 — make the registry actually drive things**
7. Split `ci.shared_runtime` into runtime-consumption vs browser-test flags; matrix e2e on the
   latter (fixes deface/dicom2vid/seedseg gaps).
8. Replace the musclemap hardcode in release.yml with a registry-derived field; derive the
   runtime-assets worker list and source-links map from the registry.
9. Make `build-site.mjs`/`app-shell.js` dispatch on `shell:` (or per-app adapter modules under
   `site/shells/`), moving the app-ID branches and CSS overrides into data.
10. Shared Vite helper (`neurodeskViteConfig({ appId })`) deriving `base` from `app.path`, COOP/COEP
    dev headers, worker format; `_headers` generated from one constant in both builders.
11. `new-app.mjs` writes through the registry loader; takes `--runtime/--shell/--category`.
12. Normalize `<title>`, meta description, favicon from the registry in `injectCompositeTheme`;
    theme all standalone builds the way zarro does (via the shared script, not per-app).

**Wave 3 — the big extractions (behind parity tests, per existing policy)**
13. Migrate the 4 classic workers to `type: 'module'` (calmar is the template), then collapse the
    worker toolkit (P0) and `InferenceExecutor` (P1) into `packages/components`, folding in the
    Wave-1 fixes so all five apps inherit them permanently.
14. vesselboost/sct step-pipeline state machine (P2), window/contrast bindings (P3).
15. Move tracked `dcm2niix`/`nifti-js` wrappers into `packages/runtime-support` (P9); replace
    `run.sh`/`setup.sh` with `scripts/dev-server.mjs` + manifest-driven ORT fetch.
16. Unify the test harness: `vite-preview-smoke` helper for browserqc/deface/dicom2vid;
    `staticAppPlaywrightConfig` for musclemap; converge on node --test where practical.
17. CSS: promote the shared 34-token block + ~60 common selectors into `styles/base.css` (or a
    second `pipeline.css` layer) and reconcile the two token namespaces; then `ViewerController`
    (P5) with sct's injectable factory design.

**Wave 4 — guardrails so drift can't recur**
18. Add a "fork ratchet" test: an explicit allowlist of app-local files that shadow
    `packages/components` modules; CI fails when a new shadow appears, and the list only shrinks.
19. Generate an adoption matrix (app × shared module, from real imports) into docs on every build so
    dead exports and stalled migrations are visible.
20. Delete-or-adopt the dead surface: `createNeuroWebapp` (+ its two transitively-dead UI renderers),
    unused plugin descriptors, `mask/MaskState`, or wire them into the template/app that motivated
    them — and fix the docs that still present them as the shared shell.
21. Converge on one header contract (About/Cite/Privacy/version/theme/GitHub) for both
    `mountImagingWorkspace` and the static-html house header; one canonical privacy sentence; one
    shared drop-zone component with a standard `accept` policy.
22. Run composite checks (`audit:artifacts`, runtime-assets test) on app-scoped PRs; add minimal
    behavioral tests for browserqc/deface/niimath/dicompare (registry-level `ci.test_kind` so the
    gap is visible).

---

## Implementation status (2026-08-30, same day)

Landed in the working tree (uncommitted), all verified green:

**Wave 1 — done.** fetchModel hardening + `cal_max` fix in musclemap/vesselboost/seedseg
workers; deface dcm2niix `withTimeout`; qsmbly `#openGuide`/`#appLogo` rescued via a per-app
`utilityControls` map in `site/app-shell.js`; dicompare `ThemeContext` follows the shared
controller; seedseg + qsmbly vendored + import-mapped, forked UI modules deleted,
`DicomController` reduced to shims; musclemap/vesselboost `downloadBlob`/`downloadArrayBuffer`
from shared; unused dicompare dep removed; full embed `DicompareReportRenderer` ported into
`packages/components` (parity-tested) and seedseg/qsmbly now import it from the workspace
instead of over HTTPS. Skipped on evidence: `createNiftiFromVolume` swap — the shared version
forces Float32 while apps preserve source datatype (library gap, Wave 3).

**Wave 2 — done.** `ci.browser_test` split from `ci.shared_runtime` (deface e2e now runs,
dicom2vid e2e wired, qsmbly/seedseg reclassified as runtime-store consumers, Vite apps
declassified); release.yml gated on registry-derived `app_scoped_runtime`/`browser_test`;
`test/source-links` and `test/runtime-assets` derive app lists from the registry; composite
checks run on any app-affecting PR; `scripts/lib/vite-app-config.mjs` (base from registry,
COOP/COEP, single `credentialless` `_headers` source — 4 per-app copies deleted; musclemap's
is overridden at build); `new-app.mjs` validates through the loader and takes
`--runtime/--shell/--category` (+ hermetic test); head metadata (title/description/og/favicon)
normalized from the registry; `scripts/dev-server.mjs` + `scripts/fetch-app-runtime.mjs`
replace the 10 divergent run.sh/setup.sh (kept as thin wrappers; seedseg's server now sends
COOP/COEP); one canonical privacy sentence, "Cite" label, "Spinal Cord Toolbox" branding,
About + more-apps controls across the six static apps.

**Wave 3 — done in part.** Test-harness unification: `test-utils/playwright-vite-preview.mjs`
and `test-utils/vite-preview-smoke.mjs`; musclemap/zarro/surfannotate configs and
browserqc/deface smokes on shared helpers; deface gained the GPU-less fallback path.
NOT done (needs parity-gated extraction work): module-worker migration + worker toolkit /
`InferenceExecutor` collapse (P0/P1), vesselboost↔sct step state machine (P2), window
controls (P3), `ViewerController` (P5), CSS token unification (P7), tracked dcm2niix/nifti-js
wrappers into runtime-support (P9), `shell:`-dispatched adapters replacing app-ID branches.

**Wave 4 — done.** `test/component-forks.test.mjs` fork ratchet (35-entry shrink-only
allowlist) and `scripts/report-component-adoption.mjs` → `docs/architecture/component-adoption.md`
(12/14 apps now consume the shared library; easy-mp2rage and dicom2vid remain).

**Reverted deliberately:** OS `prefers-color-scheme` fallback in `site/theme.js` — the
composite smoke pins dark-by-default as the product contract; changing that is a decision,
not a fix.

**Verification:** root unit tests 70/70; composite `build:site` + `audit:artifacts` +
`runtime-assets` + `test:smoke` pass for all 14 apps; every touched app's own suite green
(calmar, sct incl. release gate, musclemap 31/31, vesselboost, seedseg, qsmbly 77/77,
dicompare, browserqc/deface e2e via fallback, zarro 8/8, surfannotate 58/58).
`pnpm --filter qsmbly build` and easy-mp2rage/dicom2vid turbo tests fail only for missing
wasm-pack/numpy on this machine (pre-existing, environmental).
