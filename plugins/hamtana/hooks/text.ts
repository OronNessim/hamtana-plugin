/**
 * Small pure helpers: cleaning untrusted text, money, links and the server
 * address. Nothing here touches `$`.
 */

/** Control characters, bidi controls, zero-width and line separators. */
const UNSAFE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/gu

/**
 * Untrusted server text as one safe line: control, bidi-control and
 * zero-width characters become spaces, runs of space collapse, and the
 * result is cut to `max` code points (an ellipsis marks a cut).
 */
export function cleanLine(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''

  const line = input.replace(UNSAFE, ' ').replace(/\s+/gu, ' ').trim()
  const points = Array.from(line)

  if (points.length <= max) return line

  return points.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…'
}

/** The ad text the server sends, at most 60 characters on one line. */
export const AD_TEXT_MAX = 60

/** The advertiser's name, kept shorter so the band stays one line. */
export const ADVERTISER_MAX = 40

/** A person's name or email from the server, for the pane. */
export const PROFILE_MAX = 80

const pad2 = (value: number) => String(value).padStart(2, '0')

/**
 * Integer micro-shekels as shekels with two decimals: 12_340_000 → `₪12.34`.
 * Anything that is not a finite number shows as `—`.
 */
export function shekels(micros: unknown): string {
  if (typeof micros !== 'number' || !Number.isFinite(micros)) return '—'

  const agorot = Math.round(Math.abs(micros) / 10_000)
  const whole = Math.floor(agorot / 100)
  const sign = micros < 0 && agorot > 0 ? '-' : ''
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `${sign}₪${grouped}.${pad2(agorot % 100)}`
}

/** A whole number for display, or `—`. */
export function count(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.trunc(value))
    : '—'
}

const isLocalHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

/**
 * A URL the `Link` element accepts, or null: https (or http on localhost),
 * no user info, printable ASCII, at most 2048 characters, spelled as
 * `new URL(href).href`. Anything else would refuse the whole drawing.
 */
export function safeHref(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048) return null

  let url: URL

  try {
    url = new URL(input)
  } catch {
    return null
  }

  const isAllowedScheme =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLocalHost(url.hostname))

  const href = url.href

  const isClean =
    isAllowedScheme &&
    url.username === '' &&
    url.password === '' &&
    href.length <= 2048 &&
    /^[\x21-\x7E]+$/.test(href) &&
    !href.includes('@')

  return isClean ? href : null
}

/**
 * The server address from the plugin option: an https origin (or http on
 * localhost for development) with any trailing slash removed, or null.
 */
export function serverBaseOf(option: unknown): string | null {
  const href = safeHref(option)

  if (!href) return null

  const url = new URL(href)

  if (url.search !== '' || url.hash !== '') return null

  return href.replace(/\/+$/, '')
}

/** The host part of a URL for a short link label, or the URL itself. */
export function hostOf(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href
  }
}

/** Reads a field of an unknown JSON value. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** A finite number field, or undefined. */
export function numberField(value: unknown, key: string): number | undefined {
  const found = field(value, key)

  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}

/** A string field, or undefined. */
export function stringField(value: unknown, key: string): string | undefined {
  const found = field(value, key)

  return typeof found === 'string' ? found : undefined
}

/** Clamps a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
