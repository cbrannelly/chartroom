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

/** A `chartroom show <id> --json` payload shaped like the CLI's: the board's card plus the detail. */
export function showJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'task', id: 'auth-project-manager-108a', short_id: '108a', title: 'Auth project-manager', project: 'shop',
    kind: 'ship', backend: 'herdr:claude', state: 'decision', live: 'running', lane: 'needs_you', reason: 'decision',
    last_event: 'decision: pick A or B', last_at: '2026-10-12T15:00:30Z', has_report: true, files: ['brief.md', 'report.md'],
    prs: [{ url: 'https://github.com/acme/shop/pull/7', state: 'UNKNOWN' }],
    waiting_on: null, waiting_until: null, artifacts: [],
    intent: 'Make login use passkeys.\nKeep the old flow behind a flag.',
    events: [
      { at: '2026-10-12T14:12:30Z', kind: 'progress', text: 'passkey flow drafted' },
      { at: '2026-10-12T15:00:30Z', kind: 'decision', text: 'pick A or B (recommend A)' },
    ],
    outcome: null,
    report: { path: `${HOME}/.chartroom/tasks/auth-project-manager-108a/report.md`, summary: 'PR 7 is open.' },
    brief: `${HOME}/.chartroom/tasks/auth-project-manager-108a/brief.md`,
    worktree: `${HOME}/.captain/worktrees/shop/auth-project-manager-108a`, branch: 'cap/auth-project-manager-108a',
    attach: { where: 'herdr tab w1:t2', command: 'chartroom attach auth-project-manager-108a' },
    ...over,
  })
}

type Ran = { exitCode: number; stdout: string; stderr: string }

export type World = {
  env: Record<string, string>
  files: Record<string, string>
  dirs: string[]
  /** What `chartroom board --json` prints; a string, or a failure. */
  board: () => Ran | 'missing'
  /** What `chartroom show <id> --json` prints for an id. */
  show: (id: string) => Ran
  /** What `chartroom artifact show <ref>` prints for a ref. */
  artifact: (ref: string) => Ran
  /** The prompt box's draft. */
  draft: string
}

export const XO_WORLD = (): World => ({
  env: { HOME },
  files: { [`${HOME}/.config/chartroom/config`]: '# local\nCHARTROOM_HOME=~/.captain\nCHARTROOM_HARNESS=claude\n' },
  dirs: [`${HOME}/.captain`],
  board: () => ({ exitCode: 0, stdout: boardJson(), stderr: '' }),
  show: id => (id === '108a' ? { exitCode: 0, stdout: showJson(), stderr: '' } : { exitCode: 1, stdout: '', stderr: `chartroom: unknown id '${id}'` }),
  artifact: ref => ({ exitCode: 0, stdout: `the text of ${ref}\n`, stderr: '' }),
  draft: '',
})

/**
 * Installs the world; returns the argv of every process the plugin ran, the commands it
 * registered, what it put on the clipboard and in the prompt, and the clock.
 */
export function install(on: On, world: World) {
  const runs: string[][] = []
  const commands: string[] = []
  const copies: string[] = []
  const fills: string[] = []
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
    const reply = e.argv[1] === 'show' ? world.show(e.argv[2] ?? '') : e.argv[1] === 'artifact' ? world.artifact(e.argv[3] ?? '') : out
    return { value: { ...reply, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', ($, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('prompt.read', () => ({ value: { text: world.draft, cursor: world.draft.length } }))
  on('prompt.fill', ($, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  // The engine's skill expansion: the prompt text as the skill computed it.
  on('skill.prompt', ($, e) => ({ text: e.text }))
  return { runs, commands, copies, fills, clock }
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
