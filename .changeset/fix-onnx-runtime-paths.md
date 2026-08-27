---
"musclemap": patch
"vesselboost": patch
"spinalcordtoolbox": patch
"calmar": patch
"seedseg": patch
---

Fix ONNX Runtime WASM URLs in composite-site builds so inference loads the shared runtime without duplicating the `/_runtime/` path.
