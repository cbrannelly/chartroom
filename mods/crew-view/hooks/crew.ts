// Pure helpers for crew-view: no `$`, so the tests can call them directly.
import type { CrewBoard, CrewItem } from '../types'

// ---------------------------------------------------------------- home and scope

/** The environment and files `resolveHome` reads, gathered by the caller through `$`. */
export type HomeInputs = {
  chartroomHome?: string
  capHome?: string
  /** The config file's text, when it exists. */
  configText?: string
  home: string
  hasChartroomDir: boolean
  hasCaptainDir: boolean
}

/** Where the chartroom config file lives, as lib/core.sh's CR_CONFIG_FILE. */
export function configPath(env: { chartroomConfig?: string; xdgConfigHome?: string; home: string }): string {
  return env.chartroomConfig || `${env.xdgConfigHome || `${env.home}/.config`}/chartroom/config`
}

/** A KEY=VALUE line's value as lib/core.sh's cfg_file_value reads it: last line wins. */
export function configValue(text: string, key: string): string {
  let value = ''
  for (const line of text.split('\n')) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line)
    if (m) value = m[1] ?? ''
  }
  value = value.replace(/\r$/, '')
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value)
  return quoted ? (quoted[1] ?? '') : value
}

/** The chartroom home, resolved in lib/core.sh resolve_home's order. */
export function resolveHome(i: HomeInputs): string {
  if (i.chartroomHome) return i.chartroomHome
  if (i.capHome) return i.capHome
  const fromConfig = i.configText === undefined ? '' : configValue(i.configText, 'CHARTROOM_HOME')
  if (fromConfig) return fromConfig.replace(/^~/, i.home)
  if (i.hasChartroomDir || !i.hasCaptainDir) return `${i.home}/.chartroom`
  return `${i.home}/.captain`
}

export function isUnderWorktrees(cwd: string): boolean {
  return cwd.split('/').includes('worktrees')
}

export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  return norm(a) === norm(b)
}

// ---------------------------------------------------------------- board

const LANES = ['needs_you', 'in_progress', 'on_hold', 'ready', 'recent'] as const

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function trimItem(raw: unknown): CrewItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = str(r.id) ?? ''
  const type = str(r.type) ?? 'task'
  return {
    type,
    short_id: str(r.short_id) ?? id.slice(-4),
    project: str(r.project),
    title: str(r.title) ?? id,
    state: str(r.state) ?? (type === 'inbox' ? 'inbox' : '?'),
    last_at: str(r.last_at),
  }
}

/** `chartroom board --json` output to the trimmed board, or an error line. */
export function parseBoard(stdout: string): { board: CrewBoard } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return { error: 'chartroom board: unreadable output' }
  }
  if (typeof raw !== 'object' || raw === null) return { error: 'chartroom board: unreadable output' }
  const r = raw as Record<string, unknown>
  const lanes = (typeof r.lanes === 'object' && r.lanes !== null ? r.lanes : {}) as Record<string, unknown>
  const lane = (name: (typeof LANES)[number]) => {
    const list = lanes[name]
    return Array.isArray(list) ? list.map(trimItem).filter((x): x is CrewItem => x !== null) : []
  }
  return {
    board: {
      generated_at: str(r.generated_at) ?? '',
      home: str(r.home) ?? '',
      needs_you: lane('needs_you'),
      in_progress: lane('in_progress'),
      on_hold: lane('on_hold'),
      ready: lane('ready'),
      recent: lane('recent'),
    },
  }
}

/** `[project]` for an item; an inbox item without one reads `[inbox]`. */
export function label(item: CrewItem): string {
  return `[${item.project ?? (item.type === 'inbox' ? 'inbox' : '?')}]`
}

function tag(item: CrewItem): string {
  return item.short_id ? `${label(item)} ${item.short_id}` : label(item)
}

// ---------------------------------------------------------------- band

export type Tone = 'plain' | 'dim' | 'warn' | 'error'
export type Segment = { text: string; tone: Tone }

/** The band's line, fitted to `width` cells (the needs-you list gives way first). */
export function bandSegments(board: CrewBoard, width: number): Segment[] {
  const landed = board.ready.length + board.recent.length
  const needs = board.needs_you
  const head: Segment = { text: '⚓ ', tone: 'plain' }
  const sep: Segment = { text: ' · ', tone: 'dim' }
  const before: Segment[] = board.in_progress.length ? [{ text: `${board.in_progress.length} running`, tone: 'dim' }] : []
  const after: Segment[] = []
  if (board.on_hold.length) after.push({ text: `${board.on_hold.length} on hold`, tone: 'dim' })
  if (landed) after.push({ text: `${landed} landed`, tone: 'dim' })

  const build = (shown: number): Segment[] => {
    const parts = [...before]
    if (needs.length) {
      const listed = needs.slice(0, shown).map(tag)
      const more = needs.length - shown
      if (more > 0) listed.push(`+${more} more`)
      parts.push({ text: `${needs.length} need${needs.length === 1 ? 's' : ''} you: ${listed.join(', ')}`, tone: 'warn' })
    }
    parts.push(...after)
    if (!parts.length) return [head, { text: 'crew idle', tone: 'dim' }]
    return [head, ...parts.flatMap((p, i) => (i ? [sep, p] : [p]))]
  }

  for (let shown = needs.length; shown > 0; shown--) {
    const segs = build(shown)
    if (cells(segs) <= width) return segs
  }
  return build(0)
}

export function bandText(board: CrewBoard, width: number): string {
  return bandSegments(board, width).map(s => s.text).join('')
}

function cells(segs: Segment[]): number {
  return segs.reduce((n, s) => n + [...s.text].length, 0)
}

// ---------------------------------------------------------------- pane

/** How long ago an ISO time was: `40s`, `12m`, `3h`, `2d`; `-` when unknown. */
export function age(iso: string | null, nowMs: number): string {
  if (!iso) return '-'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '-'
  const s = Math.max(0, Math.round((nowMs - t) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export type PaneLane = { title: string; items: CrewItem[] }

/** The pane's lanes in order: needs you, running, on hold, landed, failed. */
export function paneLanes(board: CrewBoard): PaneLane[] {
  return [
    { title: 'NEEDS YOU', items: board.needs_you.filter(i => i.state !== 'failed') },
    { title: 'RUNNING', items: board.in_progress },
    { title: 'ON HOLD', items: board.on_hold },
    { title: 'LANDED', items: [...board.ready, ...board.recent] },
    { title: 'FAILED', items: board.needs_you.filter(i => i.state === 'failed') },
  ]
}

function fit(text: string, width: number): string {
  const chars = [...text]
  if (chars.length <= width) return text + ' '.repeat(width - chars.length)
  return width <= 1 ? chars.slice(0, width).join('') : `${chars.slice(0, width - 1).join('')}…`
}

export type PaneLine = { key: string; text: string; tone: Tone; bold?: boolean }

/**
 * The pane's lines sized to `width` cells: a header per lane with items, NEEDS YOU
 * always, then one row per item: `[project] short_id title state age`.
 */
export function paneLines(board: CrewBoard, width: number, nowMs: number): PaneLine[] {
  const lanes = paneLanes(board)
  const all = lanes.flatMap(l => l.items)
  const projW = Math.max(3, ...all.map(i => label(i).length))
  const idW = Math.max(4, ...all.map(i => i.short_id.length))
  const stateW = Math.max(5, ...all.map(i => i.state.length))
  const ageW = 3
  const fixed = 2 + projW + 1 + idW + 1 + 1 + stateW + 1 + ageW
  const titleW = Math.max(8, width - fixed)
  const lines: PaneLine[] = []
  for (const lane of lanes) {
    if (!lane.items.length && lane.title !== 'NEEDS YOU') continue
    lines.push({ key: `h-${lane.title}`, text: `${lane.title} (${lane.items.length})`, tone: lane.title === 'NEEDS YOU' && lane.items.length ? 'warn' : lane.title === 'FAILED' ? 'error' : 'plain', bold: true })
    for (const [n, item] of lane.items.entries()) {
      const row = `  ${label(item).padEnd(projW)} ${item.short_id.padEnd(idW)} ${fit(item.title, titleW)} ${item.state.padEnd(stateW)} ${age(item.last_at, nowMs).padStart(ageW)}`
      lines.push({ key: `r-${lane.title}-${n}`, text: row, tone: lane.title === 'LANDED' ? 'dim' : 'plain' })
    }
  }
  return lines
}
