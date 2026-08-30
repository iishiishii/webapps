import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const entryPath = fileURLToPath(import.meta.resolve('@niivue/niivue'))
const distPath = dirname(entryPath)
const controlFile = (await readdir(distPath)).find(
  (name) => name.startsWith('NVControlBase-') && name.endsWith('.js'),
)
assert.ok(controlFile, 'NiiVue control bundle was not found')

const source = await readFile(join(distPath, controlFile), 'utf8')
const rendererSource = await readFile(join(distPath, 'niivue.js'), 'utf8')
const classStart = source.indexOf('class y2 {')
const classEnd = source.indexOf('\nfunction g2(', classStart)
assert.ok(classStart >= 0 && classEnd > classStart, 'chunk residency class moved')

const residencySource = source
  .slice(classStart, classEnd)
  .replace('class y2 {', 'globalThis.__ZarroChunkResidency = class {')
Function(residencySource)()

const ChunkResidency = globalThis.__ZarroChunkResidency
assert.equal(typeof ChunkResidency, 'function')

const prefetched = []
const cancelled = []
const manager = new ChunkResidency(4, 1024, {
  bytesOf: () => 1,
  destroy: () => {},
  prefetch: (index) => prefetched.push(index),
  cancel: (index) => cancelled.push(index),
})

manager.beginFrame()
manager.requestUpload(0)
manager.requestUpload(1)
manager.beginFrame()
manager.requestUpload(1)
manager.requestUpload(2)

assert.deepEqual(
  manager.peekPendingUploads(3),
  [1, 2, 0],
  'the current frame must drain before an older request',
)
manager.beginFrame()
assert.deepEqual(cancelled, [0], 'a stale queued fetch must be cancelled')
assert.equal(manager.staleDropCount, 1)
assert.deepEqual(prefetched, [0, 1, 2])

assert.ok(
  source.includes('signal: p.signal'),
  'the shared source loader must forward its abort signal',
)
assert.ok(
  source.match(/signal: C/g)?.length >= 2,
  'both renderer uploaders must forward per-chunk abort signals',
)
assert.ok(
  source.match(/cancelChunk:/g)?.length >= 2,
  'both renderer backends must expose chunk cancellation',
)
assert.ok(
  source.includes('fallback: this.fallbackTiles('),
  'NVSlide must retain cached coarser tiles while finer tiles load',
)
assert.ok(
  rendererSource.match(/\.fallback\.length > 0/g)?.length >= 2,
  'both NVSlide renderers must reveal coarse fallback tiles',
)

console.log(
  'Verified NiiVue current-frame priority, cancellation, and NVSlide fallback',
)
