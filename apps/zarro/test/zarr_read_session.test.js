import assert from 'node:assert/strict'
import test from 'node:test'
import { ZarrReadSession } from '../src/zarr_read_session.ts'

test('renew aborts obsolete reads while keeping the new session usable', () => {
  const session = new ZarrReadSession()
  const obsolete = session.signal

  session.renew()

  assert.equal(obsolete.aborted, true)
  assert.equal(obsolete.reason.name, 'AbortError')
  assert.equal(session.signal.aborted, false)
  assert.notStrictEqual(session.signal, obsolete)
})

test('parent cancellation aborts the current renewed session', () => {
  const parent = new AbortController()
  const session = new ZarrReadSession(parent.signal)
  session.renew()
  const current = session.signal

  parent.abort(new DOMException('reload superseded', 'AbortError'))

  assert.equal(current.aborted, true)
  assert.equal(session.signal.aborted, true)
})

test('combines a renderer request with the current read session', () => {
  const request = new AbortController()
  const session = new ZarrReadSession()
  const combined = session.signalFor(request.signal)

  request.abort(new DOMException('view moved on', 'AbortError'))

  assert.equal(combined.aborted, true)
  assert.equal(combined.reason.message, 'view moved on')
  assert.equal(session.signal.aborted, false)
})

test('renewing the read session aborts a combined renderer request', () => {
  const request = new AbortController()
  const session = new ZarrReadSession()
  const combined = session.signalFor(request.signal)

  session.renew()

  assert.equal(combined.aborted, true)
  assert.equal(request.signal.aborted, false)
})

test('a source-lifetime read survives plan renewal and stops on disposal', () => {
  const session = new ZarrReadSession()
  const lifetime = session.lifetimeSignal

  session.renew()
  assert.equal(lifetime.aborted, false)

  session.abort('source disposed')
  assert.equal(lifetime.aborted, true)
  assert.equal(lifetime.reason.message, 'source disposed')
})
