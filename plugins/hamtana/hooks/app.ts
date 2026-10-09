/**
 * Hamtana's state and behaviour, kept apart from `$` so every rule is plain
 * code: linking (device code), the ad loop inside a turn (fetch, dwell,
 * impression, rotation, backoff; a house message in place of an ad when no
 * campaign runs), pause, the daily anonymous hello, and the text replies of
 * /hamtana.
 *
 * Nothing here throws to a hook: every outside call goes through `Host`,
 * whose network calls resolve to results (see api.ts) and whose other calls
 * are wrapped where they could fail. Failures are logged to the debug log
 * only and retried later with backoff.
 */

import type { HttpInit, HttpResponse, RenderSurface, Timer, UiOpenResult } from 'claude-code'

import {
  type Ad,
  adAnswerOf,
  call,
  type CallResult,
  type DeviceStart,
  deviceStartOf,
  devicePollOf,
  errorCodeOf,
  type Me,
  meOf,
  type Profile,
  profileOf,
} from './api'
import * as S from './strings'
import { clamp, count, numberField, serverBaseOf, shekels } from './text'

/** What the app needs from Claude Code; register.ts builds it from `$`. */
export type Host = {
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => Timer
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  invalidate: () => void
  toast: (text: string) => void
  debug: (text: string) => void
  openPane: () => Promise<UiOpenResult>
  /** The same pane for the one-time welcome (the host gives it focus; Escape closes it). */
  openWelcome: () => Promise<UiOpenResult>
  surfaces: () => Promise<readonly RenderSurface[]>
}

export type HebrewMode = 'auto' | 'reverse' | 'plain'

export type Settings = {
  /** The server origin, or null when the option is not a usable URL. */
  base: string | null
  hebrew: HebrewMode
}

/**
 * Keys in `$.store`, shared by every session on the machine. `installId` is
 * the anonymous random id the daily hello sends; `helloDay` the UTC day
 * (`YYYY-MM-DD`) of the last hello the server answered.
 */
export const KEYS = {
  token: 'token',
  paused: 'paused',
  user: 'user',
  welcomed: 'welcomed',
  installId: 'installId',
  helloDay: 'helloDay',
} as const

/**
 * The plugin's version for the daily hello. The module reads no files, so
 * this is kept equal to `version` in .claude-plugin/plugin.json by hand.
 */
export const VERSION = '0.3.0'

/** One hello may take this long: it runs inside session start. */
export const HELLO_TIMEOUT_MS = 3_000

/** What the server accepts as an install id. */
export const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/

/**
 * A fresh random install id: a UUID where the runtime has one, else 16
 * random bytes in hex, else Math.random. Not a secret: it only has to be
 * unlikely to collide.
 */
export function newInstallId(): string {
  try {
    const id = crypto.randomUUID()

    if (INSTALL_ID.test(id)) return id
  } catch {
    // no randomUUID here: try the next source
  }

  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16))

    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    // no crypto at all
  }

  let id = ''

  while (id.length < 32) id += Math.random().toString(36).slice(2)

  return id.slice(0, 32)
}

/** The UTC day of a clock reading, `YYYY-MM-DD`, or null when it is not a time. */
export function dayOf(ms: number): string | null {
  const date = new Date(ms)

  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null
}

/** The surface the hello reports. */
export type HelloSurface = 'terminal' | 'desktop' | 'unknown'

export const PANE_ID = 'hamtana'

/** The server allows one ad request per device per 10 s. */
export const MIN_FETCH_GAP_MS = 10_000

/** First backoff after a failed request; doubles up to the cap. */
export const BACKOFF_MS = 15_000

export const BACKOFF_CAP_MS = 10 * 60_000

/** Wait after `ad: null` when the server names no retryAfterMs. */
export const NO_AD_RETRY_MS = 60_000

/** One more try of an impression report that never reached the server. */
export const IMPRESSION_RETRY_MS = 5_000

/** Stop asking for ads in a turn that has run this long without ending. */
export const MAX_TURN_MS = 2 * 60 * 60_000

export type Flow =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'waiting'; start: DeviceStart; expiresAt: number; intervalMs: number }
  | { kind: 'expired' }
  | { kind: 'failed' }

export type MeState =
  | { kind: 'none' }
  | { kind: 'loading'; last: Me | null }
  | { kind: 'ok'; me: Me }
  | { kind: 'failed'; last: Me | null }

type Turn = { id: string; seq: number; startedAt: number | null }

type Shown = {
  ad: Ad
  seq: number
  shownSince: number | null
  dwell: Timer | null
  rotate: Timer | null
  isReported: boolean
}

/** What the band draws: an ad, the link invite, or nothing. */
export type BandView = { kind: 'ad'; ad: Ad } | { kind: 'invite' } | null

/** Everything the pane draws. */
export type PaneModel = {
  base: string | null
  isLinked: boolean
  isPaused: boolean
  user: Profile | null
  me: MeState
  flow: Flow
  ad: Ad | null
}

const parseHebrew = (value: unknown): HebrewMode =>
  value === 'reverse' || value === 'plain' ? value : 'auto'

/** The plugin options as the app uses them. */
export function settingsOf(options: Readonly<Record<string, unknown>>): Settings {
  return {
    base: serverBaseOf(options.serverUrl ?? 'https://hamtana.oronai.co.il'),
    hebrew: parseHebrew(options.terminalHebrew),
  }
}

export type App = ReturnType<typeof createApp>

export function createApp(settings: Settings) {
  let host: Host | null = null

  let token: string | null = null
  let isPaused = false
  let user: Profile | null = null

  let hasSeenBand = false
  let isInviteDone = false
  /** The surface the session draws on, once a band or session start named one. */
  let seenSurface: 'terminal' | 'desktop' | null = null
  let isHelloing = false

  let turn: Turn | null = null
  let turnSeq = 0
  let shown: Shown | null = null

  let isFetching = false
  let fetchTimer: Timer | null = null
  let nextFetchAt = 0
  let lastFetchAt = Number.NEGATIVE_INFINITY
  let failures = 0

  let flow: Flow = { kind: 'idle' }
  let flowGen = 0
  let pollTimer: Timer | null = null

  let me: MeState = { kind: 'none' }

  const debug = (text: string) => {
    try {
      host?.debug(text)
    } catch {
      // the debug log is best effort
    }
  }

  const redraw = () => {
    try {
      host?.invalidate()
    } catch {
      // a redraw is best effort
    }
  }

  const later = (ms: number, fn: () => void): Timer | null => {
    try {
      return host ? host.after(ms, fn) : null
    } catch (error) {
      debug(`timer refused: ${String(error)}`)

      return null
    }
  }

  const nowOr = async (fallback: number): Promise<number> => {
    try {
      return host ? await host.now() : fallback
    } catch {
      return fallback
    }
  }

  const storeGet = async (key: string): Promise<unknown> => {
    try {
      return host ? await host.storeGet(key) : undefined
    } catch (error) {
      debug(`store.get ${key} failed: ${String(error)}`)

      return undefined
    }
  }

  const storeSet = async (key: string, value: unknown) => {
    try {
      await host?.storeSet(key, value)
    } catch (error) {
      debug(`store.set ${key} failed: ${String(error)}`)
    }
  }

  const storeDelete = async (key: string) => {
    try {
      await host?.storeDelete(key)
    } catch (error) {
      debug(`store.delete ${key} failed: ${String(error)}`)
    }
  }

  const request = (
    path: string,
    options: { token?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<CallResult> => {
    if (!host || !settings.base) {
      return Promise.resolve({ kind: 'network', reason: 'no server' })
    }

    return call(host, settings.base + path, options)
  }

  /** Reads the link and pause state another session may have changed. */
  async function load(): Promise<void> {
    const [storedToken, storedPaused, storedUser] = await Promise.all([
      storeGet(KEYS.token),
      storeGet(KEYS.paused),
      storeGet(KEYS.user),
    ])

    token = typeof storedToken === 'string' && storedToken !== '' ? storedToken : null
    isPaused = storedPaused === true
    user = profileOf(storedUser) ?? user
  }

  // ---- the ad on screen ---------------------------------------------------

  function dropShown(): void {
    if (!shown) return

    shown.dwell?.cancel()
    shown.rotate?.cancel()
    shown = null
  }

  function stopFetching(): void {
    fetchTimer?.cancel()
    fetchTimer = null
  }

  const isTurnLive = (seq: number) =>
    turn !== null &&
    turn.seq === seq &&
    token !== null &&
    !isPaused &&
    settings.base !== null &&
    hasSeenBand

  function schedule(seq: number, ms: number): void {
    stopFetching()
    fetchTimer = later(Math.max(0, ms), () => {
      fetchTimer = null
      void pump(seq)
    })
  }

  function backoff(now: number): number {
    failures += 1

    const wait = Math.min(BACKOFF_MS * 2 ** (failures - 1), BACKOFF_CAP_MS)

    nextFetchAt = now + wait

    return wait
  }

  /**
   * Asks for the next ad when the turn may have one and the rate rules
   * allow it now; otherwise schedules itself for when they do.
   */
  async function pump(seq: number): Promise<void> {
    if (isFetching || fetchTimer || !isTurnLive(seq)) return

    isFetching = true

    try {
      const now = await nowOr(0)
      const startedAt = turn?.startedAt ?? now

      if (now - startedAt > MAX_TURN_MS) return

      const wait = Math.max(nextFetchAt - now, lastFetchAt + MIN_FETCH_GAP_MS - now)

      if (wait > 0) {
        schedule(seq, wait)

        return
      }

      lastFetchAt = now

      // house=1: with no campaign to serve, the server answers Hamtana's own line instead of ad: null
      const result = await request(`/api/mod/ad?surface=${seenSurface ?? 'terminal'}&house=1`, {
        token: token ?? '',
      })

      if (!isTurnLive(seq)) return

      await onAdResult(seq, result, now)
    } catch (error) {
      debug(`ad request threw: ${String(error)}`)
    } finally {
      isFetching = false

      if (turn && turn.seq !== seq && !fetchTimer) void pump(turn.seq)
    }
  }

  async function onAdResult(seq: number, result: CallResult, now: number) {
    if (result.kind === 'http' && result.status === 401) {
      await signOut(true)

      return
    }

    if (result.kind === 'http' && result.status === 429) {
      const wait = clamp(result.retryAfterMs ?? MIN_FETCH_GAP_MS, MIN_FETCH_GAP_MS, BACKOFF_CAP_MS)

      nextFetchAt = now + wait
      schedule(seq, wait)

      return
    }

    const answer = result.kind === 'ok' ? adAnswerOf(result.body) : null

    if (!answer) {
      const why =
        result.kind === 'network'
          ? result.reason
          : `HTTP ${result.status}${result.kind === 'ok' ? ' (unexpected body)' : ''}`

      const wait = backoff(now)

      debug(`ad request failed (${why}); next try in ${wait} ms`)
      schedule(seq, wait)

      return
    }

    failures = 0

    if (answer.kind === 'none') {
      const wait = clamp(answer.retryAfterMs ?? NO_AD_RETRY_MS, MIN_FETCH_GAP_MS, 6 * 60 * 60_000)

      nextFetchAt = now + wait
      dropShown()
      redraw()
      debug(`no ad (${answer.reason}); next ask in ${wait} ms`)
      schedule(seq, wait)

      return
    }

    dropShown()

    const next: Shown = {
      ad: answer.ad,
      seq,
      shownSince: null,
      dwell: null,
      rotate: null,
      isReported: false,
    }

    // A house message rotates like an ad, so a real ad replaces it as soon as one runs
    next.rotate = later(answer.ad.rotateMs, () => {
      next.rotate = null

      if (shown === next) void pump(seq)
    })

    if (answer.ad.isHouse) debug(`house message; next ask in ${answer.ad.rotateMs} ms`)

    shown = next
    redraw()
  }

  /**
   * The ad was drawn: start its dwell clock unless it is already running.
   * A house message has no dwell: it is never reported.
   */
  function markDrawn(current: Shown): void {
    if (current.ad.isHouse || current.isReported || current.dwell) return

    current.shownSince = null
    current.dwell = later(current.ad.minDwellMs, () => {
      current.dwell = null
      void onDwell(current)
    })

    void nowOr(0).then(now => {
      if (current.dwell && current.shownSince === null) current.shownSince = now
    })
  }

  /** The ad was not drawn this time: its continuous dwell starts over. */
  function markHidden(): void {
    if (!shown || shown.isReported) return

    shown.dwell?.cancel()
    shown.dwell = null
    shown.shownSince = null
  }

  async function onDwell(current: Shown): Promise<void> {
    if (shown !== current || current.ad.isHouse || current.isReported || !isTurnLive(current.seq)) return

    current.isReported = true

    const now = await nowOr(0)
    const since = current.shownSince ?? now - current.ad.minDwellMs
    const dwellMs = Math.max(current.ad.minDwellMs, Math.round(now - since))

    await report(current.ad, dwellMs, true)
  }

  async function report(ad: Ad, dwellMs: number, mayRetry: boolean): Promise<void> {
    const deviceToken = token

    // a house message is never an impression: it has no serve token to send
    if (!deviceToken || ad.isHouse || ad.serveToken === '') return

    const result = await request('/api/mod/impression', {
      token: deviceToken,
      body: { token: ad.serveToken, dwellMs },
    })

    if (result.kind === 'http' && result.status === 401) {
      await signOut(true)

      return
    }

    if (result.kind === 'network') {
      debug(`impression not sent (${result.reason})`)

      if (mayRetry) {
        later(IMPRESSION_RETRY_MS, () => void report(ad, dwellMs, false))
      }

      return
    }

    if (result.kind === 'http') {
      debug(`impression refused: HTTP ${result.status} ${errorCodeOf(result.body) ?? ''}`)

      return
    }

    const isCounted = (result.body as { counted?: unknown } | undefined)?.counted === true

    if (!isCounted) {
      // invalid_token, already_counted, expired, dwell_too_short, daily_cap,
      // too_soon, budget, ...: the server's call, nothing to show the person
      debug(`impression not counted: ${String((result.body as { reason?: unknown } | undefined)?.reason ?? 'unknown')}`)

      return
    }

    if (me.kind === 'ok') {
      const todayMicros = numberField(result.body, 'todayMicros')
      const impressionsToday = numberField(result.body, 'impressionsToday')

      me = {
        kind: 'ok',
        me: {
          ...me.me,
          ...(todayMicros === undefined ? {} : { todayMicros }),
          ...(impressionsToday === undefined ? {} : { impressionsToday }),
        },
      }

      redraw()
    }
  }

  // ---- turns ---------------------------------------------------------------

  async function turnStarted(turnId: string): Promise<void> {
    turnSeq += 1

    const seq = turnSeq

    dropShown()
    stopFetching()
    turn = { id: turnId, seq, startedAt: null }

    const now = await nowOr(0)

    if (turn?.seq === seq) turn.startedAt = now

    await load()

    if (turn?.seq === seq) await pump(seq)
  }

  function turnEnded(): void {
    turnSeq += 1
    turn = null
    dropShown()
    stopFetching()
    isInviteDone = true
    redraw()
  }

  // ---- the band ------------------------------------------------------------

  /**
   * Decides what the band shows for one render: the ad while a turn runs,
   * the invite once while unlinked, or nothing. Tracks dwell as it goes.
   */
  function band(props: { hasSurvey: boolean; isWorking: boolean }, surface: RenderSurface): BandView {
    hasSeenBand = true
    noteSurface(surface)

    if (props.hasSurvey) {
      markHidden()

      return null
    }

    const current = shown
    const canShowAd = current !== null && token !== null && !isPaused && props.isWorking && isTurnLive(current.seq)

    if (current && canShowAd) {
      markDrawn(current)

      return { kind: 'ad', ad: current.ad }
    }

    markHidden()

    const canInvite = token === null && !isInviteDone && settings.base !== null && flow.kind === 'idle'

    return canInvite ? { kind: 'invite' } : null
  }

  function dismissInvite(): void {
    isInviteDone = true
    redraw()
  }

  /** Remembers the surface a band or session start named, when it is one ads go to. */
  function noteSurface(surface: RenderSurface | null | undefined): void {
    if (surface === 'terminal' || surface === 'desktop') seenSurface = surface
  }

  // ---- the daily hello -------------------------------------------------------

  /** The stored install id, or a new one saved for next time. */
  async function installId(): Promise<string> {
    const stored = await storeGet(KEYS.installId)

    if (typeof stored === 'string' && INSTALL_ID.test(stored)) return stored

    const fresh = newInstallId()

    await storeSet(KEYS.installId, fresh)

    return fresh
  }

  /**
   * At most once a day per machine, linked or not: tells the server this
   * install is active. Anonymous: no device token, only a random install id,
   * the plugin version and the surface. The day is stored once the server
   * answered (any status); a network failure tries again next session.
   */
  async function hello(surface?: RenderSurface | null): Promise<void> {
    noteSurface(surface)

    if (isHelloing || !host || !settings.base) return

    isHelloing = true

    try {
      const day = dayOf(await nowOr(Number.NaN))

      if (day === null || (await storeGet(KEYS.helloDay)) === day) return

      const body: { installId: string; version: string; surface: HelloSurface } = {
        installId: await installId(),
        version: VERSION,
        surface: seenSurface ?? 'unknown',
      }

      // no token on purpose: the hello stays anonymous even on a linked device
      const result = await request('/api/mod/hello', { body, timeoutMs: HELLO_TIMEOUT_MS })

      if (result.kind === 'network') {
        debug(`hello not sent (${result.reason})`)

        return
      }

      if (result.kind === 'http') debug(`hello refused: HTTP ${result.status} ${errorCodeOf(result.body) ?? ''}`)

      await storeSet(KEYS.helloDay, day)
    } catch (error) {
      debug(`hello threw: ${String(error)}`)
    } finally {
      isHelloing = false
    }
  }

  // ---- linking ---------------------------------------------------------------

  function stopPolling(): void {
    pollTimer?.cancel()
    pollTimer = null
  }

  async function startLink(): Promise<Flow> {
    flowGen += 1

    const gen = flowGen

    stopPolling()
    isInviteDone = true

    if (!settings.base) {
      flow = { kind: 'failed' }
      redraw()

      return flow
    }

    flow = { kind: 'starting' }
    redraw()

    const result = await request('/api/device/start', {
      body: { label: 'Claude Code' },
      timeoutMs: 10_000,
    })

    if (gen !== flowGen) return flow

    const start = result.kind === 'ok' ? deviceStartOf(result.body) : null

    if (!start) {
      debug(`device start failed: ${result.kind === 'network' ? result.reason : `HTTP ${result.status}`}`)
      flow = { kind: 'failed' }
      redraw()

      return flow
    }

    const now = await nowOr(0)

    flow = {
      kind: 'waiting',
      start,
      expiresAt: now + clamp(start.expiresInSec, 30, 3600) * 1000,
      intervalMs: clamp(start.intervalSec * 1000, 2_000, 60_000),
    }

    redraw()
    schedulePoll(gen)

    return flow
  }

  function schedulePoll(gen: number): void {
    if (flow.kind !== 'waiting') return

    stopPolling()
    pollTimer = later(flow.intervalMs, () => {
      pollTimer = null
      void poll(gen)
    })
  }

  async function poll(gen: number): Promise<void> {
    if (gen !== flowGen || flow.kind !== 'waiting') return

    const waiting = flow
    const now = await nowOr(0)

    if (now >= waiting.expiresAt) {
      flow = { kind: 'expired' }
      redraw()

      return
    }

    const result = await request('/api/device/poll', {
      body: { deviceCode: waiting.start.deviceCode },
      timeoutMs: 10_000,
    })

    if (gen !== flowGen || flow !== waiting) return

    if (result.kind === 'ok') {
      const answer = devicePollOf(result.body)

      if (answer?.status === 'approved') {
        await linked(answer.token, answer.user)

        return
      }

      if (answer?.status === 'expired') {
        flow = { kind: 'expired' }
        redraw()

        return
      }
    } else if (result.kind === 'http' && (result.status === 429 || errorCodeOf(result.body) === 'rate_limited')) {
      flow = { ...waiting, intervalMs: Math.min(waiting.intervalMs + 5_000, 60_000) }
    } else if (result.kind === 'http' && result.status >= 400 && result.status < 500) {
      debug(`device poll refused: HTTP ${result.status}`)
      flow = { kind: 'failed' }
      redraw()

      return
    } else {
      debug(`device poll failed: ${result.kind === 'network' ? result.reason : `HTTP ${result.status}`}`)
    }

    schedulePoll(gen)
  }

  async function linked(newToken: string, profile: Profile | null): Promise<void> {
    flowGen += 1
    stopPolling()
    flow = { kind: 'idle' }
    token = newToken
    user = profile ?? user
    isInviteDone = true

    await storeSet(KEYS.token, newToken)

    if (profile) await storeSet(KEYS.user, profile)

    try {
      host?.toast(S.TOAST_LINKED)
    } catch {
      // a toast is best effort
    }

    redraw()
    void refreshMe()

    if (turn) void pump(turn.seq)
  }

  function cancelLink(): void {
    flowGen += 1
    stopPolling()
    flow = { kind: 'idle' }
    redraw()
  }

  // ---- account -----------------------------------------------------------------

  async function signOut(isExpired: boolean): Promise<void> {
    const wasLinked = token !== null

    token = null
    user = null
    me = { kind: 'none' }
    dropShown()
    stopFetching()

    await storeDelete(KEYS.token)
    await storeDelete(KEYS.user)

    if (isExpired && wasLinked) {
      try {
        host?.toast(S.TOAST_SIGNED_OUT)
      } catch {
        // a toast is best effort
      }
    }

    redraw()
  }

  async function unlink(): Promise<void> {
    const deviceToken = token

    await signOut(false)

    if (deviceToken) {
      const result = await request('/api/mod/unlink', { token: deviceToken, body: {} })

      if (result.kind !== 'ok') debug('unlink did not reach the server; the token is gone locally')
    }
  }

  async function refreshMe(): Promise<Me | null> {
    if (!token) return null

    const last = me.kind === 'ok' ? me.me : me.kind === 'none' ? null : me.last

    me = { kind: 'loading', last }
    redraw()

    const result = await request('/api/mod/me', { token })

    if (result.kind === 'http' && result.status === 401) {
      await signOut(true)

      return null
    }

    if (result.kind !== 'ok') {
      me = { kind: 'failed', last }
      redraw()

      return null
    }

    const fresh = meOf(result.body)

    me = { kind: 'ok', me: fresh }

    if (fresh.user) {
      user = fresh.user
      await storeSet(KEYS.user, fresh.user)
    }

    redraw()

    return fresh
  }

  async function setPaused(value: boolean): Promise<void> {
    isPaused = value
    await storeSet(KEYS.paused, value)

    if (value) {
      dropShown()
      stopFetching()
    } else if (turn) {
      void pump(turn.seq)
    }

    redraw()
  }

  // ---- /hamtana as text ------------------------------------------------------

  function statusLines(data: Me | null): string[] {
    const profile = data?.user ?? user
    const lines = [S.linkedAs(profile?.name ?? '', profile?.email ?? '')]

    if (data) {
      lines.push(
        `${S.today(shekels(data.todayMicros))} · ${S.balances(shekels(data.pendingMicros), shekels(data.availableMicros))}`,
        `${S.impressions(count(data.impressionsToday), count(data.dailyCap))} · ${isPaused ? S.ADS_OFF : S.ADS_ON}`,
      )
    } else {
      lines.push(isPaused ? S.ADS_OFF : S.ADS_ON, S.TEXT_REFRESH_FAILED)
    }

    return lines
  }

  async function statusText(): Promise<string> {
    await load()

    if (!settings.base) return S.BAD_SERVER

    if (!token) {
      return flow.kind === 'waiting'
        ? S.textLogin(flow.start.userCode, flow.start.verifyUrlComplete)
        : S.TEXT_UNLINKED
    }

    return statusLines(await refreshMe()).join('\n')
  }

  async function canDraw(): Promise<boolean> {
    try {
      const surfaces = host ? await host.surfaces() : []

      return surfaces.some(surface => surface === 'terminal' || surface === 'desktop')
    } catch {
      return false
    }
  }

  async function openPane(): Promise<void> {
    try {
      await host?.openPane()
    } catch (error) {
      debug(`pane did not open: ${String(error)}`)
    }

    if (token) void refreshMe()
  }

  /**
   * First session after install, while unlinked: open the pane once so the
   * "התחברות" button is in sight. Marked done only once the pane was placed.
   */
  async function welcome(): Promise<void> {
    if (token !== null || settings.base === null) return
    if ((await storeGet(KEYS.welcomed)) === true) return
    if (!(await canDraw())) return

    try {
      const placed = await host?.openWelcome()

      if (!placed || placed.isPlaced === false) return
    } catch (error) {
      debug(`welcome pane did not open: ${String(error)}`)

      return
    }

    await storeSet(KEYS.welcomed, true)
  }

  /** `/hamtana [word]`: opens the pane where one draws, else answers in text. */
  async function command(args: string): Promise<{ text?: string }> {
    const word = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()

    switch (word) {
      case '': {
        await load()

        if (await canDraw()) {
          await openPane()

          return {}
        }

        return { text: await statusText() }
      }
      case 'status':
        return { text: await statusText() }
      case 'pause':
        await setPaused(true)

        return { text: S.TEXT_PAUSED }
      case 'resume':
        await setPaused(false)

        return { text: S.TEXT_RESUMED }
      case 'logout':
      case 'unlink': {
        await load()

        if (!token) return { text: S.TEXT_NOT_LINKED_LOGOUT }

        await unlink()

        return { text: S.TEXT_LOGGED_OUT }
      }
      case 'login':
      case 'link': {
        await load()

        if (!settings.base) return { text: S.BAD_SERVER }

        if (token) return { text: S.TEXT_ALREADY_LINKED }

        const started = await startLink()

        return started.kind === 'waiting'
          ? { text: S.textLogin(started.start.userCode, started.start.verifyUrlComplete) }
          : { text: S.FLOW_FAILED }
      }
      default:
        return { text: S.TEXT_HELP }
    }
  }

  return {
    settings,
    bind(next: Host) {
      host = next
    },
    load,
    turnStarted,
    turnEnded,
    band,
    dismissInvite,
    hello,
    welcome,
    open: openPane,
    startLink,
    cancelLink,
    unlink,
    refreshMe,
    setPaused,
    command,
    pane(): PaneModel {
      return {
        base: settings.base,
        isLinked: token !== null,
        isPaused,
        user,
        me,
        flow,
        // a house message stays in the band: the pane shows only a real ad
        ad: shown && !shown.ad.isHouse && turn && shown.seq === turn.seq ? shown.ad : null,
      }
    },
  }
}
