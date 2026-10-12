// The /crew pane: lanes in order, one row per item, sized to the pane.
import { expect, test } from 'claude-code/testing'

import { columns, fit, paneLines, parseBoard } from '../hooks/crew'
import { PANE_PROPS, XO_WORLD, boardJson, install, startXo } from './world'

const NOW = Date.parse('2026-10-12T15:12:30Z')

test('paneLines: lanes in order, rows as [project] id title state age, fitted to the width', () => {
  const parsed = parseBoard(boardJson())
  if ('error' in parsed) throw new Error(parsed.error)
  const lines = paneLines(parsed.board, 72, NOW).map(l => l.text)
  expect(lines.filter(l => !l.startsWith(' '))).toEqual([
    '🙋 needs you · 🏃 running · 💤 on hold · ✅ landed · ❌ failed',
    '🙋 NEEDS YOU (3)',
    '🏃 RUNNING (3)',
    '✅ LANDED (1)',
  ])
  expect(lines[2]).toMatch(/^ {2}\[shop\] {6}108a {3}Auth project-manager +decision {2}3d$/)
  expect(lines[3]).toMatch(/\[billing\] +9c1e .* blocked +12m$/)
  for (const l of lines) expect(columns(l)).toBeLessThanOrEqual(72)
})

test('/crew opens the pane and it draws the board', async ($, on) => {
  const w = install(on, XO_WORLD())
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  await startXo($)
  const ran = await $.command.run({ command: 'crew', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  expect(ran.text).toBe('Crew pane opened.')
  expect(opened).toEqual(['crew'])
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'Pane', requestId: 'crew', props: PANE_PROPS(90) })
  expect(await ui.find({ type: 'Text', text: /^🙋 needs you · 🏃 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '🙋 NEEDS YOU (3)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[chartroom\] 98e2 +Live crew view mod/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /updated 15:12:30Z/ })).toBeDefined()
})

test('fit pads or cuts a title to exact columns, emoji counted as two', () => {
  expect(fit('ship 🚀 it', 12)).toBe('ship 🚀 it  ')
  expect(columns(fit('🚀🚀🚀🚀', 6))).toBe(6)
  expect(fit('🚀🚀🚀🚀', 6)).toBe('🚀🚀… ')
})
