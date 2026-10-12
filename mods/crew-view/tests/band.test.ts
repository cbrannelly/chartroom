// Board JSON -> band text, and the band drawn through the plugin.
import { describe, expect, test } from 'claude-code/testing'

import { bandText, parseBoard } from '../hooks/crew'
import { BAND_PROPS, HOME, XO_WORLD, boardJson, install } from './world'

function board(over: Record<string, unknown> = {}) {
  const parsed = parseBoard(boardJson(over))
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.board
}

describe('bandText', () => {
  test('names the project of every item that needs the commander', () => {
    expect(bandText(board(), 200)).toBe('⚓ 3 running · 3 need you: [shop] 108a, [billing] 9c1e, [inbox] i-7f3a · 1 landed')
  })

  test('cuts the needs-you list to the width with +N more, never mid-item', () => {
    expect(bandText(board(), 60)).toBe('⚓ 3 running · 3 need you: [shop] 108a, +2 more · 1 landed')
    expect(bandText(board(), 20)).toBe('⚓ 3 running · 3 need you: +3 more · 1 landed')
  })

  test("uses an inbox item's project when the board carries one", () => {
    const b = board()
    const inbox = b.needs_you[2]!
    b.needs_you = [{ ...inbox, project: 'legal' }]
    expect(bandText(b, 200)).toBe('⚓ 3 running · 1 needs you: [legal] i-7f3a · 1 landed')
  })

  test('shows on hold only when there is some, and an idle crew as idle', () => {
    const empty = { needs_you: [], in_progress: [], on_hold: [], ready: [], recent: [] }
    expect(bandText(board({ lanes: empty }), 100)).toBe('⚓ crew idle')
    const held = JSON.parse(boardJson()).lanes.in_progress[0]
    expect(bandText(board({ lanes: { ...empty, on_hold: [held] } }), 100)).toBe('⚓ 1 on hold')
  })

  test('unreadable output is an error line, not a throw', () => {
    expect(parseBoard('chartroom: no home')).toEqual({ error: 'chartroom board: unreadable output' })
  })
})

test('the band draws the board in the XO session, with a crew button', async ($, on) => {
  const w = install(on, XO_WORLD())
  await $.session.start({ cwd: `${HOME}/.captain`, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'crew-view', surface, component: 'AbovePrompt', props: BAND_PROPS(120) })
    const line = await ui.find({ type: 'Text', text: /need you/ })
    expect(line?.text).toBe('⚓ 3 running · 3 need you: [shop] 108a, [billing] 9c1e, [inbox] i-7f3a · 1 landed')
    expect(await ui.find({ type: 'Button', key: 'open' })).toBeDefined()
    await ui.unmount()
  }
})

test('a missing chartroom shows a dim error line and never throws', async ($, on) => {
  const world = XO_WORLD()
  world.board = () => 'missing'
  const w = install(on, world)
  await $.session.start({ cwd: `${HOME}/.captain`, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(w.runs).toEqual([['chartroom', 'board', '--json'], [`${HOME}/.local/bin/chartroom`, 'board', '--json']])
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(120) })
  const line = await ui.find({ type: 'Text', text: /chartroom/ })
  expect(line?.text).toBe('⚓ chartroom not found')
  expect(line?.props.dimColor).toBe(true)
})

test('a failing board run shows its first stderr line', async ($, on) => {
  const world = XO_WORLD()
  world.board = () => ({ exitCode: 1, stdout: '', stderr: 'chartroom: no chartroom home at /x\nmore' })
  const w = install(on, world)
  await $.session.start({ cwd: `${HOME}/.captain`, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(120) })
  expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toBe('⚓ chartroom board failed: no chartroom home at /x')
})
