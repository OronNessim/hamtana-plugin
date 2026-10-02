import { describe, expect, test } from 'claude-code/testing'

import { hasRtl, visualOrder } from '../hooks/bidi'

const mark = (code: number) => String.fromCharCode(code)

describe('bidi', () => {
  test('text with no Hebrew is unchanged', () => {
    expect(visualOrder('Claude Code 2.1')).toBe('Claude Code 2.1')
    expect(visualOrder('ABCD-2345')).toBe('ABCD-2345')
    expect(visualOrder('')).toBe('')
    expect(hasRtl('hello')).toBe(false)
    expect(hasRtl('שלום')).toBe(true)
  })

  test('a Hebrew run is reversed character by character', () => {
    expect(visualOrder('שלום')).toBe('םולש')
    expect(visualOrder('שלום עולם')).toBe('םלוע םולש')
  })

  test('Latin runs keep their order and the runs swap', () => {
    expect(visualOrder('שלום world')).toBe('world םולש')
    expect(visualOrder('תודה Claude Code!')).toBe('!Claude Code הדות')
    expect(visualOrder('בזמן ש-Claude עובד')).toBe('דבוע Claude-ש ןמזב')
  })

  test('numbers stay intact, with their currency sign and percent', () => {
    expect(visualOrder('יש 12 מודעות')).toBe('תועדומ 12 שי')
    expect(visualOrder('היום: ₪12.34')).toBe('₪12.34 :םויה')
    expect(visualOrder('הנחה 15% היום')).toBe('םויה 15% החנה')
    expect(visualOrder('חשיפות היום: 7 מתוך 300')).toBe('300 ךותמ 7 :םויה תופישח')
  })

  test('brackets are mirrored inside Hebrew runs', () => {
    expect(visualOrder('(שלום)')).toBe('(םולש)')
    expect(visualOrder('בדוק (Code) עכשיו')).toBe('וישכע (Code) קודב')
    expect(visualOrder('[חדש] קורס')).toBe('סרוק [שדח]')
  })

  test('niqqud stays on its letter', () => {
    const shalom = 'ש' + mark(0x5c1) + mark(0x5b8) + 'ל' + 'ו' + mark(0x5b9) + 'ם'
    const reversed = 'ם' + 'ו' + mark(0x5b9) + 'ל' + 'ש' + mark(0x5c1) + mark(0x5b8)

    expect(visualOrder(shalom)).toBe(reversed)
  })

  test('a minus after a Hebrew letter is not a sign', () => {
    expect(visualOrder('ה-5')).toBe('5-ה')
    expect(visualOrder('יתרה -5')).toBe('-5 הרתי')
  })

  test('each line is reordered on its own', () => {
    expect(visualOrder('שלום\nעולם')).toBe('םולש\nםלוע')
  })

  test('reordering twice gives the logical text back for plain Hebrew', () => {
    const line = 'מודעה קצרה בעברית'

    expect(visualOrder(visualOrder(line))).toBe(line)
  })
})
