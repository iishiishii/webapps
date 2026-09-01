# Agent Instructions

## Project Overview

Browser-based blood vessel segmentation using VesselBoost 3D UNet. All processing runs client-side via ONNX Runtime Web. See README.md for full details.

## Development

- **Start dev server**: `cd web && bash run.sh` (serves on http://localhost:8080)
- **Setup**: `cd web && bash setup.sh` (downloads ONNX Runtime WASM files, builds Rust preprocessing)

## Linting

Run `npm run lint` before committing JS changes. This parses all `web/**/*.js` files for syntax errors using acorn. The same check runs in CI before deploy.

Common issues it catches:
- `await` in non-async functions
- Mismatched brackets/parens
- Invalid ES module syntax

## Architecture

- `web/js/vesselboost-app.js` — Main app class, orchestrates everything
- `web/js/app/config.js` — Model config, version (bumped automatically by CI)
- `web/js/app/labels.js` — Binary labels + NiiVue colormap
- `web/js/inference-worker.js` runs the 3D inference pipeline as a module worker and uses the shared worker toolkit for routing, model fetches, and common volume operations.
- `web/js/controllers/` contains FileIO and DICOM controllers plus narrow pipeline and viewer adapters around the shared implementations.
- `web/js/modules/` — UI components and inference pipeline modules
- `rust-preprocessing/` — Rust WASM crate (N4ITK bias correction, NLM denoising, BET)

## Key Conventions

- Keep the inference worker as an ES module. The optional Rust preprocessing artifact still uses `wasm-pack --target no-modules`; that build target does not make the inference worker a classic worker.
- Config version is bumped automatically by the GitHub Actions release workflow via `sed` — do not bump manually
- WASM preprocessing is optional; the app works without it (skips bias correction/denoising)
- Default target spacing: 0.3mm isotropic

## CI/CD

- **Release workflow** (`.github/workflows/release.yml`): manual (`workflow_dispatch`) production release from `main`; validates setup + JS syntax, bumps version, creates tag + GitHub release
- **Deploy workflow** (`.github/workflows/deploy-pages.yml`): deploys production from the latest release tag and `/staging/` from `main`; builds Rust preprocessing WASM and verifies shipped ONNX/ORT/WASM artifacts
