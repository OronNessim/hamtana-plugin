/**
 * The world beneath the mod in a test: a mocked clock, an in-memory store,
 * a scripted Hamtana server behind `$.http.fetch`, and the UI calls, each
 * recorded so a test can check what the mod did.
 */

import type { On, RenderPropsOf, RenderSurface } from 'claude-code'
import { mock } from 'claude-code/testing'

export const BASE = 'https://hamtana.oronai.co.il'

export const TOKEN = 'hmt_device_token_for_tests'

export const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

export type Sent = {
  method: string
  path: string
  auth: string | undefined
  body: unknown
}

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

/** A route answers one `METHOD /path` (query string ignored). */
export type Routes = Record<string, (sent: Sent) => Reply | 'network-error'>

export type WorldOptions = {
  store?: Record<string, unknown>
  routes?: Routes
  surfaces?: readonly RenderSurface[]
}

export function world(on: On, options: WorldOptions = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const routes: Routes = { ...options.routes }
  const sent: Sent[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const openedFocus: (boolean | undefined)[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  on('ui.log', () => ({ value: undefined }))

  on('ui.open', ($, e) => {
    opened.push(e.id)
    openedFocus.push(e.focus)

    return { value: { isPlaced: true } }
  })

  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))

  on('store.get', ($, e) => ({ value: store.get(e.key) }))

  on('store.set', ($, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })

  on('store.delete', ($, e) => {
    store.delete(e.key)

    return { value: undefined }
  })

  on('http.fetch', ($, e) => {
    const url = new URL(e.url)
    const method = e.init?.method ?? 'GET'
    const bodyText = e.init?.body

    const record: Sent = {
      method,
      path: url.pathname + url.search,
      auth: e.init?.headers?.authorization,
      body: typeof bodyText === 'string' ? (JSON.parse(bodyText) as unknown) : undefined,
    }

    sent.push(record)

    const route = routes[`${method} ${url.pathname}`]
    const reply = route ? route(record) : { status: 404, body: { error: { code: 'not_found', message: 'לא נמצא' } } }

    if (reply === 'network-error') return { deny: 'the network is down' }

    return {
      value: {
        status: reply.status,
        ok: reply.status >= 200 && reply.status < 300,
        headers: reply.headers ?? {},
        text: reply.body === undefined ? '' : JSON.stringify(reply.body),
      },
    }
  })

  return {
    clock,
    store,
    routes,
    openedFocus,
    sent,
    toasts,
    opened,
    adRequests: () => sent.filter(request => request.path.startsWith('/api/mod/ad')),
    impressions: () => sent.filter(request => request.path === '/api/mod/impression'),
    calls: (path: string) => sent.filter(request => request.path.startsWith(path)),
  }
}

/** One served ad as GET /api/mod/ad answers it. */
export function adBody(n: number, ad: Record<string, unknown> = {}) {
  return {
    ad: {
      serveId: `serve-${n}`,
      text: `קפה טוב למפתחים ${n}`,
      url: `${BASE}/c/serve-${n}`,
      advertiser: `בית קפה ${n}`,
      ...ad,
    },
    token: `serve-token-${n}`,
    minDwellMs: 10_000,
    rotateMs: 30_000,
  }
}

export const adText = (n: number) => `קפה טוב למפתחים ${n}`

/** The text of every Text a drawing holds. `find` matches a part of a text; this is for exact checks. */
export async function textsOf(drawn: {
  findAll: (query: { type: 'Text' }) => Promise<ReadonlyArray<{ text?: string }>>
}): Promise<Array<string | undefined>> {
  return (await drawn.findAll({ type: 'Text' })).map(found => found.text)
}

/** The label a job ad carries on the wire (spelled out so a typo in strings.ts shows). */
export const JOB_LABEL = 'דרושים · מודעה'

export const BAND_PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

export const working = (isWorking: boolean): RenderPropsOf['AbovePrompt'] => ({
  ...BAND_PROPS,
  isWorking,
})

/** The band above the prompt, as a surface draws it. */
export const band = <P extends 'terminal' | 'desktop'>(surface: P, isWorking = false) =>
  ({
    plugin: 'hamtana',
    surface,
    component: 'AbovePrompt',
    props: working(isWorking),
    viewport: { columns: 100, rows: 30, isFullscreen: false },
  }) as const

/** The /hamtana pane. */
export const pane = <P extends 'terminal' | 'desktop'>(surface: P) =>
  ({
    plugin: 'hamtana',
    surface,
    component: 'Pane',
    requestId: 'hamtana',
    props: {
      title: 'המתנה',
      isFocused: true,
      bodyColumns: 80,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
    viewport: { columns: 100, rows: 40, isFullscreen: false },
  }) as const

export const turnEnd = (turnId: string, agentId?: string) =>
  ({
    answer: '',
    durationMs: 1_000,
    isAborted: false,
    turnId,
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  }) as const

/** Routes for a linked device: ads, impressions and /me. */
export function linkedRoutes(): Routes {
  let served = 0

  return {
    'GET /api/mod/ad': () => {
      served += 1

      return { status: 200, body: adBody(served) }
    },
    'POST /api/mod/impression': () => ({
      status: 200,
      body: { counted: true, earnedMicros: 8_000, todayMicros: 1_238_000, impressionsToday: 8 },
    }),
    'GET /api/mod/me': () => ({ status: 200, body: ME }),
  }
}

export const ME = {
  user: { name: 'אורון', email: 'dev@example.com' },
  todayMicros: 1_230_000,
  pendingMicros: 3_400_000,
  availableMicros: 52_000_000,
  impressionsToday: 7,
  dailyCap: 300,
  dashboardUrl: `${BASE}/dashboard`,
}

/** `/hamtana <args>` as the person types it at the prompt. */
export const hamtana = (args = '') =>
  ({
    command: 'hamtana',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  }) as const
