/**
 * The drawings: the band above the prompt (an ad or the link invite) and the
 * /hamtana pane. Pure functions from a model to an element tree; the element
 * constructors come from `$.ui.resolve(e)` in register.ts.
 */

import type { Elements, RenderElement } from 'claude-code'

import type { Ad } from './api'
import type { PaneModel } from './app'
import { visualOrder } from './bidi'
import * as S from './strings'
import { count, hostOf, safeHref, shekels } from './text'

/** The elements every drawing here uses; the same on terminal and desktop. */
export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link'>

/**
 * How Hebrew is laid out on this surface: `isVisual` reorders each string
 * for a terminal without bidi and lays rows out right to left.
 */
export type Layout = { isVisual: boolean; columns: number }

const textOf = (layout: Layout, value: string) =>
  layout.isVisual ? visualOrder(value) : value

const rowOf = (ui: Ui, layout: Layout, children: RenderElement[], gap = 1) =>
  ui.Box({
    flexDirection: layout.isVisual ? 'row-reverse' : 'row',
    flexWrap: 'wrap',
    columnGap: gap,
    children,
  })

const columnOf = (ui: Ui, layout: Layout, children: RenderElement[]) =>
  ui.Box({
    flexDirection: 'column',
    alignItems: layout.isVisual ? 'flex-end' : 'flex-start',
    children,
  })

/**
 * Cuts logical text into lines of at most `width` characters at spaces, so
 * each line can be reordered on its own (a reordered line must not wrap).
 */
export function linesOf(value: string, width: number): string[] {
  const limit = Math.max(10, width)
  const lines: string[] = []
  let line = ''

  for (const word of value.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`

    if (Array.from(candidate).length <= limit || line === '') {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line !== '') lines.push(line)

  return lines
}

/** A paragraph: one wrapping Text, or pre-cut reordered lines. */
function paragraph(
  ui: Ui,
  layout: Layout,
  value: string,
  style: { dimColor?: boolean; bold?: boolean } = {},
): RenderElement {
  if (!layout.isVisual) return ui.Text({ ...style, children: [value] })

  return columnOf(
    ui,
    layout,
    linesOf(value, layout.columns - 2).map(line =>
      ui.Text({ ...style, children: [visualOrder(line)] }),
    ),
  )
}

// ---- the band ------------------------------------------------------------------

/**
 * The dim ad label the server chose ("מודעה" or "דרושים · מודעה"), or
 * "המתנה" on a house message, one Text that is ordered like every other
 * Hebrew string here. The band row wraps and nothing is measured against
 * it, so a longer label only moves where the row breaks: it never shortens
 * the ad text, which has its own cap.
 */
const adLabel = (ui: Ui, layout: Layout, ad: Ad) =>
  ui.Text({ dimColor: true, children: [textOf(layout, ad.label)] })

/**
 * One ad: the dim label, the text, the advertiser, and its link. A house
 * message has the same layout, but its text is dim too, in the neutral tone
 * of the invite (the band's other non-ad line), so it never reads as a paid
 * ad. The same on terminal and desktop.
 */
export function adBand(ui: Ui, layout: Layout, ad: Ad): RenderElement {
  const parts: RenderElement[] = [
    adLabel(ui, layout, ad),
    ui.Text({ ...(ad.isHouse ? { dimColor: true } : {}), children: [textOf(layout, ad.text)] }),
  ]

  if (ad.advertiser !== '') {
    parts.push(
      ui.Text({
        dimColor: true,
        children: [textOf(layout, `· ${ad.advertiser}`)],
      }),
    )
  }

  if (ad.url) {
    parts.push(ui.Link({ href: ad.url, label: textOf(layout, S.AD_LINK) }))
  }

  return rowOf(ui, layout, parts)
}

/** The invite to link an account: a button that opens the pane, and one that hides it. */
export function inviteBand(
  ui: Ui,
  layout: Layout,
  onOpen: () => void,
  onDismiss: () => void,
): RenderElement {
  return rowOf(ui, layout, [
    ui.Text({ dimColor: true, children: [textOf(layout, S.INVITE)] }),
    ui.Button({ key: 'hamtana-open', label: textOf(layout, S.INVITE_BUTTON), onPress: onOpen }),
    ui.Button({ key: 'hamtana-dismiss', label: '×', plain: true, role: 'dismiss', onPress: onDismiss }),
  ])
}

// ---- the pane ------------------------------------------------------------------

export type PaneActions = {
  link: () => void
  cancelLink: () => void
  togglePause: () => void
  unlink: () => void
  refresh: () => void
}

function button(
  ui: Ui,
  layout: Layout,
  key: string,
  label: string,
  onPress: () => void,
  extra: { isPrimary?: boolean } = {},
): RenderElement {
  return ui.Button({
    key,
    label: textOf(layout, label),
    onPress,
    ...(extra.isPrimary ? { variant: 'primary' as const, autoFocus: true as const } : {}),
  })
}

function unlinkedBody(ui: Ui, layout: Layout, model: PaneModel, actions: PaneActions): RenderElement[] {
  const { flow } = model

  switch (flow.kind) {
    case 'starting':
      return [paragraph(ui, layout, S.FLOW_STARTING, { dimColor: true })]

    case 'waiting': {
      const href = safeHref(flow.start.verifyUrlComplete)

      return [
        paragraph(ui, layout, S.FLOW_CODE),
        ui.Text({
          bold: true,
          inverse: true,
          children: [` ${flow.start.userCode} `],
        }),
        paragraph(ui, layout, S.FLOW_OPEN),
        href
          ? ui.Link({ href, label: textOf(layout, `${S.FLOW_OPEN_LINK} · ${hostOf(href)}`) })
          : ui.Text({ children: [flow.start.verifyUrlComplete] }),
        paragraph(ui, layout, S.FLOW_WAITING, { dimColor: true }),
        rowOf(ui, layout, [button(ui, layout, 'hamtana-cancel', S.FLOW_CANCEL, actions.cancelLink)]),
      ]
    }

    case 'expired':
    case 'failed':
      return [
        paragraph(ui, layout, flow.kind === 'expired' ? S.FLOW_EXPIRED : S.FLOW_FAILED),
        rowOf(ui, layout, [
          button(ui, layout, 'hamtana-link', S.RETRY, actions.link, { isPrimary: true }),
        ]),
      ]

    case 'idle':
      return [
        paragraph(ui, layout, S.WELCOME_TITLE, { bold: true }),
        ...S.WELCOME_STEPS.map(step => paragraph(ui, layout, step)),
        rowOf(ui, layout, [
          button(ui, layout, 'hamtana-link', S.LINK_BUTTON, actions.link, { isPrimary: true }),
        ]),
      ]
  }
}

function linkedBody(ui: Ui, layout: Layout, model: PaneModel, actions: PaneActions): RenderElement[] {
  const { me } = model
  const data = me.kind === 'ok' ? me.me : me.kind === 'none' ? null : me.last
  const profile = data?.user ?? model.user
  const lines: RenderElement[] = [
    paragraph(ui, layout, S.linkedAs(profile?.name ?? '', profile?.email ?? ''), { bold: true }),
  ]

  if (data) {
    lines.push(
      paragraph(ui, layout, S.today(shekels(data.todayMicros))),
      paragraph(ui, layout, S.balances(shekels(data.pendingMicros), shekels(data.availableMicros))),
      paragraph(ui, layout, S.impressions(count(data.impressionsToday), count(data.dailyCap))),
    )
  }

  if (me.kind === 'loading') lines.push(paragraph(ui, layout, S.LOADING, { dimColor: true }))

  if (me.kind === 'failed') lines.push(paragraph(ui, layout, S.ME_FAILED, { dimColor: true }))

  lines.push(paragraph(ui, layout, model.isPaused ? S.ADS_OFF : S.ADS_ON, { dimColor: true }))

  const dashboard =
    safeHref(data?.dashboardUrl) ?? (model.base ? safeHref(`${model.base}/dashboard`) : null)

  const controls: RenderElement[] = [
    button(ui, layout, 'hamtana-pause', model.isPaused ? S.RESUME : S.PAUSE, actions.togglePause, {
      isPrimary: true,
    }),
    button(ui, layout, 'hamtana-refresh', S.REFRESH, actions.refresh),
    button(ui, layout, 'hamtana-unlink', S.UNLINK, actions.unlink),
  ]

  lines.push(rowOf(ui, layout, controls, 2))

  if (dashboard) {
    lines.push(ui.Link({ href: dashboard, label: textOf(layout, `${S.DASHBOARD} · ${hostOf(dashboard)}`) }))
  }

  return lines
}

/** The /hamtana pane for the current state. */
export function pane(ui: Ui, layout: Layout, model: PaneModel, actions: PaneActions): RenderElement {
  const children: RenderElement[] = [
    paragraph(ui, layout, S.PANE_INTRO, { dimColor: true }),
  ]

  if (model.ad) {
    children.push(
      rowOf(ui, layout, [
        adLabel(ui, layout, model.ad),
        ui.Text({ children: [textOf(layout, model.ad.text)] }),
      ]),
    )
  }

  if (!model.base) {
    children.push(paragraph(ui, layout, S.BAD_SERVER))
  } else if (model.isLinked) {
    children.push(...linkedBody(ui, layout, model, actions))
  } else {
    children.push(...unlinkedBody(ui, layout, model, actions))
  }

  children.push(paragraph(ui, layout, S.PRIVACY, { dimColor: true }))

  return ui.Box({
    flexDirection: 'column',
    alignItems: layout.isVisual ? 'flex-end' : 'flex-start',
    rowGap: 1,
    children,
  })
}
