/**
 * Visual reordering for terminals that draw every cell left to right (no
 * bidi), where logical-order Hebrew shows up backwards.
 *
 * A deliberately small model, not the full Unicode Bidirectional Algorithm:
 * a line that holds any right-to-left letter is an RTL line; it is cut into
 * runs, LTR runs (Latin letters and digits, with the spaces and punctuation
 * between them, and a currency sign or % glued to a number) and RTL runs
 * (everything else). The visual line is the runs in reverse order, each RTL
 * run reversed character by character (combining marks kept on their base)
 * with its brackets mirrored, each LTR run kept as is.
 *
 * A line with no RTL letter is returned unchanged.
 */

const RTL_LETTER =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/u

const LTR_STRONG = /[\p{L}\p{N}]/u

const DIGIT = /\p{Nd}/u

const JOINS_PREVIOUS = /[\p{M}\u200D\uFE0E\uFE0F]/u

const NUMBER_PREFIXES = new Set(['₪', '$', '€', '£', '+', '-', '#'])

const NUMBER_SUFFIXES = new Set(['%', '₪'])

const MIRRORED: Readonly<Record<string, string>> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
  '‹': '›',
  '›': '‹',
}

type Run = { isLtr: boolean; clusters: string[] }

/** True when the text holds at least one right-to-left letter. */
export function hasRtl(text: string): boolean {
  return RTL_LETTER.test(text)
}

/** Splits text into clusters: a code point and the marks that ride on it. */
function clustersOf(line: string): string[] {
  const clusters: string[] = []

  for (const point of Array.from(line)) {
    const last = clusters.length - 1

    if (last >= 0 && JOINS_PREVIOUS.test(point)) {
      clusters[last] += point
    } else {
      clusters.push(point)
    }
  }

  return clusters
}

const isRtl = (cluster: string) => RTL_LETTER.test(cluster)

const isLtrStrong = (cluster: string) =>
  !isRtl(cluster) && LTR_STRONG.test(cluster)

/** Marks, per cluster, whether it belongs to an LTR run. */
function ltrMaskOf(clusters: readonly string[]): boolean[] {
  const mask = clusters.map(isLtrStrong)
  let lastStrong: 'ltr' | 'rtl' | null = null
  let pendingFrom = -1

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index] ?? ''

    if (isLtrStrong(cluster)) {
      if (lastStrong === 'ltr' && pendingFrom >= 0) {
        for (let fill = pendingFrom; fill < index; fill += 1) mask[fill] = true
      }

      lastStrong = 'ltr'
      pendingFrom = -1
    } else if (isRtl(cluster)) {
      lastStrong = 'rtl'
      pendingFrom = -1
    } else if (pendingFrom < 0) {
      pendingFrom = index
    }
  }

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index] ?? ''
    const next = clusters[index + 1] ?? ''
    const previous = clusters[index - 1] ?? ''

    const isSign = cluster === '+' || cluster === '-'

    const isPrefix =
      !mask[index] &&
      NUMBER_PREFIXES.has(cluster) &&
      DIGIT.test(next) &&
      !(isSign && isRtl(previous))

    const isSuffix =
      !mask[index] && NUMBER_SUFFIXES.has(cluster) && DIGIT.test(previous)

    if (isPrefix || isSuffix) mask[index] = true
  }

  return mask
}

function runsOf(clusters: readonly string[]): Run[] {
  const mask = ltrMaskOf(clusters)
  const runs: Run[] = []

  clusters.forEach((cluster, index) => {
    const isLtr = mask[index] === true
    const current = runs[runs.length - 1]

    if (current && current.isLtr === isLtr) {
      current.clusters.push(cluster)
    } else {
      runs.push({ isLtr, clusters: [cluster] })
    }
  })

  return runs
}

const mirrorOf = (cluster: string) => MIRRORED[cluster] ?? cluster

/** Reorders one line (no line breaks) from logical to visual order. */
function visualLine(line: string): string {
  if (!hasRtl(line)) return line

  return runsOf(clustersOf(line))
    .reverse()
    .map(run =>
      run.isLtr
        ? run.clusters.join('')
        : [...run.clusters].reverse().map(mirrorOf).join(''),
    )
    .join('')
}

/**
 * Logical order to visual order, line by line, for a surface that has no
 * bidi of its own. Text without RTL letters comes back unchanged.
 *
 * @example visualOrder('שלום world') === 'world םולש'
 */
export function visualOrder(text: string): string {
  if (!hasRtl(text)) return text

  return text.split('\n').map(visualLine).join('\n')
}
