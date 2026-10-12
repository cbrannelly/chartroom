// crew-view: chartroom's crew, live in the XO's Claude Code session.
//
// Installed at user scope it loads in every Claude session, crew workers' included, so
// session.start first decides whether this is the XO's session (interactive, cwd is the
// chartroom home, not under worktrees/, not a task's session). Anywhere else it registers
// nothing, starts no timer, runs no process and draws nothing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CrewBoard } from '../types'
import { bandSegments, configPath, isUnderWorktrees, paneLines, parseBoard, resolveHome, samePath } from './crew'
import type { Tone } from './crew'

const PANE = 'crew'
const POLL_MS = 15_000

const isXo = atom({ plugin: 'crew-view', key: 'isXo' } as const, false)
const board = atom({ plugin: 'crew-view', key: 'board' } as const, null as CrewBoard | null)
const error = atom({ plugin: 'crew-view', key: 'error' } as const, null as string | null)

const COLOR: Record<Tone, { color?: string; dimColor?: boolean }> = {
  plain: {},
  dim: { dimColor: true },
  warn: { color: 'warning' },
  error: { color: 'error' },
}

/** True when this session is the XO's; reads env and files only, never runs a process. */
async function detectXo($: EngineInterface, cwd: string, isInteractive: boolean): Promise<string | null> {
  if (!isInteractive) return null
  if (await $.env.get('CHARTROOM_TASK')) return null
  if (isUnderWorktrees(cwd)) return null
  const home = (await $.env.get('HOME')) ?? ''
  if (!home) return null
  const cfg = configPath({
    chartroomConfig: await $.env.get('CHARTROOM_CONFIG'),
    xdgConfigHome: await $.env.get('XDG_CONFIG_HOME'),
    home,
  })
  const chartroomHome = resolveHome({
    chartroomHome: await $.env.get('CHARTROOM_HOME'),
    capHome: await $.env.get('CAP_HOME'),
    configText: (await $.fs.exists(cfg)) ? await $.fs.read(cfg) : undefined,
    home,
    hasChartroomDir: await $.fs.exists(`${home}/.chartroom`),
    hasCaptainDir: await $.fs.exists(`${home}/.captain`),
  })
  if (samePath(cwd, chartroomHome)) return chartroomHome
  const real = async (p: string) => (await $.fs.stat(p, { resolve: true }).catch(() => undefined))?.realPath
  const [a, b] = await Promise.all([real(cwd), real(chartroomHome)])
  return a && b && samePath(a, b) ? chartroomHome : null
}

/** One `chartroom board --json` run: `chartroom` on PATH, then ~/.local/bin (a thin GUI PATH). */
async function runBoard($: EngineInterface): Promise<{ stdout: string } | { error: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  let lastError = 'chartroom not found'
  for (const bin of ['chartroom', `${home}/.local/bin/chartroom`]) {
    try {
      const ran = await $.process.run([bin, 'board', '--json'], { timeoutMs: 20_000 })
      if (ran.exitCode === 0) return { stdout: ran.stdout }
      if (ran.exitCode === 127) continue
      const why = (ran.stderr.trim().split('\n')[0] ?? '').replace(/^chartroom:\s*/, '')
      return { error: `chartroom board failed${why ? `: ${why}` : ` (exit ${ran.exitCode})`}` }
    } catch (err) {
      // A rejection is a command that could not start, or one still running at the timeout.
      lastError = /timed? ?out/i.test(String(err)) ? 'chartroom board timed out' : 'chartroom not found'
    }
  }
  return { error: lastError }
}

// The XO's chartroom home, set by session.start; a reload re-runs it.
let home = ''
let polling = false

/** Reads the board into $.state; never throws, never overlaps a run still going. */
async function poll($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  try {
    const ran = await runBoard($)
    const parsed = 'error' in ran ? ran : parseBoard(ran.stdout)
    if ('error' in parsed) {
      await update($, error, () => parsed.error)
    } else if (parsed.board.home && !samePath(parsed.board.home, home)) {
      await update($, error, () => `chartroom's home is ${parsed.board.home}, not ${home}`)
    } else {
      await update($, board, () => parsed.board)
      await update($, error, () => null)
    }
  } catch (err) {
    await update($, error, () => `crew view: ${String(err).split('\n')[0]}`).catch(() => {})
  } finally {
    polling = false
  }
}

async function openPane($: EngineInterface) {
  void poll($)
  return $.ui.open({ id: PANE, title: 'Crew' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const xo = await detectXo($, e.cwd, e.isInteractive).catch(() => null)
    await update($, isXo, () => xo !== null)
    if (xo === null) return next(e)
    home = xo
    await $.command.register({ name: 'crew', description: "Show chartroom's crew: needs you, running, on hold, landed, failed" })
    void poll($)
    $.clock.every(POLL_MS, () => void poll($))
    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Crew pane opened.' : 'Crew pane is waiting for room: widen the terminal.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isXo))) return next(e)
    const b = await read($, board)
    const err = await read($, error)
    if (!b && !err) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - 9)
    return (
      <Box flexDirection="row">
        <Box flexGrow={1}>
          {b ? (
            <Text wrap="truncate">
              {bandSegments(b, width).map(s => (
                <Text {...COLOR[s.tone]}>{s.text}</Text>
              ))}
              {err ? <Text dimColor> ({err})</Text> : null}
            </Text>
          ) : (
            <Text dimColor wrap="truncate">
              ⚓ {err}
            </Text>
          )}
        </Box>
        <Button key="open" label="crew" hotkey="c" onPress={() => void openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await read($, isXo))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, board)
    const err = await read($, error)
    if (!b) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{err ?? 'Reading the board…'}</Text>
        </Box>
      )
    }
    const now = await $.clock.now()
    return (
      <Box flexDirection="column">
        {paneLines(b, e.props.bodyColumns, now).map(line => (
          <Text key={line.key} bold={line.bold} wrap="truncate" {...COLOR[line.tone]}>
            {line.text}
          </Text>
        ))}
        <Text dimColor wrap="truncate">
          updated {b.generated_at.slice(11, 19) || '?'}Z{err ? ` · last poll: ${err}` : ''} · /crew to refresh
        </Text>
      </Box>
    )
  })
}
