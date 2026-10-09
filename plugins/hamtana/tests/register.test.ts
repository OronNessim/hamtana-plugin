import { describe, expect, test } from 'claude-code/testing'

import { visualOrder } from '../hooks/bidi'
import * as S from '../hooks/strings'
import {
  adBody,
  adText,
  band,
  BASE,
  hamtana,
  JOB_LABEL,
  linkedRoutes,
  pane,
  SESSION,
  textsOf,
  TOKEN,
  turnEnd,
  working,
  world,
} from './fixtures'

describe('register', () => {
  test('unlinked: no ad request, the band shows the invite once', async ($, on) => {
    const w = world(on, { routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    expect(await drawn.find({ key: 'hamtana-open' }), 'invite shown').toBeDefined()

    await $.turn.start({ text: 'תקן את הבאג', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(60_000)

    expect(
      w.sent.filter(request => request.path !== '/api/mod/hello'),
      'nothing but the anonymous hello reaches the server before linking',
    ).toEqual([])
    expect(w.hellos().every(request => request.auth === undefined)).toBe(true)
    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeUndefined()

    await $.turn.complete(turnEnd('t1'))
    await drawn.redraw(working(false))

    expect(
      await drawn.find({ key: 'hamtana-open' }),
      'the invite is gone after the first turn',
    ).toBeUndefined()
  })

  test('the invite can be dismissed', async ($, on) => {
    world(on)

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await drawn.press({ key: 'hamtana-dismiss' })

    expect(await drawn.find({ key: 'hamtana-open' })).toBeUndefined()
  })

  test('device flow: code, link, poll, token saved', async ($, on) => {
    let polls = 0

    const w = world(on, {
      store: { welcomed: true },
      routes: {
        'POST /api/device/start': () => ({
          status: 200,
          body: {
            deviceCode: 'device-code-1',
            userCode: 'ABCD-2345',
            verifyUrl: `${BASE}/link`,
            verifyUrlComplete: `${BASE}/link?code=ABCD-2345`,
            intervalSec: 5,
            expiresInSec: 600,
          },
        }),
        'POST /api/device/poll': () => {
          polls += 1

          return polls < 2
            ? { status: 200, body: { status: 'pending' } }
            : {
                status: 200,
                body: {
                  status: 'approved',
                  token: TOKEN,
                  user: { name: 'אורון', email: 'dev@example.com' },
                },
              }
        },
        'GET /api/mod/me': () => ({
          status: 200,
          body: {
            user: { name: 'אורון', email: 'dev@example.com' },
            todayMicros: 0,
            pendingMicros: 0,
            availableMicros: 0,
            impressionsToday: 0,
            dailyCap: 300,
            dashboardUrl: `${BASE}/dashboard`,
          },
        }),
      },
    })

    await $.session.start(SESSION)

    expect(await $.command.run(hamtana(''))).toEqual({})
    expect(w.opened).toEqual(['hamtana'])

    const drawn = await $.ui.mount(pane('terminal'))

    await drawn.press({ key: 'hamtana-link' })

    expect(w.calls('/api/device/start')[0]?.body).toEqual({ label: 'Claude Code' })
    expect(await drawn.find({ type: 'Text', text: 'ABCD-2345' }), 'the code, big').toBeDefined()

    const link = await drawn.find({ type: 'Link' })

    expect(link?.props.href).toBe(`${BASE}/link?code=ABCD-2345`)

    await w.clock.advance(5_000)

    expect(polls).toBe(1)
    expect(w.store.get('token')).toBeUndefined()

    await w.clock.advance(5_000)

    expect(polls).toBe(2)
    expect(w.calls('/api/device/poll')[1]?.body).toEqual({ deviceCode: 'device-code-1' })
    expect(w.store.get('token')).toBe(TOKEN)
    expect(w.toasts).toContain(S.TOAST_LINKED)
    expect(await drawn.find({ type: 'Text', text: 'מחובר' })).toBeDefined()
    expect(w.calls('/api/mod/me')[0]?.auth).toBe(`Bearer ${TOKEN}`)

    await w.clock.advance(60_000)

    expect(polls, 'polling stops once approved').toBe(2)
  })

  test('linked: a turn fetches an ad and the band draws it', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    expect(await drawn.find({ type: 'Text', text: '/hamtana' }), 'no invite when linked').toBeUndefined()

    await $.turn.start({ text: 'כתוב בדיקות', turnId: 't1' })
    await w.clock.settle()

    const [request] = w.adRequests()

    expect(request?.path).toBe('/api/mod/ad?surface=terminal&house=1')
    expect(request?.auth).toBe(`Bearer ${TOKEN}`)

    await drawn.redraw(working(true))

    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: 'בית קפה 1' })).toBeDefined()
    expect((await drawn.find({ type: 'Link' }))?.props.href).toBe(`${BASE}/c/serve-1`)
  })

  test('a job ad: the band draws the job label instead of the plain one', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect(JOB_LABEL).toBe(S.AD_LABEL_JOBS)
    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
    expect(await textsOf(drawn), 'one label, not two').not.toContain(S.AD_LABEL)
    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: 'בית קפה 1' })).toBeDefined()
    expect((await drawn.find({ type: 'Link' }))?.props.href).toBe(`${BASE}/c/serve-1`)
  })

  test('an ad with no label (an older server) keeps the plain label', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeUndefined()
  })

  test('a spoofed label is never drawn: the plain label shows instead', async ($, on) => {
    const spoof = 'דרושים · מודעה · מבצע חם, לחצו כאן עכשיו'

    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: spoof }) }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: spoof })).toBeUndefined()
    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeUndefined()
  })

  test('the longer job label never shortens the ad text or the advertiser, even in a narrow band', async ($, on) => {
    const text = 'ב'.repeat(60)
    const advertiser = 'ג'.repeat(40)

    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({
          status: 200,
          body: adBody(1, { label: JOB_LABEL, text, advertiser }),
        }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw({ ...working(true), bodyColumns: 40 })

    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text }), 'the 60 characters stay whole').toBeDefined()
    expect(await drawn.find({ type: 'Text', text: `· ${advertiser}` }), 'the 40 stay whole').toBeDefined()

    const boxes = await drawn.findAll({ type: 'Box' })

    expect(
      boxes.some(box => box.props.flexWrap === 'wrap'),
      'the row wraps, so a long label moves the break instead of cutting text',
    ).toBe(true)
  })

  test('the ad shows only while Claude is working', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(false))

    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeUndefined()
  })

  test('dwell reached: exactly one impression', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(9_000)

    expect(w.impressions(), 'not before minDwellMs').toEqual([])

    await w.clock.advance(1_000)

    expect(w.impressions()).toHaveLength(1)
    expect(w.impressions()[0]?.auth).toBe(`Bearer ${TOKEN}`)
    expect(w.impressions()[0]?.body).toEqual({ token: 'serve-token-1', dwellMs: 10_000 })

    await drawn.redraw(working(true))
    await w.clock.advance(15_000)
    await drawn.redraw(working(true))
    await w.clock.advance(4_000)

    expect(w.impressions(), 'never twice for one serve, however often it redraws').toHaveLength(1)
  })

  test('the turn ends before the dwell: no impression, the ad goes', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(5_000)
    await $.turn.complete(turnEnd('t1'))
    await w.clock.advance(60_000)

    expect(w.impressions()).toEqual([])
    expect(w.adRequests(), 'no rotation after the turn').toHaveLength(1)

    await drawn.redraw(working(false))

    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeUndefined()
  })

  test('a subagent finishing does not end the turn', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(3_000)
    await $.turn.complete(turnEnd('sub-1', 'agent-1'))
    await w.clock.advance(7_000)

    expect(w.impressions()).toHaveLength(1)
  })

  test('a hidden band restarts the dwell (it must be continuous)', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(6_000)
    await drawn.redraw({ ...working(true), hasSurvey: true })
    await w.clock.advance(1_000)
    await drawn.redraw(working(true))
    await w.clock.advance(6_000)

    expect(w.impressions(), '6 s + 6 s with a gap is not 10 s in a row').toEqual([])

    await w.clock.advance(4_000)

    expect(w.impressions()).toHaveLength(1)
  })

  test('rotation fetches the next ad after rotateMs', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(29_000)

    expect(w.adRequests()).toHaveLength(1)

    await w.clock.advance(1_000)

    expect(w.adRequests()).toHaveLength(2)
    expect(await drawn.find({ type: 'Text', text: adText(2) })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeUndefined()
  })

  test('401 clears the token and stops ads', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN, user: { name: 'אורון', email: 'dev@example.com' } },
      routes: {
        'GET /api/mod/ad': () => ({
          status: 401,
          body: { error: { code: 'unauthorized', message: 'לא מחובר' } },
        }),
      },
    })

    await $.session.start(SESSION)
    await $.ui.mount(band('terminal'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    expect(w.store.has('token')).toBe(false)
    expect(w.store.has('user')).toBe(false)
    expect(w.toasts).toContain(S.TOAST_SIGNED_OUT)

    await $.turn.complete(turnEnd('t1'))
    await w.clock.advance(20_000)
    await $.turn.start({ text: 'y', turnId: 't2' })
    await w.clock.advance(60_000)

    expect(w.adRequests(), 'no more ad requests once signed out').toHaveLength(1)

    const text = await $.command.run(hamtana('status'))

    expect(text.text).toContain('לא מחובר')
  })

  test('ad: null draws nothing and waits retryAfterMs', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({
          status: 200,
          body: { ad: null, reason: 'no_campaigns', retryAfterMs: 45_000 },
        }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeUndefined()
    expect(await drawn.find({ type: 'Link' })).toBeUndefined()

    await w.clock.advance(44_000)

    expect(w.adRequests()).toHaveLength(1)

    await w.clock.advance(1_000)

    expect(w.adRequests()).toHaveLength(2)
    expect(w.impressions()).toEqual([])
  })

  test('a new turn keeps the 10 s gap and an earlier retryAfterMs', async ($, on) => {
    let answers = 0

    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => {
          answers += 1

          return answers === 1
            ? { status: 200, body: adBody(1) }
            : { status: 200, body: { ad: null, reason: 'daily_cap', retryAfterMs: 120_000 } }
        },
      },
    })

    await $.session.start(SESSION)
    await $.ui.mount(band('terminal'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await w.clock.advance(2_000)
    await $.turn.complete(turnEnd('t1'))
    await w.clock.advance(1_000)
    await $.turn.start({ text: 'y', turnId: 't2' })
    await w.clock.advance(6_000)

    expect(w.adRequests(), 'not within 10 s of the last ask').toHaveLength(1)

    await w.clock.advance(1_000)

    expect(w.adRequests(), 'asked once the gap passed').toHaveLength(2)

    await $.turn.complete(turnEnd('t2'))
    await w.clock.advance(5_000)
    await $.turn.start({ text: 'z', turnId: 't3' })
    await w.clock.advance(100_000)

    expect(w.adRequests(), 'daily_cap said wait 120 s').toHaveLength(2)

    await w.clock.advance(15_000)

    expect(w.adRequests()).toHaveLength(3)
  })

  test('network failures back off and never surface', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: { 'GET /api/mod/ad': () => 'network-error' },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect(w.adRequests()).toHaveLength(1)

    await w.clock.advance(14_000)

    expect(w.adRequests(), 'first backoff is 15 s').toHaveLength(1)

    await w.clock.advance(1_000)

    expect(w.adRequests()).toHaveLength(2)

    await w.clock.advance(29_000)

    expect(w.adRequests(), 'then 30 s').toHaveLength(2)

    await w.clock.advance(1_000)

    expect(w.adRequests()).toHaveLength(3)
    expect(w.toasts).toEqual([])
    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeUndefined()
  })

  test('pause stops fetching, resume starts again', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)
    await $.ui.mount(band('terminal'))

    const paused = await $.command.run(hamtana('pause'))

    expect(paused.text).toBe(S.TEXT_PAUSED)
    expect(w.store.get('paused')).toBe(true)

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.advance(60_000)

    expect(w.adRequests()).toEqual([])

    const resumed = await $.command.run(hamtana('resume'))

    await w.clock.settle()

    expect(resumed.text).toBe(S.TEXT_RESUMED)
    expect(w.store.get('paused')).toBe(false)
    expect(w.adRequests()).toHaveLength(1)
  })

  test('the pane pause button toggles the stored flag', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(pane('terminal'))

    await drawn.press({ key: 'hamtana-pause' })

    expect(w.store.get('paused')).toBe(true)
    expect((await drawn.find({ key: 'hamtana-pause' }))?.props.label).toBe(S.RESUME)

    await drawn.press({ key: 'hamtana-pause' })

    expect(w.store.get('paused')).toBe(false)
  })

  test('the linked pane shows balances in shekels and unlinks', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    w.routes['POST /api/mod/unlink'] = () => ({ status: 200, body: { ok: true } })

    await $.session.start(SESSION)
    await $.command.run(hamtana(''))
    await w.clock.settle()

    const drawn = await $.ui.mount(pane('desktop'))

    expect(await drawn.find({ type: 'Text', text: 'היום: ₪1.23' })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: 'ממתין: ₪3.40 · זמין: ₪52.00' })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: 'חשיפות היום: 7 מתוך 300' })).toBeDefined()

    const links = await drawn.findAll({ type: 'Link' })

    expect(links.map(found => found.props.href)).toContain(`${BASE}/dashboard`)

    await drawn.press({ key: 'hamtana-unlink' })

    expect(w.calls('/api/mod/unlink')[0]?.auth).toBe(`Bearer ${TOKEN}`)
    expect(w.store.has('token')).toBe(false)
    expect(await drawn.find({ key: 'hamtana-link' }), 'back to the link button').toBeDefined()
  })

  test('/hamtana status answers in text where nothing draws', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes(), surfaces: [] })

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })

    const bare = await $.command.run(hamtana(''))

    expect(w.opened, 'no pane where nothing draws').toEqual([])
    expect(bare.text).toContain('מחוברים: אורון (dev@example.com)')
    expect(bare.text).toContain('היום: ₪1.23')
    expect(bare.text).toContain('חשיפות היום: 7 מתוך 300')

    const help = await $.command.run(hamtana('what'))

    expect(help.text).toBe(S.TEXT_HELP)
  })

  test('/hamtana login gives the code as text', async ($, on) => {
    world(on, {
      surfaces: [],
      routes: {
        'POST /api/device/start': () => ({
          status: 200,
          body: {
            deviceCode: 'd',
            userCode: 'WXYZ-6789',
            verifyUrl: `${BASE}/link`,
            verifyUrlComplete: `${BASE}/link?code=WXYZ-6789`,
            intervalSec: 5,
            expiresInSec: 600,
          },
        }),
      },
    })

    await $.session.start(SESSION)

    const answer = await $.command.run(hamtana('login'))

    expect(answer.text).toContain('WXYZ-6789')
    expect(answer.text).toContain(`${BASE}/link?code=WXYZ-6789`)
  })

  test('untrusted ad text is cleaned and capped at 60', async ($, on) => {
    const dirty =
      'שורה ראשונה\nשורה שנייה' + String.fromCharCode(0x202e) + '\t' + 'א'.repeat(80)

    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({
          status: 200,
          body: adBody(1, { text: dirty, url: 'javascript:alert(1)' }),
        }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    const shown = await drawn.find({ type: 'Text', text: /^שורה ראשונה/ })
    const shownText = shown?.text ?? ''

    expect(shownText.startsWith('שורה ראשונה שורה שנייה א')).toBe(true)
    expect(Array.from(shownText).length).toBeLessThanOrEqual(60)
    expect(/[\n\t\u0000-\u001F]/.test(shownText)).toBe(false)
    expect(shownText.includes(String.fromCharCode(0x202e))).toBe(false)
    expect(await drawn.find({ type: 'Link' }), 'an unsafe URL gets no link').toBeUndefined()
  })

  test('terminalHebrew=reverse reorders on the terminal only', { options: { terminalHebrew: 'reverse' } }, async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))
    const desktop = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))
    await desktop.redraw(working(true))

    expect(await terminal.find({ type: 'Text', text: visualOrder(adText(1)) })).toBeDefined()
    expect(await terminal.find({ type: 'Text', text: adText(1) })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: adText(1) })).toBeDefined()
  })

  test('terminalHebrew=reverse reorders the job label on the terminal only', { options: { terminalHebrew: 'reverse' } }, async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))
    const desktop = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))
    await desktop.redraw(working(true))

    expect(visualOrder(JOB_LABEL)).not.toBe(JOB_LABEL)
    expect(await terminal.find({ type: 'Text', text: visualOrder(JOB_LABEL) })).toBeDefined()
    expect(await terminal.find({ type: 'Text', text: JOB_LABEL })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
  })

  test('terminalHebrew=plain keeps the job label as sent', { options: { terminalHebrew: 'plain' } }, async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))

    expect(await terminal.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
  })

  test('auto draws the job label unchanged on the terminal', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))

    expect(await terminal.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
  })

  test('the pane draws the ad with its job label', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        ...linkedRoutes(),
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)
    await $.ui.mount(band('desktop'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    const drawn = await $.ui.mount(pane('desktop'))

    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
    expect(await textsOf(drawn), 'one label, not two').not.toContain(S.AD_LABEL)
    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeDefined()
  })

  test('the pane draws the plain label for an ad without one', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)
    await $.ui.mount(band('desktop'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    const drawn = await $.ui.mount(pane('desktop'))

    expect(await drawn.find({ type: 'Text', text: S.AD_LABEL })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: adText(1) })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: JOB_LABEL })).toBeUndefined()
  })

  test('terminalHebrew=reverse reorders the job label in the terminal pane', { options: { terminalHebrew: 'reverse' } }, async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        ...linkedRoutes(),
        'GET /api/mod/ad': () => ({ status: 200, body: adBody(1, { label: JOB_LABEL }) }),
      },
    })

    await $.session.start(SESSION)
    await $.ui.mount(band('desktop'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    const terminal = await $.ui.mount(pane('terminal'))
    const desktop = await $.ui.mount(pane('desktop'))

    expect(await terminal.find({ type: 'Text', text: visualOrder(JOB_LABEL) })).toBeDefined()
    expect(await terminal.find({ type: 'Text', text: JOB_LABEL })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: JOB_LABEL })).toBeDefined()
  })

  test('auto (the default) never reorders', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))

    expect(await terminal.find({ type: 'Text', text: adText(1) })).toBeDefined()
  })
  test('first run, unlinked: the welcome pane opens once', async ($, on) => {
    const w = world(on, { routes: linkedRoutes() })

    await $.session.start(SESSION)
    await w.clock.settle()

    expect(w.opened).toEqual(['hamtana'])
    expect(w.openedFocus, 'focus left out: the host refuses focus: false').toEqual([undefined])
    expect(w.store.get('welcomed')).toBe(true)

    const drawn = await $.ui.mount(pane('desktop'))

    expect(await drawn.find({ key: 'hamtana-link' }), 'the one button').toBeDefined()
    expect(await drawn.find({ type: 'Text', text: S.WELCOME_TITLE })).toBeDefined()

    await $.session.start(SESSION)
    await w.clock.settle()

    expect(w.opened, 'not again in the next session').toEqual(['hamtana'])
  })

  test('linked users get no welcome pane', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)
    await w.clock.settle()

    expect(w.opened).toEqual([])
  })

  test('no welcome pane where nothing draws', async ($, on) => {
    const w = world(on, { routes: linkedRoutes(), surfaces: [] })

    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    await w.clock.settle()

    expect(w.opened).toEqual([])
    expect(w.store.get('welcomed'), 'tried again next time').toBeUndefined()
  })

  test('the invite button opens the pane with focus', async ($, on) => {
    const w = world(on, { store: { welcomed: true }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('desktop'))

    await drawn.press({ key: 'hamtana-open' })
    await w.clock.settle()

    expect(w.opened).toEqual(['hamtana'])
    expect(w.openedFocus).toEqual([true])
  })
})
