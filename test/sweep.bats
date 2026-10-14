#!/usr/bin/env bats
# chartroom sweep: what the crew left running, and --apply freeing only the safe part of it.
# The processes here are real (bash and sleep), started in the directories and with the argv
# the rules look at, so detection and the kills themselves are exercised, not a fake ps.

load test_helper
setup() {
  case "${OSTYPE:-}" in msys*|cygwin*) skip "chartroom sweep is off on Git Bash; WSL2 runs this suite as Linux" ;; esac
  common_setup
  cr init >/dev/null
  export CHARTROOM_SWEEP_SETTLE_MINUTES=0
  SPAWNED="$BATS_TEST_TMPDIR/spawned"; : >"$SPAWNED"
  TOOLS="$BATS_TEST_TMPDIR/tools"; mkdir -p "$TOOLS/bin" "$TOOLS/dashboard"
  # A long-running program whose argv is "bash <path> <args...>"; its one child is a sleep.
  for f in vite bin/chartroom dashboard/server.py; do printf 'sleep 300 &\nwait\n' >"$TOOLS/$f"; done
}
teardown() {
  local p
  while read -r p; do
    [[ -n "$p" ]] || continue
    pkill -KILL -P "$p" 2>/dev/null || true; kill -KILL "$p" 2>/dev/null || true
  done <"$SPAWNED"
}

# Start <argv...> in <dir>, detached from bats; prints its pid. (Called inside $(...), its
# parent is that command substitution, which exits: the process is reparented, like a
# daemon a worker left behind.)
spawn() { # <dir> <argv...>
  local dir="$1" pid; shift
  ( cd "$dir" && exec "$@" ) </dev/null >/dev/null 2>&1 3>&- &
  pid=$!; echo "$pid" >>"$SPAWNED"; settle "$pid"; printf '%s' "$pid"
}
# The same, but its parent exits at once, so it is reparented (to init, or a subreaper).
spawn_orphan() { # <dir> <argv...>
  local dir="$1" f="$BATS_TEST_TMPDIR/orphan.pid" pid; shift
  ( ( cd "$dir" && exec "$@" ) </dev/null >/dev/null 2>&1 3>&- & echo $! >"$f" ) 3>&-
  pid="$(cat "$f")"; echo "$pid" >>"$SPAWNED"; settle "$pid"; printf '%s' "$pid"
}
# Wait until the exec has happened (the argv is no longer the subshell's).
settle() { local i; for i in $(seq 1 40); do [[ "$(ps -o args= -p "$1" 2>/dev/null)" == *bash* || "$(ps -o args= -p "$1" 2>/dev/null)" == *sleep* ]] && break; sleep 0.05; done; sleep 0.2; }
alive() { kill -0 "$1" 2>/dev/null; }
gone() { local i; for i in $(seq 1 40); do alive "$1" || return 0; sleep 0.1; done; return 1; }
sweep_json() { cr sweep --json "$@"; }
item_for() { jq -c --argjson p "$2" '[.items[] | select(any(.pids[]; . == $p))] | first // empty' <<<"$1"; } # <json> <pid>

# A task run to its end on the command backend with the stub agent; prints its id.
# TASK_ENV holds stub settings (STUB_MODE=fail, STUB_COMMIT=1, ...).
finished_task() { # [cr new args...]
  local id; id="$(new_task --backend command --command "${TASK_ENV:-} $STUB {id}" "$@")"
  cr dispatch "$id" >/dev/null
  wait_event "$id" ' exited: ' 15
  printf '%s' "$id"
}

@test "sweep: an empty home has nothing to free, and a dry run writes nothing" {
  run cr sweep
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "sweep (dry run): safe to free nothing; needs a human: 0; left alone: "*"; load "* ]]
  [ "${#lines[@]}" -eq 1 ]
  [ ! -e "$CHARTROOM_HOME/sweep.log" ]
  run cr sweep --json
  [ "$(jq -r '.applied, (.items | length), .summary.apply.processes, (.load | has("avg"))' <<<"$output" | tr '\n' ' ')" = "false 0 0 true " ]
  run cr sweep --bogus
  [ "$status" -ne 0 ]; [[ "$output" == *"usage: chartroom sweep"* ]]
  [[ "$(cr help)" == *"chartroom sweep [--apply]"* ]]
}

@test "sweep: a dev daemon in a closed task's worktree is found by its directory; only --apply kills it" {
  id="$(finished_task)"
  wt="$(meta_of "$id" worktree)"
  pid="$(spawn "$wt" bash "$TOOLS/vite" --watch)"
  cr close "$id" >/dev/null # removes the worktree under the running daemon
  [ ! -d "$wt" ]
  json="$(sweep_json)"
  item="$(item_for "$json" "$pid")"
  [ "$(jq -r '.class, .action, .task, .reason' <<<"$item" | tr '\n' '|')" = "daemon|apply|$id|in the worktree of a closed task|" ]
  [ "$(jq -r .what <<<"$item")" = "vite --watch" ]
  [ "$(jq '.pids | length' <<<"$item")" -eq 2 ] # with its child
  run cr sweep
  [[ "${lines[0]}" == "sweep (dry run): safe to free 1 dev process tree(s) = 2 proc(s), "* ]]
  alive "$pid"
  [ ! -e "$CHARTROOM_HOME/sweep.log" ]
  run cr sweep --apply
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "sweep (applied): freed 1 dev process tree(s) = 2 proc(s), "* ]]
  gone "$pid"
  grep -q "killed: $id vite --watch (pid $pid," "$CHARTROOM_HOME/sweep.log"
  grep -q "^[^ ]* sweep: freed 2 process(es)" "$CHARTROOM_HOME/sweep.log"
  events "$id" | grep -q "note: sweep: killed vite --watch (pid $pid,"
}

@test "sweep never touches a process of an in-flight task, even with --apply and no idle threshold" {
  TASK_ENV="STUB_MODE=decision" id="$(finished_task)"
  [ "$(cr status --json | jq -r --arg id "$id" '.[] | select(.id == $id) | .state')" = decision ]
  wt="$(meta_of "$id" worktree)"
  dev="$(spawn "$wt" bash "$TOOLS/vite")"
  ses="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/vite" --add-dir "$CHARTROOM_HOME/tasks/$id")"
  # a working one: its worker is still running
  id2="$(new_task --backend command --command "STUB_SLEEP=60 $STUB {id}")"
  cr dispatch "$id2" >/dev/null
  w="$(meta_of "$id2" pid)"; echo "$w" >>"$SPAWNED"
  [ "$(cr status --json | jq -r --arg id "$id2" '.[] | select(.id == $id) | .state')" = working ]
  dev2="$(spawn "$(meta_of "$id2" worktree)" bash "$TOOLS/vite")"
  json="$(sweep_json --idle-hours 0)"
  [ "$(jq '[.items[] | select(.task == "'"$id"'" or .task == "'"$id2"'")] | length' <<<"$json")" -eq 0 ]
  [ "$(jq .summary.kept <<<"$json")" -ge 6 ]
  run cr sweep --apply --idle-hours 0
  [ "$status" -eq 0 ]
  alive "$dev"; alive "$ses"; alive "$w"; alive "$dev2"
  [ -z "$(meta_of "$id" closed)" ]; [ -z "$(meta_of "$id2" closed)" ]
}

@test "sweep closes a done task that is clean with nothing unlanded, and its session with it; a dry run changes nothing" {
  id="$(finished_task --kind scout)"
  wt="$(meta_of "$id" worktree)"
  ses="$(spawn "$wt" bash "$TOOLS/vite" --add-dir "$CHARTROOM_HOME/tasks/$id")"
  # just finished: it waits until the XO has had time to see the report
  CHARTROOM_SWEEP_SETTLE_MINUTES=60 run cr sweep --json
  [ "$(jq '.items | length' <<<"$output")" -eq 0 ]
  json="$(sweep_json)"
  [ "$(jq -r '.items[] | select(.class == "close") | .action + " " + .task' <<<"$json")" = "apply $id" ]
  [ "$(jq -r '.items[] | select(.class == "session") | .action + " " + .reason' <<<"$json")" = "apply its task closes in this sweep" ]
  [ -z "$(meta_of "$id" closed)" ]; [ -d "$wt" ]; alive "$ses"
  run cr sweep --apply
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "sweep (applied): freed 1 done task(s) closed, 1 session(s) = 2 proc(s), "* ]]
  [ -n "$(meta_of "$id" closed)" ]
  [ ! -d "$wt" ]
  gone "$ses"
  events "$id" | grep -q "note: sweep: closed (done, worktree clean, nothing outside main)"
  grep -q "closed: $id" "$CHARTROOM_HOME/sweep.log"
}

@test "sweep never closes a done task with unlanded commits or a dirty worktree; once merged it does" {
  TASK_ENV="STUB_COMMIT=1" ship="$(finished_task)"
  dirty="$(finished_task --kind scout)"
  echo wip >"$(meta_of "$dirty" worktree)/notes.txt"
  TASK_ENV="STUB_MODE=fail" failed="$(finished_task)"
  ses="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/vite" --add-dir "$CHARTROOM_HOME/tasks/$failed")"
  # fresh: nothing is raised yet (the idle threshold, 24h by default)
  run cr sweep
  [[ "${lines[0]}" == *"needs a human: 0;"* ]]
  run cr sweep --apply --idle-hours 0
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "sweep (applied): freed nothing; needs a human: 3;"* ]]
  [[ "$output" == *"[$ship] done "*"not closeable: 1 commit(s) not in main (unpushed or unmerged)"* ]]
  [[ "$output" == *"[$dirty] done "*"not closeable: uncommitted changes in its worktree (1 path(s))"* ]]
  [[ "$output" == *"[$failed] failed "*"ago; its session is still open (holds 2 proc(s), "* ]]
  [ -z "$(meta_of "$ship" closed)" ]; [ -z "$(meta_of "$dirty" closed)" ]
  [ -f "$(meta_of "$dirty" worktree)/notes.txt" ]
  [ -d "$(meta_of "$ship" worktree)" ]
  alive "$ses"
  # merged into its base: landed, so it closes (the branch is kept, as close always does)
  git -C "$PROJECT" merge -q --ff-only "chartroom/$ship"
  run cr sweep --apply
  [[ "${lines[0]}" == "sweep (applied): freed 1 done task(s) closed;"* ]]
  [ -n "$(meta_of "$ship" closed)" ]
  git -C "$PROJECT" rev-parse --verify -q "chartroom/$ship" >/dev/null
  [ -z "$(meta_of "$dirty" closed)" ]
}

@test "sweep: an orphaned watch of this home is killed; one from elsewhere needs a human; a live one is left alone" {
  orphan="$(spawn_orphan "$CHARTROOM_HOME" bash "$TOOLS/bin/chartroom" watch)"
  pp="$(ps -o ppid= -p "$orphan" | tr -d ' ')"
  if [[ "$pp" != 1 ]] && ! ps -o args= -p "$pp" | grep -qE '(^|/)(launchd|init|systemd)( |$)'; then
    skip "orphans are reparented to $(ps -o args= -p "$pp") here, not init"
  fi
  stray="$(spawn_orphan "$BATS_TEST_TMPDIR" bash "$TOOLS/bin/chartroom" watch)"
  # (not in $(...): its parent must be this test's shell, which stays alive)
  spawn "$CHARTROOM_HOME" bash "$TOOLS/bin/chartroom" watch >"$BATS_TEST_TMPDIR/live.pid"; live="$(cat "$BATS_TEST_TMPDIR/live.pid")"
  json="$(sweep_json)"
  [ "$(item_for "$json" "$orphan" | jq -r '.class + " " + .action + " " + .what')" = "orphan apply chartroom watch" ]
  [[ "$(item_for "$json" "$orphan" | jq -r .reason)" == "its session is gone (parent pid 1"* || "$(item_for "$json" "$orphan" | jq -r .reason)" == "its session is gone (parent init"* ]]
  [ "$(item_for "$json" "$stray" | jq -r .action)" = human ]
  [ -z "$(item_for "$json" "$live")" ]
  run cr sweep
  [[ "$output" == *"[pid $stray] orphaned (its session is gone), but run from "* ]]
  run cr sweep --apply
  [[ "${lines[0]}" == "sweep (applied): freed 1 orphaned loop(s) = 2 proc(s), "* ]]
  gone "$orphan"
  alive "$stray"; alive "$live"
}

@test "sweep: a second dashboard for the home is killed, the tracked one kept" {
  a="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/dashboard/server.py" --port 1 --pidfile "$CHARTROOM_HOME/.dashboard.pid")"
  b="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/dashboard/server.py" --port 2 --pidfile "$CHARTROOM_HOME/.dashboard.pid")"
  other="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/dashboard/server.py" --port 3 --pidfile "$BATS_TEST_TMPDIR/elsewhere/.dashboard.pid")"
  echo "$a 1 127.0.0.1" >"$CHARTROOM_HOME/.dashboard.pid"
  json="$(sweep_json)"
  [ -z "$(item_for "$json" "$a")" ]; [ -z "$(item_for "$json" "$other")" ]
  [ "$(item_for "$json" "$b" | jq -r '.action + ": " + .reason')" = "apply: a second dashboard for this home (the tracked one is pid $a)" ]
  cr sweep --apply >/dev/null
  gone "$b"
  alive "$a"; alive "$other"
}

@test "sweep stops a closed task's leftover session, and never treats a joined session's own directory as its worktree" {
  id="$(finished_task)"
  cr close "$id" >/dev/null
  ses="$(spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/vite" --add-dir "$CHARTROOM_HOME/tasks/$id" --settings "$CHARTROOM_HOME/tasks/$id/claude-settings.json")"
  j="$(cd "$PROJECT" && CLAUDECODE=1 CLAUDE_PID=$$ CLAUDE_CODE_SESSION_ID=sess-x cr join --agent claude --title joined | sed -n 's/^id=//p')"
  cr close "$j" >/dev/null
  mine="$(spawn "$PROJECT" bash "$TOOLS/vite")"
  json="$(sweep_json --idle-hours 0)"
  [ "$(item_for "$json" "$ses" | jq -r '.class + " " + .action + " " + .task')" = "session apply $id" ]
  [ -z "$(item_for "$json" "$mine")" ]
  run cr sweep --apply --idle-hours 0
  [[ "${lines[0]}" == "sweep (applied): freed 1 session(s) = 2 proc(s), "* ]]
  gone "$ses"
  alive "$mine"
  events "$id" | grep -q "note: sweep: stopped "
}

@test "sweep: a process in a chartroom worktree that no longer exists is killed; one no task records needs a human" {
  mkdir -p "$CHARTROOM_HOME/worktrees/proj/ghost" "$CHARTROOM_HOME/worktrees/proj/stray"
  ghost="$(spawn "$CHARTROOM_HOME/worktrees/proj/ghost" bash "$TOOLS/vite")"
  rm -rf "$CHARTROOM_HOME/worktrees/proj/ghost"
  stray="$(spawn "$CHARTROOM_HOME/worktrees/proj/stray" bash "$TOOLS/vite")"
  json="$(sweep_json)"
  [[ "$(item_for "$json" "$ghost" | jq -r '.action + ": " + .reason')" == "apply: its worktree "*"/worktrees/proj/ghost no longer exists" ]]
  [[ "$(item_for "$json" "$stray" | jq -r '.action + ": " + .reason')" == "human: runs in a chartroom worktree no task records ("*"/worktrees/proj/stray)" ]]
  cr sweep --apply >/dev/null
  gone "$ghost"
  alive "$stray"
}

@test "sweep's default output stays short however busy the home is; --verbose and --json carry the detail" {
  # 14 done tasks with commits that never landed, and live work to leave alone
  git -C "$PROJECT" checkout -q -b feature; echo x >"$PROJECT/f"; git -C "$PROJECT" add f; git -C "$PROJECT" commit -qm feat
  git -C "$PROJECT" checkout -q main
  local i id t; t="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for i in $(seq 1 14); do
    id="unlanded-$i"; mkdir -p "$CHARTROOM_HOME/tasks/$id"
    jq -n --arg id "$id" --arg p "$PROJECT" --arg sha "$(git -C "$PROJECT" rev-parse main)" --arg t "$t" \
      '{schema: 1, id: $id, title: "feature \($id)", kind: "ship", backend: "command", project: $p, base: "main", base_sha: $sha,
        branch: "feature", worktree: "", created: $t, updated: $t, dispatched: $t}' >"$CHARTROOM_HOME/tasks/$id/meta.json"
    printf '%s note: dispatched via command\n%s done: shipped\n' "$t" "$t" >"$CHARTROOM_HOME/tasks/$id/events.log"
  done
  id="$(finished_task)"; cr close "$id" >/dev/null
  for i in 1 2 3; do spawn "$BATS_TEST_TMPDIR" bash "$TOOLS/vite" --add-dir "$CHARTROOM_HOME/tasks/$id" >/dev/null; done
  run cr sweep --idle-hours 0
  [ "$status" -eq 0 ]
  [ "${#lines[@]}" -le 15 ]
  [[ "${lines[0]}" == "sweep (dry run): safe to free 1 session(s) = 6 proc(s), "*"; needs a human: 14; "* ]]
  [[ "$output" == *"… 4 more: chartroom sweep --verbose"* ]]
  for i in $(seq 1 "$(( ${#lines[@]} - 1 ))"); do [ "${#lines[$i]}" -le 160 ]; done
  run cr sweep --idle-hours 0 --verbose
  [ "$(grep -c '^  \[unlanded-' <<<"$output")" -eq 14 ]
  [[ "$output" == *"Sessions of finished tasks"* ]]
  [ "$(cr sweep --idle-hours 0 --json | jq '[.items[] | select(.action == "human")] | length')" -eq 14 ]
}
