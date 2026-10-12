// The values crew-view keeps in $.state (module variables reset on a hot reload).

/** One board row as the band and the pane draw it, trimmed from `chartroom board --json`. */
export type CrewItem = {
  /** `task` or `inbox`. */
  type: string
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

declare module 'claude-code' {
  interface PluginState {
    'crew-view': {
      /** True once session.start decided this is the XO's session. */
      isXo: boolean
      /** The last board read; kept while a later poll fails. */
      board: CrewBoard | null
      /** Why the last poll failed, or null. */
      error: string | null
    }
  }
}
