/**
 * The Hamtana server API as docs/CONTRACT.md defines it, over the host's
 * fetch. Every call has a timeout and never throws: it resolves to a result
 * the caller switches on. Response bodies are untrusted and checked field by
 * field.
 */

import type { HttpInit, HttpResponse, Timer } from 'claude-code'

import * as S from './strings'
import {
  AD_TEXT_MAX,
  ADVERTISER_MAX,
  clamp,
  cleanLine,
  field,
  numberField,
  PROFILE_MAX,
  safeHref,
  stringField,
} from './text'

/** What the API needs from the host: fetch and a one-shot timer. */
export type Net = {
  fetch: (url: string, init: HttpInit) => Promise<HttpResponse>
  after: (ms: number, fn: () => void) => Timer
}

/** How long one request may take before it counts as failed. */
export const TIMEOUT_MS = 8_000

export type CallResult =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'http'; status: number; body: unknown; retryAfterMs?: number }
  | { kind: 'network'; reason: string }

const TIMED_OUT = Symbol('timed-out')

function withTimeout<T>(
  net: Net,
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    let timer: Timer | null = null

    try {
      timer = net.after(ms, () => resolve(TIMED_OUT))
    } catch {
      timer = null
    }

    work.then(
      value => {
        timer?.cancel()
        resolve(value)
      },
      (error: unknown) => {
        timer?.cancel()
        reject(error)
      },
    )
  })
}

function parseBody(text: string): unknown {
  if (text.trim() === '') return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** retryAfterMs from the body (top level or under error), or Retry-After. */
export function retryAfterOf(
  body: unknown,
  headers: Record<string, string> | undefined,
): number | undefined {
  const fromBody =
    numberField(body, 'retryAfterMs') ??
    numberField(field(body, 'error'), 'retryAfterMs')

  if (fromBody !== undefined) return fromBody

  const seconds = Number(headers?.['retry-after'])

  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/**
 * One JSON request: `POST` when a body is given, `GET` otherwise, with the
 * device token as a Bearer header when there is one.
 */
export async function call(
  net: Net,
  url: string,
  options: { token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { accept: 'application/json' }

  if (options.token) headers.authorization = `Bearer ${options.token}`

  const init: HttpInit =
    options.body === undefined
      ? { method: 'GET', headers }
      : {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
        }

  try {
    const response = await withTimeout(
      net,
      net.fetch(url, init),
      options.timeoutMs ?? TIMEOUT_MS,
    )

    if (response === TIMED_OUT) return { kind: 'network', reason: 'timeout' }

    const body = parseBody(typeof response.text === 'string' ? response.text : '')

    if (response.ok) return { kind: 'ok', status: response.status, body }

    const retryAfterMs = retryAfterOf(body, response.headers)

    return retryAfterMs === undefined
      ? { kind: 'http', status: response.status, body }
      : { kind: 'http', status: response.status, body, retryAfterMs }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    return { kind: 'network', reason: reason.slice(0, 200) }
  }
}

/** The error code of a non-2xx answer (`unauthorized`, `rate_limited`, ...). */
export const errorCodeOf = (body: unknown): string | undefined =>
  stringField(field(body, 'error'), 'code')

export type Profile = { name: string; email: string }

export function profileOf(value: unknown): Profile | null {
  const name = cleanLine(field(value, 'name'), PROFILE_MAX)
  const email = cleanLine(field(value, 'email'), PROFILE_MAX)

  return name === '' && email === '' ? null : { name, email }
}

export type DeviceStart = {
  deviceCode: string
  userCode: string
  verifyUrl: string
  verifyUrlComplete: string
  intervalSec: number
  expiresInSec: number
}

/** `POST /api/device/start`'s answer, or null when it does not fit. */
export function deviceStartOf(body: unknown): DeviceStart | null {
  const deviceCode = stringField(body, 'deviceCode')
  const userCode = cleanLine(field(body, 'userCode'), 16)
  const verifyUrl = stringField(body, 'verifyUrl') ?? ''
  const verifyUrlComplete = stringField(body, 'verifyUrlComplete') ?? verifyUrl
  const intervalSec = numberField(body, 'intervalSec') ?? 5
  const expiresInSec = numberField(body, 'expiresInSec') ?? 600

  if (!deviceCode || userCode === '') return null

  return {
    deviceCode,
    userCode,
    verifyUrl,
    verifyUrlComplete,
    intervalSec,
    expiresInSec,
  }
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; user: Profile | null }

/** `POST /api/device/poll`'s answer, or null when it does not fit. */
export function devicePollOf(body: unknown): DevicePoll | null {
  const status = stringField(body, 'status')

  if (status === 'pending' || status === 'expired') return { status }

  if (status === 'approved') {
    const token = stringField(body, 'token')

    if (!token || token.length > 512 || !/^[\x21-\x7E]+$/.test(token)) {
      return null
    }

    return { status, token, user: profileOf(field(body, 'user')) }
  }

  return null
}

export type Me = {
  user: Profile | null
  todayMicros?: number
  pendingMicros?: number
  availableMicros?: number
  impressionsToday?: number
  dailyCap?: number
  dashboardUrl?: string
}

/** `GET /api/mod/me`'s answer. */
export function meOf(body: unknown): Me {
  const me: Me = { user: profileOf(field(body, 'user')) }

  const numbers = [
    'todayMicros',
    'pendingMicros',
    'availableMicros',
    'impressionsToday',
    'dailyCap',
  ] as const

  for (const key of numbers) {
    const value = numberField(body, key)

    if (value !== undefined) me[key] = value
  }

  const dashboardUrl = stringField(body, 'dashboardUrl')

  if (dashboardUrl !== undefined) me.dashboardUrl = dashboardUrl

  return me
}

/**
 * The only labels the band may draw, each carrying the ad marking
 * "מודעה". The server picks one; nothing else it sends is ever shown there.
 */
export const AD_LABELS = [S.AD_LABEL, S.AD_LABEL_JOBS] as const

export type AdLabel = (typeof AD_LABELS)[number]

/**
 * The label the server sent for an ad: cleaned like every other field, then
 * accepted only when it equals an allowed label exactly. Missing (an older
 * server), wrong, long or spoofed all give the default "מודעה".
 */
export function adLabelOf(value: unknown): AdLabel {
  const cleaned = cleanLine(value, 40)

  return AD_LABELS.find(label => label === cleaned) ?? S.AD_LABEL
}

/** One ad as the band draws it, cleaned. */
export type Ad = {
  serveId: string
  /** "מודעה", or "דרושים · מודעה" for a job ad. Always holds "מודעה". */
  label: AdLabel
  text: string
  /** The click-tracking link, or null when it is not a safe https URL. */
  url: string | null
  advertiser: string
  /** The single-use serve token the impression report sends back. */
  serveToken: string
  minDwellMs: number
  rotateMs: number
}

export type AdAnswer =
  | { kind: 'ad'; ad: Ad }
  | { kind: 'none'; reason: string; retryAfterMs?: number }

export const DEFAULT_MIN_DWELL_MS = 10_000

export const DEFAULT_ROTATE_MS = 30_000

/** `GET /api/mod/ad`'s answer, or null when it does not fit the contract. */
export function adAnswerOf(body: unknown): AdAnswer | null {
  const raw = field(body, 'ad')

  if (raw === null) {
    const reason = cleanLine(field(body, 'reason'), 40) || 'none'
    const retryAfterMs = numberField(body, 'retryAfterMs')

    return retryAfterMs === undefined
      ? { kind: 'none', reason }
      : { kind: 'none', reason, retryAfterMs }
  }

  const serveId = stringField(raw, 'serveId')
  const serveToken = stringField(body, 'token')
  const text = cleanLine(field(raw, 'text'), AD_TEXT_MAX)

  if (!serveId || !serveToken || text === '') return null

  return {
    kind: 'ad',
    ad: {
      serveId,
      label: adLabelOf(field(raw, 'label')),
      text,
      url: safeHref(field(raw, 'url')),
      advertiser: cleanLine(field(raw, 'advertiser'), ADVERTISER_MAX),
      serveToken,
      minDwellMs: clamp(
        numberField(body, 'minDwellMs') ?? DEFAULT_MIN_DWELL_MS,
        1_000,
        120_000,
      ),
      rotateMs: clamp(
        numberField(body, 'rotateMs') ?? DEFAULT_ROTATE_MS,
        10_000,
        600_000,
      ),
    },
  }
}
