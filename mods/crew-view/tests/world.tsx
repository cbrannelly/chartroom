// A fake world beneath the plugin: env, files, the chartroom CLI and the clock.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export const HOME = '/srv/xo'

/** A `chartroom board --json` payload shaped like the CLI's (fields the mod ignores included). */
export function boardJson(over: Record<string, unknown> = {}): string {
  const task = (short_id: string, project: string, title: string, state: string, last_at: string) => ({
    type: 'task', id: `${title.toLowerCase().replace(/\W+/g, '-')}-${short_id}`, short_id, title, project,
    kind: 'ship', backend: 'herdr:claude', state, live: 'running', last_event: `${state}: x`, last_at, prs: [], files: [],
  })
  return JSON.stringify({
    generated_at: '2026-10-12T15:12:30Z',
    home: `${HOME}/.captain`,
    version: '0.1.0',
    recent_hours: 48,
    lanes: {
      needs_you: [
        task('108a', 'shop', 'Auth project-manager', 'decision', '2026-10-09T15:12:30Z'),
        task('9c1e', 'billing', 'Billing webhook refactor', 'blocked', '2026-10-12T15:00:30Z'),
        { type: 'inbox', id: 'inbox-0', short_id: 'i-7f3a', title: 'Waiting on legal', date: '2026-10-12', last_at: '2026-10-12T00:00:00Z', lane: 'needs_you', state: 'inbox' },
      ],
      in_progress: [
        task('98e2', 'chartroom', 'Live crew view mod', 'working', '2026-10-12T15:11:50Z'),
        task('4d10', 'api', 'Risk triage', 'working', '2026-10-12T14:12:30Z'),
        task('77aa', 'shop', 'Checkout copy', 'drafting', '2026-10-12T15:10:30Z'),
      ],
      on_hold: [],
      ready: [task('1b91', 'api', 'Diff coverage', 'done', '2026-10-12T03:49:56Z')],
      recent: [],
    },
    ...over,
  })
}

export type World = {
  env: Record<string, string>
  files: Record<string, string>
  dirs: string[]
  /** What `chartroom board --json` prints; a string, or a failure. */
  board: () => { exitCode: number; stdout: string; stderr: string } | 'missing'
}

export const XO_WORLD = (): World => ({
  env: { HOME },
  files: { [`${HOME}/.config/chartroom/config`]: '# local\nCHARTROOM_HOME=~/.captain\nCHARTROOM_HARNESS=claude\n' },
  dirs: [`${HOME}/.captain`],
  board: () => ({ exitCode: 0, stdout: boardJson(), stderr: '' }),
})

/** Installs the world; returns the argv of every process the plugin ran, and the clock. */
export function install(on: On, world: World) {
  const runs: string[][] = []
  const commands: string[] = []
  mock.env(on, world.env)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own band and pane, beneath the plugin: what a pass-through draws.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine">
        <Text>engine</Text>
      </Box>
    )
  })
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T15:12:30Z') })
  on('fs.exists', ($, e) => ({ value: e.path in world.files || world.dirs.includes(e.path) }))
  on('fs.read', ($, e) => {
    const text = world.files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.stat', ($, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const out = world.board()
    if (out === 'missing' || e.argv[0] !== 'chartroom') return { deny: `spawn ${e.argv[0]} ENOENT` }
    return { value: { ...out, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  // The engine's skill expansion: the prompt text as the skill computed it.
  on('skill.prompt', ($, e) => ({ text: e.text }))
  return { runs, commands, clock }
}

/** Starts a session in `cwd` and loads `skill` in it, as `/captain` or the Skill tool does. */
export async function startXo($: Engine, cwd = `${HOME}/.captain`, skill = 'captain') {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  return $.skill.prompt({ skill, text: `the ${skill} skill` })
}

export const BAND_PROPS = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

export const PANE_PROPS = (bodyColumns: number) => ({
  title: 'Crew',
  isFocused: false,
  bodyColumns,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
})
