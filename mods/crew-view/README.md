# crew-view

A Claude Code mod (function hooks, Claude Code 2.1.296 or newer) that shows the chartroom crew
live inside the XO's session:

- **A band above the prompt**, one line, one emoji per lane with its count, every item that
  needs you labelled with its project:

  ```
  ⚓ 🏃 3 · 🙋 2 [shop] 108a, [billing] 9c1e · 💤 1 · ✅ 1 · ❌ 1                [ crew ]
  ```

  | | lane |
  | --- | --- |
  | 🏃 | running |
  | 🙋 | needs you (a decision, a blocker, an inbox item) |
  | 💤 | on hold |
  | ✅ | landed |
  | ❌ | failed |

  A lane appears only when something is in it. Each emoji is wide on its own code point (no
  variation selector, so no `⏸️`), and the band counts it as two columns. A narrow terminal cuts the needs-you list to
  `+N more`, never mid-item. `[ crew ]` (or its hotkey `c` once the band has focus: ctrl+x tab or a
  click) opens the pane. If `chartroom` is missing or fails, the band shows one dim error line.
- **A `/crew` pane** led by the emoji legend, then the board's lanes (needs you, running, on
  hold, landed, failed), one row per item: `[project] short_id title state age-of-last-event`,
  sized to the pane.

It reads `chartroom board --json` (chartroom on PATH, else `~/.local/bin/chartroom`) when it
wakes, every 15 seconds after, and whenever the pane opens.

## XO only, once the skill is loaded

Installed at user scope, the mod loads in every Claude Code session, crew workers' included. It
does nothing (no command, no timer, no process, no drawing) until the session loads the
`captain` or `chartroom` skill (`/captain`, `/chartroom`, or the Skill tool; the `skill.prompt`
event), and then only if all of these hold:

1. the session is interactive (not `claude -p`);
2. `CHARTROOM_TASK` is unset;
3. the working directory has no `worktrees` path segment;
4. the working directory is the chartroom home, resolved as the CLI resolves it:
   `$CHARTROOM_HOME`, `$CAP_HOME`, `CHARTROOM_HOME=` in the config file
   (`$CHARTROOM_CONFIG` or `${XDG_CONFIG_HOME:-~/.config}/chartroom/config`), then `~/.chartroom`
   (or a pre-existing `~/.captain`).

The check reads environment variables and files only; it never runs a process. Once awake the
mod stays awake for the session (kept in `$.state`, so a hot reload keeps it). If a resumed session
(`claude --resume`) comes back without the band, load the skill again.

## Install

At a Claude Code prompt:

```
/plugin install crew-view@chartroom
```

(`/plugin marketplace add wolzey/chartroom` first if you have not added the marketplace.)
Choose the user scope, so it is there whenever you start the XO in your home.

To run it from a checkout instead, so edits take effect without reinstalling:

```bash
claude plugin marketplace add ~/.local/share/chartroom   # or your clone
claude plugin install crew-view@chartroom
```

A marketplace that is a folder is read from that folder: after an edit (or a `git pull`), run
`/reload-plugins` in the session. To try it for one session without installing:
`cd ~/.chartroom && claude --plugin-dir <checkout>/mods/crew-view`.

## Develop

```bash
claude plugin validate mods/crew-view
claude plugin test mods/crew-view
tsc -p mods/crew-view      # needs .claude-plugin/types/, which Claude Code lays at each load
```

Claude Code writes `.claude-plugin/types/` (the API's declarations, git-ignored) when it loads
the mod from a folder it watches (`claude --plugin-dir` in an interactive session). Before that,
copy the declarations the plugin-authoring skill names into
`.claude-plugin/types/claude-code/index.d.ts`.

`hooks/crew.ts` holds the pure parts (home resolution, board parsing, band and pane text);
`hooks/register.tsx` the hooks; `types/index.d.ts` the `$.state` contract.
