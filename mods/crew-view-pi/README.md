# crew-view for pi

A [pi](https://pi.dev) extension (pi 0.87 or newer), the pair of [`mods/crew-view`](../crew-view)
for Claude Code: chartroom's crew, live inside the XO's pi session.

- **A band above the editor**, one line, one emoji per lane with its count, every item that
  needs you labelled with its project:

  ```
  ⚓ 🏃 3 · 🙋 2 [shop] 108a, [billing] 9c1e · 💤 1 · ✅ 1 · ❌ 1  /crew
  ```

- **`/crew`, a browser of the items.** It takes over the editor's place until you close it:
  the board's lanes, ↑/↓ (or `j`/`k`) to move, Enter to open an item, `q` or Esc to close.
  `/crew <id>` opens that item straight away. An item shows its state, the commander's intent,
  the last events, the report's summary or the outcome, PRs, artifacts and where the worker
  runs, with the same one-letter actions as the Claude Code pane:

  | key | action |
  | --- | --- |
  | `c` | continue: closes the browser and puts `/skill:continue <id>` (pi's spelling of `/continue`) in an empty editor; a draft is kept and the line copied instead |
  | `y` | copy the short id |
  | `p` | copy the first PR URL |
  | `r` | read the report, rendered as markdown (`b` or Esc comes back) |
  | `a` | copy the first artifact's text (`chartroom artifact show <ref>`), once the CLI has artifacts |
  | `b`, Esc | back to the lanes |
  | `q` | close the browser |

It reads `chartroom board --json` (chartroom on PATH, else `~/.local/bin/chartroom`) when it
wakes and every 15 seconds after, and `chartroom show <id> --json` when an item opens. The lane,
band and detail text come from the Claude Code mod's own helpers (`../crew-view/hooks/crew.ts`),
so the two views never disagree.

## XO only, once the skill is loaded

Installed for your user, it loads in every pi session. It does nothing (no command, no timer,
no process, no drawing) until the session loads the `captain` or `chartroom` skill
(`/skill:captain`, `/skill:chartroom`, or the model reading either skill's `SKILL.md`), and then
only if all of these hold:

1. the session is pi's interactive TUI (not `pi -p`, JSON or RPC mode);
2. `CHARTROOM_TASK` is unset;
3. the working directory has no `worktrees` path segment;
4. the working directory is the chartroom home, resolved as the CLI resolves it
   (`$CHARTROOM_HOME`, `$CAP_HOME`, the config file, then `~/.chartroom` or a pre-existing
   `~/.captain`).

The check reads environment variables and files only. Once awake it stays awake for the
session: a session entry records it, so `/reload` and a resumed session wake again by themselves.

## Install

The skills first (`chartroom install-skills --pi`), then the extension, as a local pi package
read from your chartroom checkout (nothing is copied, so a `git pull` there updates it; `/reload`
in a running session):

```bash
pi install ~/.local/share/chartroom/mods/crew-view-pi    # or <your clone>/mods/crew-view-pi
pi remove ~/.local/share/chartroom/mods/crew-view-pi     # to take it out again
```

To try it for one session: `cd ~/.chartroom && pi -e <checkout>/mods/crew-view-pi`.

It imports `../crew-view/hooks/crew.ts`, so it runs from a chartroom checkout as above, not as a
package published on its own.

## Develop

pi loads TypeScript directly (jiti), so there is no build step. To type-check, point `tsc` at
pi's own declarations: a tsconfig with `"moduleResolution": "bundler"`, `"types": ["node"]`, and
`paths` mapping `@earendil-works/*` to the directory pi is installed in (for a bun global
install, `~/.bun/install/global/node_modules/@earendil-works/*`). The shared logic is tested
with the Claude Code mod (`claude plugin test mods/crew-view`).
