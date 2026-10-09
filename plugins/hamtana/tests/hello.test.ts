import { describe, expect, test } from 'claude-code/testing'

import { INSTALL_ID } from '../hooks/app'
import { linkedRoutes, SESSION, TOKEN, world } from './fixtures'

const DAY_MS = 24 * 60 * 60_000

const HELLO_OK = { 'POST /api/mod/hello': () => ({ status: 200, body: { ok: true } }) }

const bodyOf = (sent: { body: unknown } | undefined) => (sent?.body ?? {}) as Record<string, unknown>

describe('daily hello', () => {
  test('once a day, anonymous even on a linked device, with the same install id', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: { ...linkedRoutes(), ...HELLO_OK } })

    await $.session.start(SESSION)

    expect(w.hellos()).toHaveLength(1)

    const [first] = w.hellos()
    const body = bodyOf(first)

    expect(first?.method).toBe('POST')
    expect(first?.auth, 'never the device token').toBeUndefined()
    expect(JSON.stringify(body).includes(TOKEN)).toBe(false)
    expect(Object.keys(body).sort(), 'nothing but these three').toEqual(['installId', 'surface', 'version'])
    expect(body.version).toBe('0.3.0')
    expect(body.surface).toBe('terminal')
    expect(INSTALL_ID.test(String(body.installId))).toBe(true)
    expect(w.store.get('installId')).toBe(body.installId)
    expect(w.store.get('helloDay')).toBe('1970-01-01')

    await $.session.start(SESSION)
    await w.clock.advance(60 * 60_000)
    await $.session.start(SESSION)

    expect(w.hellos(), 'not twice the same day').toHaveLength(1)

    await w.clock.advance(DAY_MS)
    await $.session.start(SESSION)

    expect(w.hellos(), 'again the next day').toHaveLength(2)
    expect(bodyOf(w.hellos()[1]).installId, 'the same install id').toBe(body.installId)
    expect(w.hellos()[1]?.auth).toBeUndefined()
    expect(w.store.get('helloDay')).toBe('1970-01-02')
  })

  test('unlinked installs say hello too', async ($, on) => {
    const w = world(on, { store: { welcomed: true }, routes: HELLO_OK })

    await $.session.start(SESSION)

    expect(w.hellos()).toHaveLength(1)
    expect(w.hellos()[0]?.auth).toBeUndefined()
    expect(w.sent, 'the hello is the only request').toHaveLength(1)
  })

  test('the surface follows the session: desktop', async ($, on) => {
    const w = world(on, { store: { welcomed: true }, routes: HELLO_OK, surfaces: ['desktop'] })

    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

    expect(bodyOf(w.hellos()[0]).surface).toBe('desktop')
  })

  test('a session with no surface sends "unknown"', async ($, on) => {
    const w = world(on, { store: { welcomed: true }, routes: HELLO_OK, surfaces: [] })

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })

    expect(bodyOf(w.hellos()[0]).surface).toBe('unknown')
  })

  test('a stored install id is kept; a broken one is replaced', async ($, on) => {
    const kept = 'install_id-kept-0123456789'

    const w = world(on, { store: { welcomed: true, installId: kept }, routes: HELLO_OK })

    await $.session.start(SESSION)

    expect(bodyOf(w.hellos()[0]).installId).toBe(kept)

    w.store.set('installId', 'short')
    w.store.delete('helloDay')

    await $.session.start(SESSION)

    const fresh = bodyOf(w.hellos()[1]).installId

    expect(fresh).not.toBe('short')
    expect(INSTALL_ID.test(String(fresh))).toBe(true)
    expect(w.store.get('installId')).toBe(fresh)
  })

  test('a network failure is silent and tries again next session', async ($, on) => {
    let isDown = true

    const w = world(on, {
      store: { welcomed: true },
      routes: {
        'POST /api/mod/hello': () => (isDown ? 'network-error' : { status: 200, body: { ok: true } }),
      },
    })

    await $.session.start(SESSION)

    expect(w.hellos()).toHaveLength(1)
    expect(w.toasts).toEqual([])
    expect(w.store.has('helloDay'), 'not marked done').toBe(false)

    isDown = false

    await $.session.start(SESSION)

    expect(w.hellos()).toHaveLength(2)
    expect(w.store.get('helloDay')).toBe('1970-01-01')
    expect(bodyOf(w.hellos()[1]).installId, 'the id was kept from the failed try').toBe(bodyOf(w.hellos()[0]).installId)
  })

  test('a server that refuses the hello (an older one: 404) is not asked again that day', async ($, on) => {
    const w = world(on, { store: { welcomed: true } })

    await $.session.start(SESSION)
    await $.session.start(SESSION)

    expect(w.hellos()).toHaveLength(1)
    expect(w.toasts).toEqual([])
  })
})
