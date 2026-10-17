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
- **A `/crew` pane that browses the items**, the web dashboard's equivalent inside Claude Code.
  It leads with the emoji legend, then the board's lanes (needs you, running, on hold, landed,
  failed), one row per item: `[project] short_id title state age-of-last-event`, sized to the
  pane. `/crew` opens it with the keyboard: Tab or the arrows walk the rows, Enter opens one,
  Esc hands the keys back to the prompt. `/crew <id>` opens that item straight away.

  An item opens into its detail:

  ```
  108a  [shop] Auth project-manager
  🙋 decision · needs you · live running · herdr:claude
  c: continue  y: copy id  p: copy PR  r: report  a: copy artifact  b: back
  INTENT
    Make login use passkeys. Keep the old flow behind a flag.
  LAST EVENTS
     12m decision: pick A or B (recommend A)
  REPORT  ~/.chartroom/tasks/auth-project-manager-108a/report.md
    PR 7 is open.
  PRS
    https://github.com/acme/shop/pull/7
  ARTIFACTS
    108a/note-for-chris  Note for Chris (message)
  WORKER
    herdr tab w1:t2 · chartroom attach auth-project-manager-108a
  ```

  An inbox item shows its question in full. Each action has a one-letter hotkey:

  | key | action |
  | --- | --- |
  | `c` | continue: puts `/continue <id>` in an empty prompt and hands it the keys, so Enter runs it. A draft in the prompt is never replaced: the line is copied instead, and the pane says so |
  | `y` | copy the short id |
  | `p` | copy the (first) PR URL; Enter on a PR line copies that one |
  | `r` | read the report in the pane, rendered as markdown (`b` comes back) |
  | `a` | copy the (first) open artifact's text (`chartroom artifact show <ref>`); Enter on an artifact line copies that one |
  | `b` | back to the lanes |

  The line under the actions says what the last one did (copied, in the prompt, or why not).
  There are no write actions beyond these: nothing merges, steers or closes from the pane.

It reads `chartroom board --json` (chartroom on PATH, else `~/.local/bin/chartroom`) when it
wakes, every 15 seconds after, and whenever the pane opens; `chartroom show <id> --json` when an
item opens, and again with each poll while it is open.

### What this Claude Code build supports

Checked against Claude Code 2.1.302: its API declarations (`.claude-plugin/types/`), the test kit
(`claude plugin test`), and a live session in a terminal. Live, a `/crew` pane opened with
`focus` takes the keyboard; the arrows walk its Buttons and Enter presses one; a Button's
one-letter `hotkey` presses it while the pane holds the keys; `$.ui.focus` moves the ring
(back to the row you came from); `$.prompt.fill` puts `/continue <id>` in the prompt and hands
the keys to it; a `Markdown` element draws the report; a hot reload keeps the session awake.
The mod does not submit `/continue` itself (`$.command.run` could): you see the line and press
Enter. Copying goes through `$.ui.copy` (the terminal's clipboard tool, or OSC 52); the tests
check what is copied, not a terminal's clipboard. By the API's own rules a pane opened from the
band's `[ crew ]` button does not take the keyboard (the band holds it); `/crew` does.

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

`hooks/crew.ts` holds the pure parts (home resolution, board and detail parsing, band, pane
and detail text, the actions); `hooks/register.tsx` the hooks; `types/index.d.ts` the `$.state`
contract. `mods/crew-view-pi` imports `hooks/crew.ts` too, so a change there changes both.
