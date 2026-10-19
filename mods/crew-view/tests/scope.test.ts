// Scoping: the mod is installed at user scope, so it must be inert in workers, and inert in the
// XO's own session until the captain or chartroom skill is loaded there.
import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, HOME, XO_WORLD, install, startXo } from './world'

const XO = `${HOME}/.captain`

for (const skill of ['captain', 'chartroom', 'chartroom:captain']) {
  test(`the XO session wakes when it loads ${skill}: registers /crew and /todo, polls, keeps polling`, async ($, on) => {
    const w = install(on, XO_WORLD())
    const expanded = await startXo($, XO, skill)
    expect(expanded.text).toBe(`the ${skill} skill`)
    await w.clock.settle()
    expect(w.commands).toEqual(['crew', 'todo'])
    expect(w.runs).toEqual([['chartroom', 'board', '--json']])
    await w.clock.advance(15_000)
    expect(w.runs).toHaveLength(2)
    const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(100) })
    expect(await ui.find({ key: 'open' })).toBeDefined()
  })
}

test('the XO session stays inert until the skill loads: no command, no process, no timer, no band', async ($, on) => {
  const w = install(on, XO_WORLD())
  await $.session.start({ cwd: XO, surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'commit', text: 'another skill' })
  await w.clock.advance(60_000)
  expect(w.commands).toEqual([])
  expect(w.runs).toEqual([])
  for (const component of ['AbovePrompt', 'Pane'] as const) {
    const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component, requestId: 'crew', props: BAND_PROPS(100) as never })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    await ui.unmount()
  }
})

test('loading the skill twice starts one poll, not two', async ($, on) => {
  const w = install(on, XO_WORLD())
  await startXo($)
  await $.skill.prompt({ skill: 'chartroom', text: 'again' })
  await w.clock.settle()
  expect(w.commands).toEqual(['crew', 'todo'])
  await w.clock.advance(15_000)
  expect(w.runs).toHaveLength(2)
})

test('a session whose state already says active (a hot reload) wakes at session.start', async ($, on) => {
  const w = install(on, XO_WORLD())
  on('state.get', ($, e, next) => (e.plugin === 'crew-view' && e.key === 'active' ? { value: { value: true, version: 1 } } : next(e)))
  await $.session.start({ cwd: XO, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(w.commands).toEqual(['crew', 'todo'])
  expect(w.runs).toEqual([['chartroom', 'board', '--json']])
})

for (const [name, cwd, isInteractive, env] of [
  ['a crew worker in a worktree', `${XO}/worktrees/chartroom/x-98e2`, true, {}],
  ['a crew worker in its project checkout', `${HOME}/code/shop`, true, {}],
  ['a headless claude -p worker in the home', XO, false, {}],
  ['a task session (CHARTROOM_TASK set) in the home', XO, true, { CHARTROOM_TASK: 'x-98e2' }],
  ['a session in the default home when the config names another', `${HOME}/.chartroom`, true, {}],
] as const) {
  test(`inert in ${name}, even after the skill loads: no command, no process, no timer, no band`, async ($, on) => {
    const world = XO_WORLD()
    world.env = { ...world.env, ...env }
    world.dirs.push(`${HOME}/.chartroom`)
    const w = install(on, world)
    await $.session.start({ cwd, surface: 'terminal', isInteractive })
    for (const skill of ['captain', 'chartroom']) await $.skill.prompt({ skill, text: 'x' })
    await w.clock.advance(60_000)
    expect(w.commands).toEqual([])
    expect(w.runs).toEqual([])
    const ui = await $.ui.mount({ plugin: 'crew-view', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS(100) })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'open' })).toBeUndefined()
  })
}

test('CHARTROOM_HOME in the environment wins over the config file', async ($, on) => {
  const world = XO_WORLD()
  world.env = { ...world.env, CHARTROOM_HOME: '/srv/crew' }
  const w = install(on, world)
  await startXo($, '/srv/crew')
  expect(w.commands).toEqual(['crew', 'todo'])
})

test('with no config file, a pre-existing ~/.captain (and no ~/.chartroom) is the home', async ($, on) => {
  const world = XO_WORLD()
  world.files = {}
  const w = install(on, world)
  await startXo($, XO)
  expect(w.commands).toEqual(['crew', 'todo'])
})
