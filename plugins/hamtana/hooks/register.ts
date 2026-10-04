/**
 * Hamtana (המתנה): one short Hebrew ad above the prompt while Claude works,
 * for developers who linked an account. This file is the whole surface the
 * mod touches in Claude Code: every `$` call it makes is in `hostOf` below
 * or in a hook here, so `claude plugin validate` lists all of them.
 *
 * It reads no files, runs no processes, reads no environment variables and
 * never sees prompts, answers or tool calls: `turn.start` and
 * `turn.complete` are used only for when a turn starts and ends.
 */

import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import { createApp, type Host, PANE_ID, settingsOf } from './app'
import * as S from './strings'
import * as Views from './views'

/** The host the app runs on, built from the `$` a hook receives. */
function hostOf($: EngineInterface): Host {
  return {
    fetch: (url, init) => $.http.fetch(url, init),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: key => $.store.delete(key),
    invalidate: () => $.ui.invalidate('ui.render'),
    toast: text => $.ui.toast(text),
    debug: text => $.ui.log(text, { to: 'debug' }),
    openPane: () =>
      $.ui.open({ id: PANE_ID, title: S.PANE_TITLE, focus: true, closeOnEscape: true }),
    // The host only accepts focus true or left out (2.1.287 refuses focus: false), so the one-time
    // welcome takes focus too; Escape closes it.
    openWelcome: () => $.ui.open({ id: PANE_ID, title: S.PANE_TITLE, closeOnEscape: true }),
    surfaces: () => $.session.surfaces(),
  }
}

/** Reordering applies only on the terminal, and only when asked for. */
const layoutOf = (
  surface: RenderSurface,
  hebrew: 'auto' | 'reverse' | 'plain',
  columns: number,
): Views.Layout => ({
  isVisual: surface === 'terminal' && hebrew === 'reverse',
  columns,
})

export const register: Register = (on, options) => {
  const app = createApp(settingsOf(options))

  on('session.start', async ($, e, next) => {
    try {
      app.bind(hostOf($))
      await app.load()
      // Awaited: the hook context ($) is only valid while this handler runs, so a detached call
      // never reached the host. welcome() is local only (store, surfaces, ui.open), so this is quick.
      await app.welcome().catch(() => undefined)
    } catch (error) {
      $.ui.log(`hamtana: start failed: ${String(error)}`, { to: 'debug' })
    }

    try {
      await $.command.register({
        name: 'hamtana',
        description: S.COMMAND_DESCRIPTION,
        argumentHint: S.COMMAND_HINT,
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`hamtana: /hamtana not registered: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    try {
      app.bind(hostOf($))
      void app.turnStarted(e.turnId).catch(() => undefined)
    } catch {
      // never in the way of a turn
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined) app.turnEnded()
    } catch {
      // never in the way of a turn
    }

    return next(e)
  })

  on('command.run', { command: 'hamtana' }, async ($, e) => {
    try {
      app.bind(hostOf($))

      return await app.command(e.args)
    } catch (error) {
      $.ui.log(`hamtana: command failed: ${String(error)}`, { to: 'debug' })

      return { text: S.TEXT_HELP }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      app.bind(hostOf($))

      const view = app.band(e.props, e.surface)

      if (!view) return next(e)

      const ui = $.ui.resolve(e)
      const layout = layoutOf(e.surface, app.settings.hebrew, e.props.bodyColumns)

      const ours =
        view.kind === 'ad'
          ? Views.adBand(ui, layout, view.ad)
          : Views.inviteBand(ui, layout, () => void app.open(), () => app.dismissInvite())

      return ui.Box({ flexDirection: 'column', children: [ours, await next(e)] })
    } catch (error) {
      $.ui.log(`hamtana: band not drawn: ${String(error)}`, { to: 'debug' })

      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: 'hamtana' }, async ($, e, next) => {
    try {
      app.bind(hostOf($))

      const ui = $.ui.resolve(e)
      const layout = layoutOf(e.surface, app.settings.hebrew, e.props.bodyColumns)

      return Views.pane(ui, layout, app.pane(), {
        link: () => void app.startLink(),
        cancelLink: () => app.cancelLink(),
        togglePause: () => void app.setPaused(!app.pane().isPaused),
        unlink: () => void app.unlink(),
        refresh: () => void app.refreshMe(),
      })
    } catch (error) {
      $.ui.log(`hamtana: pane not drawn: ${String(error)}`, { to: 'debug' })

      return next(e)
    }
  })
}
