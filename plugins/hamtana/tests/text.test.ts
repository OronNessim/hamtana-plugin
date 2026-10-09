import { describe, expect, test } from 'claude-code/testing'

import { AD_LABELS, adAnswerOf, adLabelOf, devicePollOf, retryAfterOf } from '../hooks/api'
import { dayOf, INSTALL_ID, newInstallId } from '../hooks/app'
import * as S from '../hooks/strings'
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

  describe('ad label', () => {
    const labelOfAnswer = (label: unknown) => {
      const answer = adAnswerOf({
        ad: { serveId: 's', text: 'טקסט', label },
        token: 't',
      })

      return answer?.kind === 'ad' ? answer.ad.label : undefined
    }

    test('the two allowed labels are spelled out and both carry the ad marking', () => {
      expect(S.AD_LABEL).toBe('מודעה')
      expect(S.AD_LABEL_JOBS).toBe('דרושים · מודעה')
      expect(S.AD_LABEL_JOBS.includes(S.AD_LABEL)).toBe(true)
    })

    test('a valid job label is kept', () => {
      expect(labelOfAnswer('דרושים · מודעה')).toBe('דרושים · מודעה')
      expect(labelOfAnswer('מודעה')).toBe('מודעה')
    })

    test('a missing label (an older server) is the plain ad label', () => {
      expect(labelOfAnswer(undefined)).toBe('מודעה')

      const answer = adAnswerOf({ ad: { serveId: 's', text: 'טקסט' }, token: 't' })

      expect(answer).toMatchObject({ kind: 'ad', ad: { label: 'מודעה' } })
    })

    test('junk, long and spoofed labels fall back to the plain ad label', () => {
      const spoofs: unknown[] = [
        '',
        '   ',
        'דרושים',
        'דרושים ·',
        'משרה',
        'ממומן',
        'מבצע',
        'דרושים · מודעה · לחצו כאן עכשיו',
        'דרושים · מודעה'.repeat(10),
        'דרושים - מודעה',
        'דרושים מודעה',
        'מודעה · דרושים',
        'דרושים  ·  מודעה!',
        'דרושים · מודעה.',
        'דרושים · ' + 'מודעה'.slice(0, 3) + String.fromCharCode(0x200b) + 'עה',
        'דרושים · מוד' + String.fromCharCode(0x0430) + 'עה',
        '<b>דרושים · מודעה</b>',
        'Jobs · Ad',
        'job',
        42,
        true,
        null,
        ['דרושים · מודעה'],
        { label: 'דרושים · מודעה' },
      ]

      for (const spoof of spoofs) {
        expect(labelOfAnswer(spoof), JSON.stringify(spoof)).toBe('מודעה')
      }
    })

    test('the label is cleaned like other fields before it is compared', () => {
      const bidi = String.fromCharCode(0x200f)

      expect(labelOfAnswer(' דרושים · מודעה\n')).toBe('דרושים · מודעה')
      expect(labelOfAnswer('דרושים' + bidi + ' · מודעה')).toBe('דרושים · מודעה')
    })

    test('a paid ad can never carry the house label "המתנה"', () => {
      expect(S.HOUSE_LABEL).toBe('המתנה')
      expect(labelOfAnswer('המתנה')).toBe('מודעה')
      expect(labelOfAnswer(' המתנה ')).toBe('מודעה')
      expect(adLabelOf('המתנה')).toBe('מודעה')
      expect((AD_LABELS as readonly string[]).includes('המתנה')).toBe(false)

      const answer = adAnswerOf({ ad: { serveId: 's', text: 'טקסט', label: 'המתנה' }, token: 't' })

      expect(answer).toMatchObject({ kind: 'ad', ad: { isHouse: false, label: 'מודעה', serveToken: 't' } })
    })

    test('whatever the server sends, the label holds the ad marking', () => {
      const inputs: unknown[] = [undefined, null, 1, '', 'x', 'דרושים', 'דרושים · מודעה', 'מודעה', 'a'.repeat(5_000)]

      for (const input of inputs) {
        expect(adLabelOf(input).includes('מודעה'), JSON.stringify(input)).toBe(true)
      }
    })
  })

  describe('house message', () => {
    const house = (ad: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) => ({
      ad: {
        serveId: 'house',
        text: 'רוצים לפרסם כאן?',
        url: 'https://hamtana.oronai.co.il/?ref=house#advertisers',
        advertiser: '',
        label: 'המתנה',
        house: true,
        ...ad,
      },
      token: null,
      minDwellMs: 10_000,
      rotateMs: 60_000,
      ...rest,
    })

    test('the house answer parses with no serve token', () => {
      expect(adAnswerOf(house())).toEqual({
        kind: 'ad',
        ad: {
          serveId: 'house',
          isHouse: true,
          label: 'המתנה',
          text: 'רוצים לפרסם כאן?',
          url: 'https://hamtana.oronai.co.il/?ref=house#advertisers',
          advertiser: '',
          serveToken: '',
          minDwellMs: 10_000,
          rotateMs: 60_000,
        },
      })
    })

    test('a house message is always labelled "המתנה", whatever the server sends', () => {
      const labels: unknown[] = [undefined, null, '', 'מודעה', 'דרושים · מודעה', 'ממומן', 42, 'המתנה · מודעה']

      for (const label of labels) {
        const answer = adAnswerOf(house({ label }))

        expect(answer?.kind === 'ad' ? answer.ad.label : undefined, JSON.stringify(label)).toBe('המתנה')
      }
    })

    test('a token sent with a house message is dropped, so it can never be reported', () => {
      expect(adAnswerOf(house({}, { token: 'leaked' }))).toMatchObject({
        kind: 'ad',
        ad: { isHouse: true, serveToken: '' },
      })
    })

    test('house needs both house: true and serveId "house"; otherwise it is a paid ad or nothing', () => {
      expect(adAnswerOf(house({ house: 'true' })), 'no token, so not a paid ad either').toBeNull()
      expect(adAnswerOf(house({ serveId: 'serve-1' })), 'house: true alone is not enough').toBeNull()
      expect(adAnswerOf(house({ house: undefined }, { token: 't' }))).toMatchObject({
        kind: 'ad',
        ad: { isHouse: false, label: 'מודעה', serveToken: 't' },
      })
    })

    test('house text is cleaned and capped, an empty one is refused, a bad link dropped', () => {
      expect(adAnswerOf(house({ text: '' }))).toBeNull()
      expect(adAnswerOf(house({ text: 42 }))).toBeNull()

      const long = adAnswerOf(house({ text: 'א'.repeat(80) + '\n', url: 'javascript:alert(1)' }))

      expect(long?.kind === 'ad' ? Array.from(long.ad.text).length : 0).toBe(60)
      expect(long).toMatchObject({ kind: 'ad', ad: { url: null } })
    })

    test('paid ads are marked as not house', () => {
      expect(adAnswerOf({ ad: { serveId: 's', text: 'טקסט' }, token: 't' })).toMatchObject({
        kind: 'ad',
        ad: { isHouse: false },
      })
    })

    test('the other "none" answers are unchanged', () => {
      for (const reason of ['paused', 'daily_cap', 'country', 'banned', 'no_campaigns']) {
        expect(adAnswerOf({ ad: null, reason, retryAfterMs: 60_000 })).toEqual({
          kind: 'none',
          reason,
          retryAfterMs: 60_000,
        })
      }
    })
  })

  test('install ids are random and fit the server rule', () => {
    const ids = Array.from({ length: 20 }, () => newInstallId())

    for (const id of ids) {
      expect(INSTALL_ID.test(id), id).toBe(true)
    }

    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the hello day is the UTC date', () => {
    expect(dayOf(0)).toBe('1970-01-01')
    expect(dayOf(Date.UTC(2026, 9, 9, 23, 59))).toBe('2026-10-09')
    expect(dayOf(Number.NaN)).toBeNull()
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
