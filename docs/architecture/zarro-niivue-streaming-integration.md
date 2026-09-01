# Zarro NiiVue streaming integration

## Context

The DANDI demo uses NiiVue mono revision
[`0e693094`](https://github.com/niivue/mono/commit/0e6930940c947f866a86af3a65e563e35a94be62).
That revision is newer than the published `1.0.0-rc.12` package. Zarro uses
`1.0.0-rc.11` with local behavior that upstream main does not contain:

- field-of-view protection through `focusBounds`
- click-or-pan crosshair interaction
- square cropped layouts and a zoom-aware ruler
- display-window refresh from retained resident bytes
- multi-stain plan-swap and overlay behavior

Replacing the dependency with the demo revision would therefore be a renderer
upgrade and a Zarro compatibility rebase at the same time. A build spike proved
that the upstream package builds, but the current Zarro patch cannot apply to
it and Zarro's custom contracts do not compile against it.

## Decision

Keep the patched rc.11 package for this change and backport three upstream
behaviors as one bounded slice:

1. The upload queue from
   [`1a9d525`](https://github.com/niivue/mono/commit/1a9d525d0788feddcd013eb8a398340bfeee1a12)
   reorders queued bricks for the current frame and retires a brick after the
   view stops requesting it.
2. The cancellation path from
   [`70c3dfc`](https://github.com/niivue/mono/commit/70c3dfce652dae631471e1fd791c1ddc3cda38ad)
   gives each renderer fetch an abort controller. Cancellation travels through
   the shared NiiVue source loader, Zarro's bounded task pool, mosaic fan-out,
   Zarrita, and the browser request.
3. The NVSlide coarse-tile fallback from
   [`b245524`](https://github.com/niivue/mono/commit/b245524e57cb240495712358ad3c1306a45be5e1)
   keeps decoded coarser tiles under a newly selected level until its finer
   tiles arrive.

The changes apply to both the WebGL2 and WebGPU volume renderers. They also
apply to the fixed cropped 3D path because it uses the same renderer uploader.
Zarro combines the renderer signal with `ZarrReadSession`, so either a stale
brick or an obsolete plan can stop the read without weakening the other
lifetime.

This slice adds no cache tier and does not increase the memory ceiling. Zarro
keeps its encoded-byte and decoded-native-chunk caches. The existing NiiVue
patch keeps the coarse volume floor, cross-fade, drag-time upload pause, and
resident assembled bytes used for display-window refresh.

## Boundaries

NiiVue owns the current-view working set, upload order, GPU residency, and
rendering. Zarro owns OME-Zarr metadata, native caches, translated mosaic
composition, stain orchestration, and exports. `ChunkedVolumeSource.fetchChunk`
remains the boundary between them; its request now carries an optional
`AbortSignal`.

Zarro also exposes the permanent `NVSlide axial focus` layout. Three NVSlide
panes use the same `ChunkedVolumeSource` and native caches as the volume view.
The [permanent orthogonal NVSlide layout](./zarro-nvslide-layout.md) describes
its ownership and interaction model.

Each NVSlide plane source owns an `AbortController` because NVSlide does not
pass a renderer signal through `SlideTileSource.fetchTileBytes`. Replacing a
slice or leaving the layout aborts that plane's requests before its slide is
disposed.

## Verification

`apps/zarro/scripts/verify_niivue_streaming_patch.mjs` exercises the residency
class from the installed generated bundle. It proves that current-frame work
drains before older work, stale queued work calls the cancellation hook, and
both renderer uploaders pass abort signals into the source path.
It also checks that both NVSlide renderers reveal cached fallback tiles.

App tests prove both cancellation domains and prove that renderer cancellation
reaches an active mosaic region read. The existing Zarro suite remains the
regression gate for focus planning, mosaics, cache behavior, layouts, and
multi-stain sequencing.

## Alternatives

An exact-SHA package would keep prediction, the decoded assembled-brick cache,
worker loading, and renderer scheduling aligned with upstream. It was rejected
for this change because the compatibility overlay is not yet proven and the
snapshot is unpublished.

A broad backport of prediction, the decoded post-eviction tier, worker loading,
and telemetry was also rejected. It would create a second renderer fork on an
older release and add memory and scheduling interactions that cannot be
validated as a small change.

## Consequences and follow-ups

Fast pan, slice changes, and zoom no longer leave an old FIFO draining ahead of
the current view. Queued reads for abandoned views are stopped instead of
finishing and being discarded. Main-thread OME-Zarr decoding can still create
long tasks because Zarro's custom source does not use the upstream worker pool.

The prototype comparison led to the permanent NVSlide axial-focus layout.
`nvslide_view.ts` now owns the three-pane adapter, and the shared NiiVue model
owns crosshairs, display windows, measurements, and export state. Colormap,
backend-selection, and multi-stain behavior remain follow-up work.

Revisit the exact-SHA upgrade when the Zarro compatibility overlay compiles
against an upstream release that contains the demo work. At that point, remove
backported hunks that are identical upstream, measure aggregate cache memory,
and decide separately whether Zarro needs worker decoding.
