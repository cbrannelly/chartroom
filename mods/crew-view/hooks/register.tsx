// crew-view: chartroom's crew, live in the XO's Claude Code session.
//
// Installed at user scope it loads in every Claude session, crew workers' included. It wakes
// only when both hold: session.start decided this is the XO's session (interactive, cwd is the
// chartroom home, not under worktrees/, not a task's session), and the session has loaded the
// `captain` or `chartroom` skill (skill.prompt: `/captain`, the Skill tool, or a preload). Until
// then it registers nothing, starts no timer, runs no process and draws nothing. Once awake it
// stays awake for the session; $.state keeps that across a hot reload.
//
// The /crew pane browses the board: each item is a Button (Tab or the arrows walk them, Enter
// opens one), and an item opens into its detail (`chartroom show <id> --json`) with actions
// on one-letter hotkeys: continue (`/continue <id>` into the prompt), copy the id or a PR,
// read the report, copy an artifact, back. `q` or Esc closes the pane, `/crew` toggles it,
// and `/crew off` hides the band for the session (`/crew on` brings it back).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CrewBoard, CrewDetail, CrewView } from '../types'
import { bandSegments, configPath, detailActions, detailLines, isUnderWorktrees, paneLines, parseBoard, parseDetail, resolveHome, samePath } from './crew'
import type { ActionId, Tone } from './crew'

const PANE = 'crew'
const POLL_MS = 15_000

const XO_SKILLS = ['captain', 'chartroom']

const isXo = atom({ plugin: 'crew-view', key: 'isXo' } as const, false)
const active = atom({ plugin: 'crew-view', key: 'active' } as const, false)
const board = atom({ plugin: 'crew-view', key: 'board' } as const, null as CrewBoard | null)
const error = atom({ plugin: 'crew-view', key: 'error' } as const, null as string | null)
const view = atom({ plugin: 'crew-view', key: 'view' } as const, 'list' as CrewView)
const selected = atom({ plugin: 'crew-view', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'crew-view', key: 'detail' } as const, null as CrewDetail | null)
const detailError = atom({ plugin: 'crew-view', key: 'detailError' } as const, null as string | null)
const report = atom({ plugin: 'crew-view', key: 'report' } as const, null as { path: string; text: string } | null)
const notice = atom({ plugin: 'crew-view', key: 'notice' } as const, null as string | null)
const bandOff = atom({ plugin: 'crew-view', key: 'bandOff' } as const, false)

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

/** One `chartroom <args>` run: `chartroom` on PATH, then ~/.local/bin (a thin GUI PATH). */
async function runChartroom($: EngineInterface, args: string[]): Promise<{ stdout: string } | { error: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  for (const bin of ['chartroom', `${home}/.local/bin/chartroom`]) {
    try {
      const ran = await $.process.run([bin, ...args], { timeoutMs: 20_000 })
      if (ran.exitCode === 0) return { stdout: ran.stdout }
      if (ran.exitCode === 127) continue
      const why = (ran.stderr.trim().split('\n')[0] ?? '').replace(/^chartroom:\s*/, '')
      return { error: `chartroom ${args[0]} failed${why ? `: ${why}` : ` (exit ${ran.exitCode})`}` }
    } catch (err) {
      // A rejection is a command that could not start, or one still running at the timeout.
      if (/timed? ?out/i.test(String(err))) return { error: `chartroom ${args[0]} timed out` }
    }
  }
  return { error: 'chartroom not found' }
}

// The XO's chartroom home, set by session.start; a reload re-runs it.
let home = ''
let polling = false
// Whether this load of the module has registered /crew and started the timer.
let started = false

/** Reads the board into $.state; never throws, never overlaps a run still going. */
async function poll($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  try {
    const ran = await runChartroom($, ['board', '--json'])
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
  // A detail on screen follows the board; one left open in a closed pane waits for /crew.
  const ref = await read($, selected).catch(() => null)
  if (!ref || (await read($, view)) === 'list') return
  const shown = await $.ui.panes().then(
    panes => panes.some(p => p.id === PANE),
    () => true,
  )
  if (shown) await loadDetail($, ref)
}

// The ids whose `chartroom show` is running, so a poll never stacks a second one.
const loading = new Set<string>()

/** Reads one item's detail into $.state; a reply for an item no longer selected is dropped. */
async function loadDetail($: EngineInterface, ref: string): Promise<void> {
  if (loading.has(ref)) return
  loading.add(ref)
  try {
    const ran = await runChartroom($, ['show', ref, '--json'])
    if ((await read($, selected)) !== ref) return
    const parsed = 'error' in ran ? ran : parseDetail(ran.stdout)
    if ('error' in parsed) {
      await update($, detailError, () => parsed.error)
    } else {
      await update($, detail, () => parsed.detail)
      await update($, detailError, () => null)
    }
  } catch (err) {
    await update($, detailError, () => `crew view: ${String(err).split('\n')[0]}`).catch(() => {})
  } finally {
    loading.delete(ref)
  }
}

/** Moves the pane's focus ring onto `key`; a pane not holding the keys says no, which is fine. */
function focusOn($: EngineInterface, key: string) {
  void $.ui.focus({ requestId: PANE, key }).catch(() => {})
}

/** Opens an item's detail: the board's card at once, `chartroom show` when it answers. */
async function openItem($: EngineInterface, ref: string): Promise<void> {
  await update($, selected, () => ref)
  await update($, view, () => 'detail')
  await update($, notice, () => null)
  await update($, detailError, () => null)
  await update($, detail, d => (d?.ref === ref ? d : null))
  focusOn($, 'act-continue')
  await loadDetail($, ref)
}

async function back($: EngineInterface): Promise<void> {
  const from = await read($, view)
  const ref = await read($, selected)
  await update($, notice, () => null)
  if (from === 'report') {
    await update($, view, () => 'detail')
    focusOn($, 'act-report')
    return
  }
  await update($, view, () => 'list')
  if (ref) focusOn($, `row-${ref}`)
}

async function say($: EngineInterface, text: string) {
  await update($, notice, () => text)
}

/** Puts `text` on the clipboard of the surface the press came from, and says how it went. */
async function copy($: EngineInterface, text: string, what: string, surface?: RenderSurface) {
  const done = await $.ui.copy({ text, ...(surface ? { surface } : {}) })
  await say($, done.isCopied ? `copied ${what}` : `could not copy ${what} (${done.reason}): ${text}`)
}

/** `/continue <id>` into an empty prompt; a draft is never replaced: then it is copied. */
async function continueItem($: EngineInterface, ref: string, surface?: RenderSurface) {
  const line = `/continue ${ref}`
  const box = await $.prompt.read()
  if (box.text.trim() === '') {
    const filled = await $.prompt.fill({ text: line, mode: 'replace' })
    // The fill hands the keys to the prompt: Enter runs it.
    if (filled.isFilled) return say($, `${line} is in the prompt: press Enter to run it`)
  }
  const done = await $.ui.copy({ text: line, ...(surface ? { surface } : {}) })
  const why = box.text.trim() ? 'the prompt holds a draft, kept' : 'the prompt cannot take it now'
  await say($, done.isCopied ? `${line} copied (${why}): paste it at the prompt` : `${why}; type ${line}`)
}

async function openReport($: EngineInterface) {
  const d = await read($, detail)
  if (!d?.report) return say($, 'no report yet')
  try {
    const text = await $.fs.read(d.report.path)
    await update($, report, () => ({ path: d.report?.path ?? '', text }))
    await update($, view, () => 'report')
    focusOn($, 'act-back')
  } catch (err) {
    await say($, `could not read ${d.report.path}: ${String(err).split('\n')[0]}`)
  }
}

async function copyArtifact($: EngineInterface, index: number, surface?: RenderSurface) {
  const a = (await read($, detail))?.artifacts[index]
  if (!a) return
  const ran = await runChartroom($, ['artifact', 'show', a.ref])
  if ('error' in ran) return say($, ran.error)
  await copy($, ran.stdout, `artifact ${a.ref}`, surface)
}

async function act($: EngineInterface, id: ActionId, surface?: RenderSurface) {
  const ref = await read($, selected)
  const d = await read($, detail)
  if (id === 'back') return back($)
  if (id === 'report') return openReport($)
  if (id === 'copy-artifact') return copyArtifact($, 0, surface)
  if (id === 'copy-pr') return d?.prs[0] ? copy($, d.prs[0].url, d.prs[0].url, surface) : undefined
  if (!ref) return
  if (id === 'continue') return continueItem($, ref, surface)
  if (id === 'copy-id') return copy($, ref, ref, surface)
}

async function openPane($: EngineInterface) {
  void poll($)
  // Esc closes it, from the pane or from an idle, empty prompt, as `q` and `/crew` do.
  return $.ui.open({ id: PANE, title: 'Crew', focus: true, closeOnEscape: true })
}

/** True while the pane is open, shown or behind another pane's tab. */
async function isOpen($: EngineInterface, shownOnly = false): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])
  return panes.some(p => p.id === PANE && (!shownOnly || p.isShown))
}

/** A closed pane opens next on the lanes. */
async function rest($: EngineInterface) {
  await update($, view, () => 'list')
  await update($, notice, () => null)
}

/** Closes the pane. The plugin's own close passes beneath its ui.close hook: it rests here. */
async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE }).catch(() => {})
  await rest($)
}

/** The timer's poll; skipped while nothing shows the board (the band off, the pane closed). */
async function tick($: EngineInterface) {
  if ((await read($, bandOff).catch(() => false)) && !(await isOpen($))) return
  await poll($)
}

/** True when this is the XO's session and it has loaded the captain or chartroom skill. */
async function isActive($: EngineInterface): Promise<boolean> {
  return (await read($, isXo)) && (await read($, active))
}

/** Registers /crew, reads the board and starts the poll; once per load of the module. */
async function start($: EngineInterface): Promise<void> {
  if (started) return
  started = true
  await $.command.register({ name: 'crew', description: "Toggle chartroom's crew pane; /crew <id> opens an item, /crew off hides the band" })
  void poll($)
  $.clock.every(POLL_MS, () => void tick($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const xo = await detectXo($, e.cwd, e.isInteractive).catch(() => null)
    await update($, isXo, () => xo !== null)
    if (xo === null) return next(e)
    home = xo
    // A hot reload of a session that already loaded the skill picks up where it was.
    if (await read($, active)) await start($)
    return next(e)
  })

  // `/captain`, `/chartroom`, the Skill tool or a preload: the session is the XO's in earnest.
  // A plugin's skill arrives as `plugin:skill`. The prompt text passes through untouched.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.split(':').pop() ?? ''
    if (XO_SKILLS.includes(name) && (await read($, isXo))) {
      await update($, active, () => true)
      await start($)
    }
    return next(e)
  })

  // /crew exists only once start() registered it. Bare, it toggles the pane; `/crew <id>`
  // opens that item; `/crew off` hides the band (and the pane) for the session, `/crew on`
  // brings the band back.
  on('command.run', { command: 'crew' }, async ($, e) => {
    const ref = e.args.trim().replace(/^\[|\]$/g, '')
    if (ref === 'off') {
      await update($, bandOff, () => true)
      await closePane($)
      return { text: 'Crew band off for this session: /crew on brings it back; /crew still opens the pane.' }
    }
    if (ref === 'on') {
      await update($, bandOff, () => false)
      void poll($)
      return { text: 'Crew band on.' }
    }
    if (ref) void openItem($, ref)
    else if (await isOpen($, true)) {
      await closePane($)
      return { text: 'Crew pane closed.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Crew pane opened.' : 'Crew pane is waiting for room: widen the terminal.' }
  })

  // The person's close (Esc, the close mark) rests the pane as closePane does.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await rest($)
    return closed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isActive($)) || (await read($, bandOff))) return next(e)
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
    if (!(await isActive($))) return next(e)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const b = await read($, board)
    const err = await read($, error)
    const shown = await read($, view)
    const ref = await read($, selected)
    const note = await read($, notice)
    const width = e.props.bodyColumns
    const now = await $.clock.now()
    const noticeLine = note ? (
      <Text key="notice" color="success" wrap="truncate">
        {note}
      </Text>
    ) : null
    // Every view's first row says how to close the pane; `q` presses it.
    const closeButton = <Button key="act-close" plain hotkey="q" label="close" role="dismiss" onPress={() => void closePane($)} />
    const head = (hint: string) => (
      <Box key="head" flexDirection="row">
        {closeButton}
        <Text dimColor wrap="truncate">
          {'  '}
          {hint}
        </Text>
      </Box>
    )

    if (shown === 'report' && ref) {
      const r = await read($, report)
      return (
        <Box flexDirection="column">
          <Box key="head" flexDirection="row">
            <Box marginRight={2}>
              <Button key="act-back" plain autoFocus hotkey="b" label="back" onPress={() => void back($)} />
            </Box>
            {closeButton}
            <Text dimColor wrap="truncate">
              {'  '}
              {r?.path ?? ''}
            </Text>
          </Box>
          <Markdown text={r?.text ?? ''} />
        </Box>
      )
    }

    if (shown === 'detail' && ref) {
      const d = await read($, detail)
      const dErr = await read($, detailError)
      const card = d ? null : b ? paneLines(b, width, now).find(l => l.ref === ref) : undefined
      const lines = d ? detailLines(d, width, now) : []
      const draw = (line: (typeof lines)[number]) =>
        line.press ? (
          <Button
            key={line.key}
            plain
            label={line.text}
            onPress={press =>
              void (line.press?.kind === 'pr'
                ? copy($, d?.prs[line.press.index]?.url ?? '', 'the PR URL', press.surface)
                : copyArtifact($, line.press?.index ?? 0, press.surface))
            }
          />
        ) : (
          <Text key={line.key} bold={line.bold} wrap="truncate" {...COLOR[line.tone]}>
            {line.text}
          </Text>
        )
      // The head (title, state), then the actions and what the last one did, then the sections:
      // the actions stay in sight however long the detail, and lead the focus ring.
      return (
        <Box flexDirection="column">
          {head('Esc closes too · b back to the lanes')}
          {d ? (
            lines.slice(0, 2).map(draw)
          ) : (
            <Text key="loading" dimColor wrap="truncate">
              {card ? card.text.trim() : ref} · {dErr ?? 'reading…'}
            </Text>
          )}
          <Box flexDirection="row" flexWrap="wrap">
            {detailActions(ref, d).map(a => (
              <Box key={`box-${a.id}`} marginRight={2}>
                <Button key={`act-${a.id}`} plain {...(a.id === 'continue' ? { autoFocus: true as const } : {})} hotkey={a.hotkey} label={a.label} onPress={press => void act($, a.id, press.surface)} />
              </Box>
            ))}
          </Box>
          {noticeLine}
          {lines.slice(2).map(draw)}
          {d && dErr ? (
            <Text key="detail-error" dimColor wrap="truncate">
              last read: {dErr}
            </Text>
          ) : null}
        </Box>
      )
    }

    const listHead = head('Esc closes too · /crew toggles · /crew off hides the band')
    if (!b) {
      return (
        <Box flexDirection="column">
          {listHead}
          <Text dimColor>{err ?? 'Reading the board…'}</Text>
        </Box>
      )
    }
    const lines = paneLines(b, width, now)
    // The ring starts on the row last opened, else the first, never on close.
    const first = lines.find(l => l.ref === ref)?.ref ?? lines.find(l => l.ref)?.ref
    return (
      <Box flexDirection="column">
        {listHead}
        {lines.map(line =>
          line.ref ? (
            <Button key={`row-${line.ref}`} plain label={line.text} {...(line.tone === 'dim' ? { dimColor: true } : {})} {...(line.ref === first ? { autoFocus: true as const } : {})} onPress={() => void openItem($, line.ref ?? '')} />
          ) : (
            <Text key={line.key} bold={line.bold} wrap="truncate" {...COLOR[line.tone]}>
              {line.text}
            </Text>
          ),
        )}
        <Text dimColor wrap="truncate">
          updated {b.generated_at.slice(11, 19) || '?'}Z{err ? ` · last poll: ${err}` : ''} ·{' '}
          {e.props.isFocused ? 'Tab/arrows move, Enter opens' : '/crew closes, ctrl+x tab to browse'}
        </Text>
      </Box>
    )
  })
}
