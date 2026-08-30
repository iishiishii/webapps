# MuscleMap segmentation import normalization

## Usage

An uploaded segmentation keeps its MuscleMap release explicit and defaults only its value encoding to automatic detection:

```js
const codec = MuscleMapLabelCodec.createLabelCodec(input.labelSpace);
const normalized = codec.normalizeSegmentation(parsed.imageData, input.encoding);

postLog(normalized.summary);
labelVolumes.push(normalized.indices);
```

Metrics and consolidation receive the same `Uint8Array` class-index representation. Their downloadable result crosses the codec once more to produce official sparse labels.

## Problem

Imported NIfTI masks can contain official MuscleMap sparse values, browser class indices, or OpenRecon's int12-safe whole-body mapping. Value ranges overlap, and a partial mask cannot establish whether its label taxonomy is v1.3 or v1.4. The importer therefore needs to detect representation without guessing the release or silently changing anatomy.

## Shape

`label-codec.js` is the single owner of the release-derived sparse, class-index, and OpenRecon lookup tables. `normalizeSegmentation(values, requestedEncoding)` validates all distinct values, resolves compatible encodings by comparing their class-index meaning, and then allocates one normalized `Uint8Array`. The OpenRecon reverse table is derived with:

```text
mapped = 3 * floor(original / 10) + original % 10
```

The codec enables that representation only when the projection is int12-safe and collision-free for the selected release. Equivalent interpretations such as background-only masks succeed with indeterminate source provenance. Meaning-changing overlap such as `{0, 2141}` fails and lists the manual encoding choices. Explicit manual choices validate strictly and never fall back.

The worker's imported-NIfTI boundary invokes this operation for both metrics and consolidation. UI code transports the selected release and encoding policy but does not inspect voxel values. Successful metric extraction retains the worker's canonical sparse result as the uploaded mask's normalized download.

This keeps the public surface deep and small: one normalization operation hides validation, representation detection, OpenRecon restoration, ambiguity handling, and diagnostics. Metrics continue to trust class indices.

## Synthesis decision

The architecture arena selected the existing per-release codec design. The cross-judge scored it 29 out of 30 because it preserves the worker's class-index invariant and short call chain. The final design uses candidate 2's complete validation pass before decoding and its explicit indeterminate-encoding message. It rejects candidate 2's canonical-sparse internal volume and in-place `Float32Array` mutation. Those choices would require unrelated rewrites of metric counting, consolidation voting, display output, and serialization. They would also use four times the memory of `Uint8Array`.

## Tradeoffs accepted

- We accept two linear scans in exchange for atomic validation and one output-sized allocation.
- We accept an explicit release selector in exchange for avoiding unreliable inference between v1.3 and v1.4.
- We accept manual encoding options in exchange for safe recovery from rare ambiguous masks.
- We accept rejecting mixed or meaningfully ambiguous encodings in exchange for never assigning the wrong anatomy silently.

## Alternatives considered

- Separate detector, remapper, and decoder functions expose a temporal protocol and leak the same mapping policy across callers.
- A stateful import session absorbs unrelated NIfTI geometry and metrics responsibilities.
- Range-only detection is not viable because native and mapped values overlap.
- Canonical sparse labels as the internal metric representation require a broad migration and lose the existing compact class-index invariant.

## Open questions and risks

- If OpenRecon introduces another mapping revision, it needs a separate named encoding and release-derived lookup rather than a heuristic extension of `openrecon-int12`.
- Partial masks with meaningful overlap remain intentionally manual; provenance metadata in a future file format could remove that ambiguity.

## Next implementation step

Keep the pure codec and browser metrics-only tests as the executable contract whenever label spaces or import formats change.
