// The commander's todo list: the band's rows under the crew line, the /todo pane and its keys,
// and how it follows focus mode without a restart.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseTodo, todoBandLines, todoText } from '../hooks/todo'
import { BAND_PROPS, HOME, PANE_PROPS, XO_WORLD, boardJson, focusedTodoJson, install, startXo, todoJson } from './world'
import type { World } from './world'

function list(todo: Record<string, unknown>) {
  const parsed = parseTodo(boardJson({ todo }))
  if (!parsed) throw new Error('no todo')
  return parsed
}

const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })

describe('todoBandLines', () => {
  test('the first three items, built-in todo style, then +N more; a breaking one in red', () => {
    const lines = todoBandLines(list(todoJson()), 80)
    expect(lines.map(l => l.text)).toEqual([
      '☐ [billing] 9c1e blocked: prod is down, need the DB password',
      '☐ [legal] i-7f3a sign the NDA by 2026-10-22 · due 10-22',
      '☐ [shop] 108a decide: pick A or B (recommend A)',
      '  +1 more',
    ])
    expect(lines.map(l => l.tone)).toEqual(['error', 'plain', 'plain', 'dim'])
  })

  test('while focus mode is on: only what it does not hold, and the held count', () => {
    const lines = todoBandLines(list(focusedTodoJson()), 80)
    expect(lines.map(l => l.text).at(-1)).toBe('  +1 more · 🎯 shop, legal, billing (IR-6) · 1 held')
    expect(lines.at(-1)?.tone).toBe('warn')
    expect(lines.some(l => l.text.includes('rotate the key'))).toBe(false)
  })

  test('nothing owed: no rows, unless focus is on, which says so with its held count', () => {
    expect(todoBandLines(list(todoJson({ items: [] })), 80)).toEqual([])
    const held = focusedTodoJson()
    held.items = (held.items as { held: boolean }[]).filter(i => i.held)
    expect(todoBandLines(list(held), 80).map(l => l.text)).toEqual(['🎯 shop, legal, billing (IR-6) · 1 held · nothing in focus waiting on you'])
  })

  test('a narrow row cuts the label, never the due date', () => {
    const nda = list(todoJson()).items[1]!
    expect(todoText(nda, 40)).toBe('☐ [legal] i-7f3a sign the N… · due 10-22')
  })
})

/** The XO awake with `todo` on the board; `chartroom todo done <ref>` takes the item off it. */
async function xo($: Engine, on: Parameters<typeof install>[0], todo = todoJson(), world: World = XO_WORLD()) {
  const live = { todo }
  world.board = () => ({ exitCode: 0, stdout: boardJson({ todo: live.todo }), stderr: '' })
  world.todo = args => {
    if (args[0] === 'done') live.todo = { ...live.todo, items: (live.todo.items as { ref: string }[]).filter(i => i.ref !== args[1]) }
    return { exitCode: 0, stdout: `${args.join(' ')}\n`, stderr: '' }
  }
  const w = install(on, world)
  const opens: { id: string; focus?: true; closeOnEscape?: true }[] = []
  on('ui.open', ($, e) => {
    opens.push({ id: e.id, focus: e.focus, closeOnEscape: e.closeOnEscape })
    return { value: { isPlaced: true as const } }
  })
  await startXo($)
  await w.clock.settle()
  return { w, opens, live }
}

test('the band: the crew line, then the list with a todo button; /todo off hides the list alone', async ($, on) => {
  await xo($, on)
  const band = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(100) })
  expect(await band.find({ type: 'Text', text: /^⚓/ })).toBeDefined()
  expect((await band.findAll({ type: 'Text', text: /^☐|^ {2}\+/ })).map(t => t.text)).toEqual([
    '☐ [billing] 9c1e blocked: prod is down, need the DB password',
    '☐ [legal] i-7f3a sign the NDA by 2026-10-22 · due 10-22',
    '☐ [shop] 108a decide: pick A or B (recommend A)',
    '  +1 more',
  ])
  const button = await band.find({ type: 'Button', key: 'todo-open' })
  expect([button?.props.label, button?.props.hotkey]).toEqual(['todo', 't'])
  expect((await run($, 'todo', 'off')).text).toBe('Todo list off for this session: /todo on brings it back; /todo still opens the pane.')
  expect(await band.find({ type: 'Text', text: /^☐/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /^⚓/ })).toBeDefined()
  expect((await run($, 'todo', 'on')).text).toBe('Todo list on.')
  expect(await band.find({ type: 'Text', text: /^☐/ })).toBeDefined()
})

test('/todo opens the pane on the first row; d on a task says why not, d twice ticks an inbox item off', async ($, on) => {
  const { w, opens } = await xo($, on)
  expect((await run($, 'todo')).text).toBe('Todo pane opened.')
  expect(opens).toEqual([{ id: 'todo', focus: true, closeOnEscape: true }])
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'Pane', requestId: 'todo', props: PANE_PROPS(100) })
  expect((await ui.find({ key: 'todo-9c1e' }))?.props.autoFocus).toBe(true)
  expect((await ui.findAll({ type: 'Button' })).map(b => [b.key, b.props.hotkey ?? null])).toEqual([
    ['todo-close', 'q'],
    ['todo-act-copy', 'c'],
    ['todo-act-done', 'd'],
    ['todo-act-continue', 'o'],
    ['todo-9c1e', null],
    ['todo-i-7f3a', null],
    ['todo-108a', null],
    ['todo-108a/reply', null],
  ])
  const ran = () => w.runs.filter(r => r[1] === 'todo')
  await ui.press({ key: 'todo-act-done' })
  expect(await ui.find({ type: 'Text', text: '9c1e is blocked on you: it clears when the XO relays your answer (o: /continue 9c1e)' })).toBeDefined()
  expect(ran()).toEqual([])
  // The ring moves to the NDA: d arms it, d again runs `chartroom todo done` and the row goes.
  await $.ui.focus({ component: 'Pane', requestId: 'todo', plugin: 'crew-view', element: 'todo-i-7f3a', origin: { kind: 'person' } })
  expect((await ui.find({ key: 'todo-i-7f3a' }))?.text).toMatch(/^▸ ☐/)
  await ui.press({ key: 'todo-act-done' })
  expect(await ui.find({ type: 'Text', text: 'd again ticks off i-7f3a: sign the NDA by 2026-10-22' })).toBeDefined()
  expect(ran()).toEqual([])
  await ui.press({ key: 'todo-act-done' })
  expect(ran()).toEqual([['chartroom', 'todo', 'done', 'i-7f3a']])
  expect(await ui.find({ type: 'Text', text: 'done i-7f3a' })).toBeDefined()
  expect(await ui.find({ key: 'todo-i-7f3a' })).toBeUndefined()
  expect((await ui.find({ key: 'todo-108a' }))?.text).toMatch(/^▸ ☐/)
})

test('c copies an artifact text or a task id; o puts /continue in the prompt; a shows the held ones', async ($, on) => {
  const { w } = await xo($, on, focusedTodoJson())
  await run($, 'todo')
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'Pane', requestId: 'todo', props: PANE_PROPS(100) })
  expect(await ui.find({ type: 'Text', text: '🎯 shop, legal, billing (IR-6) · 1 held · a shows them' })).toBeDefined()
  // a press on a row selects it, as the ring does
  await ui.press({ key: 'todo-108a/reply' })
  await ui.press({ key: 'todo-act-copy' })
  expect(w.runs).toContainEqual(['chartroom', 'artifact', 'show', '108a/reply'])
  await ui.press({ key: 'todo-108a' })
  await ui.press({ key: 'todo-act-copy' })
  expect(w.copies).toEqual(['the text of 108a/reply\n', '108a'])
  await ui.press({ key: 'todo-act-continue' })
  expect(w.fills).toEqual(['/continue 108a'])
  expect(await ui.find({ key: 'todo-i-0b01' })).toBeUndefined()
  await ui.press({ key: 'todo-act-held' })
  expect(await ui.find({ type: 'Text', text: 'HELD BY FOCUS (1)' })).toBeDefined()
  expect(await ui.find({ key: 'todo-i-0b01' })).toBeDefined()
})

test('focus turning on shows within seconds: a change to focus.json polls at once, no restart', async ($, on) => {
  const world = XO_WORLD()
  world.mtimes = { [`${HOME}/.captain/focus.json`]: 1, [`${HOME}/.captain/inbox.md`]: 1 }
  const { w, live } = await xo($, on, todoJson(), world)
  const band = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(100) })
  await w.clock.advance(3_000)
  const boards = () => w.runs.filter(r => r[1] === 'board').length
  const before = boards()
  await w.clock.advance(6_000)
  expect(boards()).toBe(before)
  live.todo = focusedTodoJson()
  world.mtimes[`${HOME}/.captain/focus.json`] = 2
  await w.clock.advance(3_000)
  expect(boards()).toBe(before + 1)
  expect(await band.find({ type: 'Text', text: /🎯 shop, legal, billing \(IR-6\) · 1 held$/ })).toBeDefined()
})

test("where the person's own /todo holds the name, the list answers to /next and /crew todo; their /todo passes by", async ($, on) => {
  const world = XO_WORLD()
  world.taken = ['todo']
  const theirs: string[] = []
  on('command.run', { command: 'todo' }, () => {
    theirs.push('todo')
    return { text: 'their own todo skill' }
  })
  const { w, opens } = await xo($, on, todoJson(), world)
  expect(w.commands).toEqual(['crew', 'next'])
  expect((await run($, 'todo')).text).toBe('their own todo skill')
  expect(theirs).toEqual(['todo'])
  expect((await run($, 'next')).text).toBe('Todo pane opened.')
  expect((await run($, 'crew', 'todo off')).text).toBe('Todo list off for this session: /crew todo on brings it back; /crew todo still opens the pane.')
  expect(opens.map(o => o.id)).toEqual(['todo'])
})
