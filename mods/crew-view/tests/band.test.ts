// Board JSON -> band text, and the band drawn through the plugin.
import { describe, expect, test } from 'claude-code/testing'

import { bandSegments, bandText, columns, parseBoard } from '../hooks/crew'
import { BAND_PROPS, HOME, XO_WORLD, boardJson, install, startXo } from './world'

function board(over: Record<string, unknown> = {}) {
  const parsed = parseBoard(boardJson(over))
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.board
}

const FULL = '⚓ 🏃 3 · 🙋 3 [shop] 108a, [billing] 9c1e, [inbox] i-7f3a · ✅ 1'

describe('bandText', () => {
  test('one emoji per lane, with counts, naming the project of every item that needs the commander', () => {
    expect(bandText(board(), 200)).toBe(FULL)
  })

  test('cuts the needs-you list to the width with +N more, never mid-item', () => {
    expect(bandText(board(), 45)).toBe('⚓ 🏃 3 · 🙋 3 [shop] 108a, +2 more · ✅ 1')
    expect(bandText(board(), 20)).toBe('⚓ 🏃 3 · 🙋 3 +3 more · ✅ 1')
  })

  test('counts emoji as two columns, so the band never overflows its width', () => {
    expect(columns('⚓')).toBe(2)
    expect(columns('🙋 3')).toBe(4)
    expect(columns('✅❌💤🏃')).toBe(8)
    expect(columns('⏸️')).toBe(1) // text-default base plus VS16: why the band does not use it
    expect(columns(FULL)).toBe([...FULL].length + 4)
    expect(bandText(board(), columns(FULL))).toBe(FULL)
    expect(bandText(board(), columns(FULL) - 1)).toBe('⚓ 🏃 3 · 🙋 3 [shop] 108a, [billing] 9c1e, +1 more · ✅ 1')
    const floor = columns(bandText(board(), 0))
    for (let width = floor; width <= 120; width++) expect(columns(bandText(board(), width))).toBeLessThanOrEqual(width)
  })

  test("uses an inbox item's project when the board carries one", () => {
    const b = board()
    const inbox = b.needs_you[2]!
    b.needs_you = [{ ...inbox, project: 'legal' }]
    expect(bandText(b, 200)).toBe('⚓ 🏃 3 · 🙋 1 [legal] i-7f3a · ✅ 1')
  })

  test('failed items leave the needs-you list for their own lane, as in the pane', () => {
    const b = board()
    b.needs_you = [...b.needs_you, { ...b.needs_you[0]!, short_id: 'dead', state: 'failed' }]
    const segs = bandSegments(b, 200)
    expect(segs.map(s => s.text).join('')).toBe(`${FULL} · ❌ 1`)
    expect(segs.at(-1)).toEqual({ text: '❌ 1', tone: 'error' })
  })

  test('shows on hold only when there is some, and an idle crew as idle', () => {
    const empty = { needs_you: [], in_progress: [], on_hold: [], ready: [], recent: [] }
    expect(bandText(board({ lanes: empty }), 100)).toBe('⚓ crew idle')
    const held = JSON.parse(boardJson()).lanes.in_progress[0]
    expect(bandText(board({ lanes: { ...empty, on_hold: [held] } }), 100)).toBe('⚓ 💤 1')
  })

  test('unreadable output is an error line, not a throw', () => {
    expect(parseBoard('chartroom: no home')).toEqual({ error: 'chartroom board: unreadable output' })
  })
})

test('the band draws the board once the XO loads the skill, with a crew button', async ($, on) => {
  const w = install(on, XO_WORLD())
  await startXo($)
  await w.clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'crew-view', surface, component: 'AbovePrompt', props: BAND_PROPS(120) })
    const line = await ui.find({ type: 'Text', text: /🙋/ })
    expect(line?.text).toBe(FULL)
    expect(await ui.find({ type: 'Button', key: 'open' })).toBeDefined()
    await ui.unmount()
  }
})

test('a missing chartroom shows a dim error line and never throws', async ($, on) => {
  const world = XO_WORLD()
  world.board = () => 'missing'
  const w = install(on, world)
  await startXo($)
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
  await startXo($)
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(120) })
  expect((await ui.find({ type: 'Text', text: /failed/ }))?.text).toBe('⚓ chartroom board failed: no chartroom home at /x')
})
