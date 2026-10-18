// The values crew-view keeps in $.state (module variables reset on a hot reload).

/** One board row as the band and the pane draw it, trimmed from `chartroom board --json`. */
export type CrewItem = {
  /** `task` or `inbox`. */
  type: string
  /** The id `chartroom show` and `/continue` take (the board's short id); null for an untagged inbox line. */
  ref: string | null
  short_id: string
  /** The task's project; an inbox item's when the board carries one; else null. */
  project: string | null
  title: string
  /** The task state (`decision`, `working`, `failed`, ...); `inbox` for an inbox item. */
  state: string
  /** ISO time of the item's last event, or null. */
  last_at: string | null
}

/** The board's lanes, as `chartroom board --json` names them. */
export type CrewBoard = {
  generated_at: string
  home: string
  needs_you: CrewItem[]
  in_progress: CrewItem[]
  on_hold: CrewItem[]
  ready: CrewItem[]
  recent: CrewItem[]
}

/** One event line of a task: `<at> <kind>: <text>`. */
export type CrewEvent = { at: string; kind: string; text: string }

/** One item in detail, trimmed from `chartroom show <id> --json`. */
export type CrewDetail = {
  /** `task` or `inbox`. */
  type: string
  id: string
  ref: string | null
  title: string
  project: string | null
  state: string
  reason: string | null
  /** The board lane (`needs_you`, `in_progress`, ...); null for a task off the board. */
  lane: string | null
  live: string | null
  backend: string | null
  /** An inbox item's date and full text. */
  date: string | null
  text: string | null
  waiting_on: string | null
  waiting_until: string | null
  /** The first lines of the brief's commander's intent. */
  intent: string | null
  events: CrewEvent[]
  /** The newest `done` or `failed` event. */
  outcome: CrewEvent | null
  report: { path: string; summary: string | null } | null
  prs: { url: string; state: string }[]
  /** Open artifacts (the durable-artifacts feature); `chartroom artifact show <ref>` prints one. */
  artifacts: { ref: string; title: string; kind: string }[]
  /** Where the worker runs, and the command that takes you there (null when none can). */
  attach: { where: string; command: string | null } | null
  worktree: string | null
}

/** Which view the pane shows. */
export type CrewView = 'list' | 'detail' | 'report'

declare module 'claude-code' {
  interface PluginState {
    'crew-view': {
      /** True once session.start decided this is the XO's session. */
      isXo: boolean
      /** True once the session loaded the captain or chartroom skill; never reset. */
      active: boolean
      /** The last board read; kept while a later poll fails. */
      board: CrewBoard | null
      /** Why the last poll failed, or null. */
      error: string | null
      /** The pane's view: the lanes, one item's detail, or its report. */
      view: CrewView
      /** The id (`ref`) of the item the detail and report views show. */
      selected: string | null
      /** The last `chartroom show` of the selected item; kept while a later one fails. */
      detail: CrewDetail | null
      /** Why the last `chartroom show` failed, or null. */
      detailError: string | null
      /** The selected item's report as last read. */
      report: { path: string; text: string } | null
      /** What the last action did (copied, put in the prompt, or why not). */
      notice: string | null
      /** True after `/crew off`: no band for the rest of the session, until `/crew on`. */
      bandOff: boolean
    }
  }
}
