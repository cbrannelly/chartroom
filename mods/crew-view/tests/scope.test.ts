// XO-only scoping: the mod is installed at user scope, so it must be inert in workers.
import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, HOME, XO_WORLD, install } from './world'

const XO = `${HOME}/.captain`

test('the XO session (cwd is the config home) registers /crew, polls, and keeps polling', async ($, on) => {
  const w = install(on, XO_WORLD())
  await $.session.start({ cwd: XO, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(w.commands).toEqual(['crew'])
  expect(w.runs).toEqual([['chartroom', 'board', '--json']])
  await w.clock.advance(15_000)
  expect(w.runs).toHaveLength(2)
})

for (const [name, cwd, isInteractive, env] of [
  ['a crew worker in a worktree', `${XO}/worktrees/chartroom/x-98e2`, true, {}],
  ['a crew worker in its project checkout', `${HOME}/code/shop`, true, {}],
  ['a headless claude -p worker in the home', XO, false, {}],
  ['a task session (CHARTROOM_TASK set) in the home', XO, true, { CHARTROOM_TASK: 'x-98e2' }],
  ['a session in the default home when the config names another', `${HOME}/.chartroom`, true, {}],
] as const) {
  test(`inert in ${name}: no command, no process, no timer, no band`, async ($, on) => {
    const world = XO_WORLD()
    world.env = { ...world.env, ...env }
    world.dirs.push(`${HOME}/.chartroom`)
    const w = install(on, world)
    await $.session.start({ cwd, surface: 'terminal', isInteractive })
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
  await $.session.start({ cwd: '/srv/crew', surface: 'terminal', isInteractive: true })
  expect(w.commands).toEqual(['crew'])
})

test('with no config, the home is ~/.captain when only it exists, else ~/.chartroom', async ($, on) => {
  const world = XO_WORLD()
  world.files = {}
  const w = install(on, world)
  await $.session.start({ cwd: XO, surface: 'terminal', isInteractive: true })
  expect(w.commands).toEqual(['crew'])
})
