import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeCompactShareState,
  encodeCompactShareState,
} from '../src/compact_share_state.ts'

test('gzip Base64URL round-trips the complete query string', async () => {
  const params = new URLSearchParams()
  params.set('source', 'dandi')
  params.set('layout', '34')
  params.set('layers', JSON.stringify([
    {
      id: 'stain-a',
      storeUrls: Array.from(
        { length: 10 },
        (_, index) => `https://dandiarchive.s3.amazonaws.com/zarr/store-${index}/`,
      ),
    },
  ]))
  params.set('nvslide', JSON.stringify({ version: 1, activePlane: 'coronal' }))

  const encoded = await encodeCompactShareState(params)
  const decoded = await decodeCompactShareState(encoded)

  assert.match(encoded, /^gz\.[A-Za-z0-9_-]+$/)
  assert.equal(decoded?.toString(), params.toString())
  assert.ok(encoded.length < params.toString().length / 2)
})

test('rejects malformed and unsupported compact state', async () => {
  assert.equal(await decodeCompactShareState(null), null)
  assert.equal(await decodeCompactShareState('json.abc'), null)
  assert.equal(await decodeCompactShareState('gz.not-valid-gzip'), null)
})
