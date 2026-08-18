# TODOS

## LLM Pipeline: Add niivue as a viewer option for NIfTI apps
**Priority:** P3 (follow-up)
**What:** When `imagingModality` is `nifti`, the LLM pipeline system prompt should
reference niivue as the viewer library. Generated apps could import niivue directly
for 3D volume rendering, overlays, and colormaps.
**Why:** niivue is the standard browser-based NIfTI viewer used by the neuroimaging
community (also used by freesurfer/freebrowse). Richer than the current shared
ViewerController for imaging-heavy apps.
**Cons:** Adds niivue as a dependency. May need reconciliation with existing
ViewerController in the shared component library.
**Context:** See freesurfer/freebrowse (React+Vite+niivue wrapper). The shared
component library has ViewerController but may not expose full niivue features.
Also consider dcm2niix for DICOM-to-NIfTI conversion in the pipeline.
**Depends on:** Core LLM pipeline must be working first.

## ViewerController consolidation (prerequisite for FreeBrowse migration)
**Priority:** P1 (blocking)
**What:** Merge the 6 app-local ViewerController forks into the shared
`packages/components/src/viewer/ViewerController.js`, adding stage visibility,
extensible colormap registration, and spatial assertions as first-class features.
**Why:** The 6 forks share ~80% of their code. Consolidating before migrating to
FreeBrowse means migrating one codebase instead of six (Beck: "make the change
easy, then make the easy change").
**Pros:** Reduces migration surface area 6:1. Establishes parity tests that carry
forward into the FreeBrowse migration.
**Cons:** Significant effort -- the 6 forks are more diverged than they appear.
QSMbly has multi-echo navigation, MuscleMap has uint8 preview downsampling with
`_withNiivueErrorCapture`, Calmar (409 lines) has stage replacement with index
remapping, SCT (430 lines) has comparison views with multiple NiiVue canvases
and WeakMap URL caching. The consolidated ViewerController must be a superset
with plugin hooks for app-specific features. Estimate: human ~1 week / CC ~2-3 hrs.
**Context:** calmar has `stageVisibility`/`stageOpacity` maps, vesselboost imports
`assertSameSpace`, musclemap has large-volume preview downsampling. The shared
version currently lacks all three. See `apps/*/web/js/controllers/ViewerController.js`
for the 6 forks.
**Depends on:** Nothing. Can start immediately.

## FreeBrowse embeddability spike -- COMPLETED 2026-08-10
**Priority:** P0 (was blocking)
**Result:** CONDITIONAL PASS -- embeddable at component level, but NiiVue version
conflict blocks immediate adoption.
**Detail:** See `spikes/freebrowse-embed/SPIKE-RESULTS.md` for full analysis.
**Key finding:** FreeBrowse uses `@niivue/niivue` 0.69.0 (WebGL2). Deface and
BrowserQC use 1.0.0-rc.9 (WebGPU variant with `NiiVueGPU`). These are incompatible
APIs. Cannot coexist in the same dependency tree without aliasing.
**Recommendation:** Fall back to extracting dicompare's NiivueViewer.tsx (uses
compatible 0.68.1, upgradeable to 1.0.0+). Cherry-pick FreeBrowse patterns
(drawing tools, NVD document model, viewer options hook) incrementally. Monitor
FreeBrowse upstream for NiiVue 1.0.0+ WebGPU upgrade.
**Context:** See https://github.com/freesurfer/freebrowse for upstream.
**Depends on:** Nothing. Should run BEFORE ViewerController consolidation to
validate the migration direction.

## Extract NiivueViewer.tsx into shared React viewer package
**Priority:** P1 (blocking -- spike fallback activated)
**What:** Extract `apps/dicompare/src/components/viewer/NiivueViewer.tsx` (540 lines)
into `packages/components/src/viewer/NiivueViewerReact.tsx` as the shared React
NiiVue viewer component. Add overlay/colormap/stage features from the consolidated
ViewerController. Cherry-pick FreeBrowse patterns incrementally:
  - Drawing tools (`use-drawing.ts`) for mask editing workflows
  - NVD document model for save/load state persistence
  - Viewer options hook (`use-viewer-options.ts`) for declarative NiiVue state sync
  - Surface/mesh support for future FreeSurfer integration
**Why:** FreeBrowse spike (2026-08-10) found a NiiVue version conflict blocking
wholesale adoption. NiivueViewer.tsx is already proven, in the monorepo, and uses
a compatible NiiVue version (^0.68.1, upgradeable to 1.0.0+).
**Pros:** Zero embeddability risk. Working today. FreeBrowse patterns adopted
incrementally as proven patterns rather than wholesale.
**Cons:** Requires building up features that FreeBrowse already has. More
incremental development effort.
**Context:** dicompare's NiivueViewer.tsx already handles: view modes, windowing,
DICOM conversion, crosshair toggle, screenshot, download, external control via
React props (`externalVolumeIndex`, `externalViewMode`, `onNiivueReady`).
**Depends on:** ViewerController consolidation (for overlay/colormap/stage features
to port into the React wrapper).

## Use FreeBrowse for new apps (LLM pipeline and manual scaffolding)
**Priority:** P2 (follow-up)
**What:** Target FreeBrowse as the viewer for all newly created apps. The LLM
pipeline (`scripts/generate-app.mjs`) and the app template (`templates/`) should
produce React+FreeBrowse apps by default. New apps get FreeBrowse's full feature
set (drawing tools, NVD document model, surface/mesh support, AI annotations)
from day one.
**Why:** New apps have no migration cost -- they start with FreeBrowse. Existing
apps keep working with their current viewer (ViewerController, NiivueViewer.tsx,
or NiiVue direct) and do NOT need to migrate.
**How:** Create `packages/freebrowse-viewer/` wrapping FreeBrowse as an embeddable
React component (spike confirmed this is feasible). Add a `react-freebrowse` app
template alongside the existing `app-template/`. Update the LLM pipeline's Step 2
system prompt and GeneratedApp schema to produce FreeBrowse-based React components.
**Cons:** FreeBrowse brings zustand, Radix UI, and Tailwind 4 as transitive deps.
FreeBrowse uses NiiVue 0.69.0 (WebGL2); new apps needing WebGPU must wait for
FreeBrowse to upgrade to 1.0.0+.
**Context:** FreeBrowse embeddability spike (2026-08-10) confirmed the `FreeBrowse`
component can render inside a host React app. See `spikes/freebrowse-embed/`.
**Depends on:** Nothing. Can start immediately.

## Migrate existing apps to FreeBrowse (OPTIONAL -- only when beneficial)
**Priority:** P3 (optional, per-app decision)
**What:** Existing apps do NOT need to migrate to FreeBrowse. They keep their
current viewer and only migrate if a specific app needs a FreeBrowse feature that
would be harder to build from scratch than to adopt. Likely candidates:
- **calmar** -- if it needs FreeBrowse's drawing tools for mask editing (currently
  has its own MaskDrawingController; FreeBrowse's is more complete).
- **dicompare** -- already React, already uses the shared NiivueViewer.tsx. Could
  swap to FreeBrowse for surface/mesh support if needed.

Apps that should NOT migrate unless there's a concrete reason:
- musclemap, vesselboost, spinalcordtoolbox, seedseg, qsmbly (vanilla JS -- full
  React rewrite required, no FreeBrowse feature justifies the cost)
- niimath (Vite, uses NiiVue directly -- works fine as-is)
- deface, browserqc (WebGPU 1.0.0-rc.9 -- incompatible with FreeBrowse's 0.69.0)

**Rule:** Migrate an existing app only when a FreeBrowse-specific feature is needed
AND the migration cost is less than building the feature on the current viewer.
**Depends on:** Per-app decision. No blanket migration.

## Replace NiivueViewer.tsx with FreeBrowse (deferred -- blocked on NiiVue version)
**Priority:** P3 (future)
**What:** Once FreeBrowse upgrades to `@niivue/niivue` 1.0.0+ (WebGPU), replace
`packages/components/src/viewer/NiivueViewer.tsx` with FreeBrowse's viewer as the
shared React viewer export. This unifies new and existing React apps on one viewer.
Until then, NiivueViewer.tsx and FreeBrowse coexist: NiivueViewer for existing
apps, FreeBrowse for new apps.
**Monitor:** https://github.com/freesurfer/freebrowse -- watch for `@niivue/niivue`
version bump in `frontend/package.json`.
**Depends on:** FreeBrowse upstream NiiVue 1.0.0+ upgrade.

## Update LLM pipeline to generate React+FreeBrowse apps
**Priority:** P2 (follow-up)
**What:** Modify the LLM pipeline design to target React+Vite+FreeBrowse for
generated apps. Update the AppPlan schema's `viewerType` to map to FreeBrowse
viewer modes. Add a react-vite app template to `templates/`. Update Step 2's
system prompt to generate React components instead of vanilla JS.
**Why:** The pipeline should target the architecture being migrated toward, not
the one being migrated away from.
**Pros:** Generated apps are born into the target architecture. No migration debt.
**Cons:** Pipeline implementation depends on FreeBrowse package being defined.
More complex code generation (React components vs vanilla JS).
**Context:** The current design doc's Next Steps assume vanilla JS output. The
AppPlan schema, GeneratedApp schema, and file manifest all need updating. The
`react-vite` runtime exists in `registry/apps.yml` (dicompare uses it).
**Depends on:** FreeBrowse integration package must be defined first.

## Adopt ASTRA spec for scientific workflow documentation and LLM pipeline output
**Priority:** P2 (follow-up)
**What:** Integrate the ASTRA spec (Agentic Schema for Transparent Research Analysis)
to formally describe each webapp's scientific workflow. Three integration points:

1. **LLM pipeline: generate `astra.yaml` alongside app code.** Each generated app
   gets an ASTRA document that captures its inputs (NIfTI/DICOM), outputs
   (segmentation masks, metrics, overlays), decisions (model choice, preprocessing,
   threshold), and recipes. The AppPlan Zod schema maps directly to ASTRA's
   Analysis structure. Use ASTRA's generated TypeScript types for cross-validation
   alongside Zod.

2. **Existing apps: write `astra.yaml` for CALMaR, MuscleMap, deface.** CALMaR is
   the strongest candidate -- it already has explicit decisions (atlas choice, lesion
   model, threshold), multi-step pipeline stages, and formal input/output contracts.
   CALMaR's Yeo7 vs Schaefer400 atlas choice is exactly ASTRA's multiverse concept.

3. **Contribute browser runtime extension upstream.** ASTRA's Recipe assumes POSIX
   shell commands (`python src/train.py`). Browser-native apps need a `runtime`
   field for WASM/WebGPU/ONNX-Web/Web Worker execution contexts, a `worker` field
   pointing to the worker script, and a `model_manifest` field for HuggingFace model
   references. Propose this as a PR to `LightconeResearch/astra-spec` with example
   ASTRA documents from the neuroimaging webapps as reference implementations.

**Why:** ASTRA makes each app's scientific workflow auditable, reproducible, and
composable. Researchers can inspect exactly which decisions shaped an output and
trace claims to evidence. The LLM pipeline benefits from a standardized analysis
schema that is richer than the current ad-hoc AppPlan.
**Pros:** Formal auditability for scientific apps. Multiverse analysis support
(run the same app with different decision combinations). Cross-project composability
(one app's outputs become another's inputs via ASTRA references). Community
alignment with an open spec backed by LinkML, W3C Web Annotations, and JSON-LD.
**Cons:** Adds a YAML document to maintain per app. ASTRA is early alpha -- expect
breaking changes between minor versions. The browser runtime extension doesn't
exist yet and requires upstream acceptance.
**Context:** ASTRA is at https://github.com/LightconeResearch/astra-spec (LinkML
schema, CC BY 4.0 / BSD-3). It generates TypeScript, JSON Schema, JSON-LD, Python,
Java, and OWL bindings from a single schema source. The generated TypeScript types
can be consumed directly in the Node.js LLM pipeline. See the iris example for the
pattern: inputs -> outputs -> decisions -> recipe.
**Depends on:** Core LLM pipeline must be working first (for integration point 1).
Existing apps can adopt ASTRA independently (integration point 2). The upstream
contribution (point 3) can start in parallel.
