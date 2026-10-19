// Closing the /crew pane: q, Esc (closeOnEscape), /crew as a toggle; /crew off hides the band.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND_PROPS, PANE_PROPS, XO_WORLD, install, startXo } from './world'

/** The XO awake, with the engine's pane record beneath: what opened, what closed, what is up. */
async function xo($: Engine, on: Parameters<typeof install>[0]) {
  const w = install(on, XO_WORLD())
  const opens: { id: string; focus?: true; closeOnEscape?: true }[] = []
  const closes: string[] = []
  let up = false
  on('ui.open', ($, e) => {
    opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape })
    up = true
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    closes.push(`${e.id}:${e.origin.kind}`)
    up = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: up ? [{ id: 'crew', title: 'Crew', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  await startXo($)
  await w.clock.settle()
  const crew = (args = '') => $.command.run({ command: 'crew', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  return { w, opens, closes, crew }
}

test('q closes the pane from the detail; the next open starts on the lanes, the ring on the row', async ($, on) => {
  const { opens, closes, crew } = await xo($, on)
  expect((await crew()).text).toBe('Crew pane opened.')
  // Esc closes it as the person's close does: the engine's closeOnEscape.
  expect(opens).toEqual([{ id: 'crew', focus: true, closeOnEscape: true }])
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'Pane', requestId: 'crew', props: PANE_PROPS(90) })
  const close = await ui.find({ type: 'Button', key: 'act-close' })
  expect([close?.props.label, close?.props.hotkey, close?.props.role]).toEqual(['close', 'q', 'dismiss'])
  expect((await ui.find({ key: 'row-108a' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'row-108a' })
  expect(await ui.find({ key: 'act-continue' })).toBeDefined()
  expect((await ui.find({ key: 'act-close' }))?.props.hotkey).toBe('q')
  await ui.press({ key: 'act-close' })
  expect(closes).toEqual(['crew:plugin'])
  expect(await ui.find({ key: 'act-continue' })).toBeUndefined()
  expect(await ui.find({ key: 'row-108a' })).toBeDefined()
  expect((await ui.find({ key: 'row-108a' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'row-4d10' }))?.props.autoFocus).toBeUndefined()
  // Closed from another item, the ring starts on that row next time.
  await ui.press({ key: 'row-4d10' })
  await ui.press({ key: 'act-close' })
  expect((await ui.find({ key: 'row-4d10' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'row-108a' }))?.props.autoFocus).toBeUndefined()
})

test('/crew toggles the pane; /crew <id> always opens', async ($, on) => {
  const { w, opens, closes, crew } = await xo($, on)
  await crew()
  expect((await crew()).text).toBe('Crew pane closed.')
  expect(closes).toEqual(['crew:plugin'])
  expect((await crew()).text).toBe('Crew pane opened.')
  expect((await crew('108a')).text).toBe('Crew pane opened.')
  expect(opens.length).toBe(3)
  expect(closes.length).toBe(1)
  await w.clock.settle()
})

test('/crew off hides the band and closes the pane; with /todo off too polling stops; /crew on brings it back', async ($, on) => {
  const { w, closes, crew } = await xo($, on)
  const band = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(120) })
  expect(await band.find({ type: 'Text', text: /^⚓/ })).toBeDefined()
  await crew()
  expect((await crew('off')).text).toBe('Crew band off for this session: /crew on brings it back; /crew still opens the pane.')
  expect(closes).toEqual(['crew:plugin'])
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^⚓/ })).toBeUndefined()
  // The todo list still reads the board: off too, nothing does.
  await $.command.run({ command: 'todo', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  const boards = () => w.runs.filter(r => r[1] === 'board').length
  const before = boards()
  await w.clock.advance(45_000)
  expect(boards()).toBe(before)
  // The pane still opens with the band off, and while it is up the board is read.
  await crew()
  await w.clock.advance(15_000)
  expect(boards()).toBeGreaterThan(before)
  expect((await crew('on')).text).toBe('Crew band on.')
  await w.clock.settle()
  expect(await band.find({ type: 'Text', text: /^⚓/ })).toBeDefined()
})
