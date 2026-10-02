import { describe, expect, test } from 'claude-code/testing'

import { adAnswerOf, devicePollOf, retryAfterOf } from '../hooks/api'
import { cleanLine, safeHref, serverBaseOf, shekels } from '../hooks/text'
import { linesOf } from '../hooks/views'

const char = (code: number) => String.fromCharCode(code)

describe('text', () => {
  test('shekels from micros, two decimals', () => {
    expect(shekels(12_340_000)).toBe('₪12.34')
    expect(shekels(0)).toBe('₪0.00')
    expect(shekels(5_000)).toBe('₪0.01')
    expect(shekels(1_234_567_890)).toBe('₪1,234.57')
    expect(shekels(-2_500_000)).toBe('-₪2.50')
    expect(shekels(undefined)).toBe('—')
    expect(shekels(Number.NaN)).toBe('—')
  })

  test('cleanLine strips controls, bidi overrides and newlines, and caps', () => {
    const dirty = ' a\nb\tc' + char(0x202e) + 'd' + char(0x200b) + 'e' + char(0x07) + ' '

    expect(cleanLine(dirty, 60)).toBe('a b c d e')
    expect(cleanLine('x'.repeat(61), 60)).toBe('x'.repeat(59) + '…')
    expect(Array.from(cleanLine('א'.repeat(100), 60))).toHaveLength(60)
    expect(cleanLine(42, 60)).toBe('')
  })

  test('safeHref keeps https only, as the Link element needs it', () => {
    expect(safeHref('https://hamtana.oronai.co.il/c/abc')).toBe('https://hamtana.oronai.co.il/c/abc')
    expect(safeHref('http://localhost:8787/c/abc')).toBe('http://localhost:8787/c/abc')
    expect(safeHref('http://example.com/')).toBeNull()
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('https://user:pw@example.com/')).toBeNull()
    expect(safeHref('not a url')).toBeNull()
    expect(safeHref(7)).toBeNull()
  })

  test('the server option must be an https origin', () => {
    expect(serverBaseOf('https://hamtana.oronai.co.il/')).toBe('https://hamtana.oronai.co.il')
    expect(serverBaseOf('http://localhost:8787')).toBe('http://localhost:8787')
    expect(serverBaseOf('http://hamtana.oronai.co.il')).toBeNull()
    expect(serverBaseOf('https://x.test/?a=1')).toBeNull()
  })

  test('an ad answer is checked field by field', () => {
    const answer = adAnswerOf({
      ad: { serveId: 's', text: 'טקסט', url: 'https://x.test/c/s', advertiser: 'מפרסם' },
      token: 't',
      minDwellMs: 500,
      rotateMs: 9_999_999,
    })

    expect(answer).toMatchObject({ kind: 'ad', ad: { minDwellMs: 1_000, rotateMs: 600_000 } })
    expect(adAnswerOf({ ad: { serveId: 's', text: '' }, token: 't' })).toBeNull()
    expect(adAnswerOf({ ad: { serveId: 's', text: 'x' } })).toBeNull()
    expect(adAnswerOf({ ad: null, reason: 'daily_cap', retryAfterMs: 5 })).toEqual({
      kind: 'none',
      reason: 'daily_cap',
      retryAfterMs: 5,
    })
    expect(adAnswerOf('nonsense')).toBeNull()
  })

  test('a poll answer must carry a clean token', () => {
    expect(devicePollOf({ status: 'pending' })).toEqual({ status: 'pending' })
    expect(devicePollOf({ status: 'approved', token: 'bad token' })).toBeNull()
    expect(devicePollOf({ status: 'approved', token: 'hmt_x', user: { name: 'a', email: 'b' } })).toEqual({
      status: 'approved',
      token: 'hmt_x',
      user: { name: 'a', email: 'b' },
    })
  })

  test('retryAfterMs is read from the body or the Retry-After header', () => {
    expect(retryAfterOf({ retryAfterMs: 1234 }, {})).toBe(1234)
    expect(retryAfterOf({ error: { code: 'rate_limited', retryAfterMs: 99 } }, {})).toBe(99)
    expect(retryAfterOf(undefined, { 'retry-after': '3' })).toBe(3000)
    expect(retryAfterOf(undefined, {})).toBeUndefined()
  })

  test('lines are cut at spaces before reordering', () => {
    expect(linesOf('אחת שתיים שלוש ארבע', 10)).toEqual(['אחת שתיים', 'שלוש ארבע'])
    expect(linesOf('קצר', 40)).toEqual(['קצר'])
  })
})
