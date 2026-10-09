import { describe, expect, test } from 'claude-code/testing'

import { visualOrder } from '../hooks/bidi'
import * as S from '../hooks/strings'
import {
  adBody,
  adText,
  band,
  HOUSE_LABEL,
  HOUSE_TEXT,
  HOUSE_URL,
  houseBody,
  linkedRoutes,
  pane,
  SESSION,
  textsOf,
  TOKEN,
  working,
  world,
} from './fixtures'

describe('house message', () => {
  test('it is drawn like an ad, labelled "המתנה", dim, with its link, on terminal and desktop', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: { 'GET /api/mod/ad': () => ({ status: 200, body: houseBody() }) },
    })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))
    const desktop = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    expect(w.adRequests()[0]?.path, 'the client opts in to house messages').toContain('&house=1')
    expect(w.adRequests()[0]?.auth).toBe(`Bearer ${TOKEN}`)

    for (const drawn of [terminal, desktop]) {
      await drawn.redraw(working(true))

      const texts = await textsOf(drawn)

      expect(texts, 'the house label').toContain(HOUSE_LABEL)
      expect(texts, 'never the ad marking').not.toContain(S.AD_LABEL)
      expect(texts).not.toContain(S.AD_LABEL_JOBS)
      expect(texts).toContain(HOUSE_TEXT)

      const label = await drawn.find({ type: 'Text', text: HOUSE_LABEL })
      const line = await drawn.find({ type: 'Text', text: HOUSE_TEXT })

      expect(label?.props.dimColor, 'the neutral tone of the invite').toBe(true)
      expect(line?.props.dimColor, 'the line is dim too, so it never reads as a paid ad').toBe(true)
      expect(label?.props.color, 'no accent colour on the label').toBeUndefined()
      expect((await drawn.find({ type: 'Link' }))?.props.href).toBe(HOUSE_URL)
    }
  })

  test('a paid ad keeps its full-strength text', async ($, on) => {
    const w = world(on, { store: { token: TOKEN }, routes: linkedRoutes() })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))

    expect((await drawn.find({ type: 'Text', text: adText(1) }))?.props.dimColor).toBeUndefined()
    expect(await textsOf(drawn)).not.toContain(HOUSE_LABEL)
  })

  test('it never reports an impression and starts no dwell', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        ...linkedRoutes(),
        'GET /api/mod/ad': () => ({ status: 200, body: houseBody({}) }),
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    for (let second = 0; second < 59; second += 1) {
      await drawn.redraw(working(true))
      await w.clock.advance(1_000)
    }

    expect(w.impressions(), 'no impression however long it shows').toEqual([])
    expect(await textsOf(drawn)).toContain(HOUSE_TEXT)
  })

  test('it rotates on rotateMs, and a real ad replaces it as soon as one runs', async ($, on) => {
    let asks = 0

    const w = world(on, {
      store: { token: TOKEN },
      routes: {
        ...linkedRoutes(),
        'GET /api/mod/ad': () => {
          asks += 1

          return asks === 1 ? { status: 200, body: houseBody() } : { status: 200, body: adBody(1) }
        },
      },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await drawn.redraw(working(true))
    await w.clock.advance(59_000)

    expect(w.adRequests(), 'not before rotateMs (60 s)').toHaveLength(1)

    await w.clock.advance(1_000)

    expect(w.adRequests()).toHaveLength(2)

    await drawn.redraw(working(true))

    const texts = await textsOf(drawn)

    expect(texts).toContain(S.AD_LABEL)
    expect(texts).toContain(adText(1))
    expect(texts).not.toContain(HOUSE_TEXT)
    expect(texts).not.toContain(HOUSE_LABEL)

    await w.clock.advance(10_000)

    expect(w.impressions(), 'the real ad is counted as usual').toHaveLength(1)
    expect(w.impressions()[0]?.body).toEqual({ token: 'serve-token-1', dwellMs: 10_000 })
  })

  test('the pane does not repeat the house message', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: { ...linkedRoutes(), 'GET /api/mod/ad': () => ({ status: 200, body: houseBody() }) },
    })

    await $.session.start(SESSION)
    await $.ui.mount(band('desktop'))
    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()

    const drawn = await $.ui.mount(pane('desktop'))
    const texts = await textsOf(drawn)

    expect(texts).not.toContain(HOUSE_TEXT)
    expect(texts).not.toContain(HOUSE_LABEL)
    expect(await drawn.find({ key: 'hamtana-pause' }), 'the rest of the pane is there').toBeDefined()
  })

  test('terminalHebrew=reverse reorders the house line on the terminal only', { options: { terminalHebrew: 'reverse' } }, async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN },
      routes: { 'GET /api/mod/ad': () => ({ status: 200, body: houseBody() }) },
    })

    await $.session.start(SESSION)

    const terminal = await $.ui.mount(band('terminal'))
    const desktop = await $.ui.mount(band('desktop'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.settle()
    await terminal.redraw(working(true))
    await desktop.redraw(working(true))

    expect(await textsOf(terminal)).toContain(visualOrder(HOUSE_LABEL))
    expect(await textsOf(terminal)).toContain(visualOrder(HOUSE_TEXT))
    expect(await textsOf(desktop)).toContain(HOUSE_LABEL)
    expect(await textsOf(desktop)).toContain(HOUSE_TEXT)
  })

  test('paused: no house message either', async ($, on) => {
    const w = world(on, {
      store: { token: TOKEN, paused: true },
      routes: { 'GET /api/mod/ad': () => ({ status: 200, body: houseBody() }) },
    })

    await $.session.start(SESSION)

    const drawn = await $.ui.mount(band('terminal'))

    await $.turn.start({ text: 'x', turnId: 't1' })
    await w.clock.advance(60_000)
    await drawn.redraw(working(true))

    expect(w.adRequests()).toEqual([])
    expect(await textsOf(drawn)).not.toContain(HOUSE_TEXT)
  })
})
