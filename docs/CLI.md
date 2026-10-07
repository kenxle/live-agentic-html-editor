# Every invocation

**Things a person says to their agent.** An agent that has never seen this tool
needs the [`AGENTS.md`](../AGENTS.md) URL once, which leads it to install and the
lahe skill; after that a plain sentence works:

> Set up a live review of `path/to/page.html`: follow
> https://raw.githubusercontent.com/kenxle/live-agentic-html-editor/main/AGENTS.md

> Open this page for a live review. You have `lahe` installed.

**The CLI.** Every command also runs uninstalled as `node bin/lahe.js ...`.

| Command | What it does |
| --- | --- |
| `lahe review path/to/page.html` | Start a review and isolated agent session: starts or reuses its static server and the shared helper, then prints one URL plus the wake, monitor, drain, and close commands. It writes NOTHING into the page's folder: the server puts the script line into each response instead |
| `lahe review path/to/folder` | A folder of HTML pages that is itself the document: serves the whole folder, mints ONE review for it, and opens `index.html` (else the first page in name order). The folder needs at least one `.html` file of its own; one with none is still the dev-server row |
| `lahe review path/to/notes.md` | A Markdown file that is the whole document: LAHE renders it to HTML in its own state directory and puts the review on that render. Your `.md` is never written to. The agent edits the `.md` and replies; it does not rerun anything, because the helper notices the source is newer and renders again by itself. In the rendered page, a link that leaves the documentation opens in a new tab, and a link to another local `.md` opens as another rendered page in the same tab, with the editor (see `--only`) |
| `lahe write path/to/notes.md` | Notes on a blank page: creates the Markdown file when it does not exist (its folder must), or opens it unchanged, and prints what `lahe review` prints. It refuses a name that is not `.md` or `.markdown`, a directory, any symlink, dangling or not, and a file with more than one hard link, and it never overwrites. The file is read without following a symlink, on every render. It prints the folder's real path on the `notes in` line. The page gets its own one-page server: that page, the Lahe style and fonts it names, and a 404 for everything else, dotfiles and other reviews' pages included. It answers only its own loopback address (`127.0.0.1` or `localhost` at its port); any other Host is a 404. `lahe review <file.md> --session <id>` on a notes file brings it back the same way: page mode follows the review, not the command. `--session <id>` joins an agent session and still starts its own server; `--name` names the session. The review carries `notes: true`, so long sittings are not proofread |
| `lahe review ... --only` | Keep this review to the page it was given. The default is the opposite: our server serves the page's whole folder and the rail follows the reviewer onto every HTML page in it, including pages added later, so a link or a typed filename never lands them somewhere they cannot comment. Use `--only` when that folder holds files nobody asked to review, a Downloads folder or a Desktop. It cannot be undone on a review afterwards. For a Markdown review it also keeps the documents the page links to read-only; without it, a linked document with no review of its own carries this review's rail, and one with its own review in the session opens that review's page. `lahe review` prints the served `root`, which is the line that tells you whether you want this |
| `lahe review another.html --session <id>` | Add a later document to the same agent workstream without receiving another agent's comments |
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints a commented snippet that you must wrap in your framework's development-only conditional |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe add ... --review <id>` | Re-attach this page to a review that already exists, by id |
| `lahe status [--session <id>] [--review <id>] [--json]` | What is open right now. Agent monitors must name their session; plain global status is only a human diagnostic |
| `lahe reply --review <id> --item <itm> --rev <n> --status handled\|not_handled\|question` | Write one reply. Add `--text` or `--reason` for what you want to say, `--file <path>` per file you changed, `--needs-see` when the reviewer should read it, `--agent <name>` for the card and the per-agent file. The command encodes the JSON, so a newline or a quote in your answer cannot split the line |
| `lahe reply ... --status question --proofread --suggest <block> <from> <to>` | A proofreading question on an item that carries `proofread: true`. Place the reviewer's words as written first, then ask. `--suggest` is one fix: in `new_blocks[<block>]`, change `<from>` to `<to>`; repeat it for each fix. The command reads the item from `review.json` at the rev you name and refuses, by name, a suggestion whose `<from>` is not in that block's words exactly once (`SUGGESTION_NOT_FOUND`), and refuses the whole line when the rev is not the item's current one. Both flags belong on `--status question` only, and `--suggest` needs `--proofread` |
| `lahe monitor --session <id>` | Poll locally without model wakeups, print unanswered session work, and exit |
| `lahe monitor --session <id> --session <other>` | Watch several sessions with one monitor. The first is the primary. A session that closes or is taken over is dropped with a line and the rest are still watched |
| `lahe library [--session <id>] [--name <name>] [--json]` | Start the helper if needed and print the Library's address, the helper's own origin plus `/catalog`. It never opens a browser: run `open` on the URL. `--session` attaches your session, so the Library hands its Pick this up and Launch requests to you; the session must be open, and the last one attached wins. Without `--session` it always starts a new agent session (no reviews), attaches it, names it with `--name`, and prints the session id and its monitor, drain and close commands, as `lahe review` does. Run it bare the first time, then pass the `--session` it printed. A session a bare run started is marked `created_by: "library"` in session.json, and the helper closes it once it owns no reviews and its agent has run no monitor and no lahe command for `CATALOG.LIBRARY_SESSION_IDLE_MS` (30 minutes). `--json` prints `{url, attached, helper_started, session, session_created}` |
| `lahe library serve <request-id> --session <id>` | Serve the document a `legacy` or `worktree` pickup names, as `lahe review` does. The command reads the path itself (a legacy row's own document, or a worktree row's checked main-repo candidate), so no page-derived path passes through a shell. A legacy row is served on its own review, taken into your session with its old comments (`lahe review --review <id> --adopt`): it belongs to no session, so this moves nothing from another agent. The command prints that. `--session` is your own session, the one the request is for. |
| `lahe library answer <request-id> --session <id> --status done\|refused --text "..."` | Answer one request from the drain's `catalog_requests` section. `--session` is your own session, the one the request is for. The text shows on the Library row, at most 500 characters. Refused: an unknown id, another session's request, an expired request, a second answer (it prints the first), and text that is too long |
| `lahe session list [--json]` | Read-only: every agent session on this machine, open ones first, with its handoff revision, reviews owned, unanswered items, whether anything is listening to it, and when the agent last replied. This is how you find a session id |
| `lahe session close <id>` | Close an agent workstream, stop its static servers, and keep all review history. The final close also stops the shared helper, unless the Library page polled it in the last two minutes or a review page is still open. When it leaves the helper up, it writes `stop-when-quiet.json` to the state dir, and the helper then stops itself once there is no open session, no open review window and no Library poll for two minutes in a row. A session opened in the meantime cancels that, and so does a new helper starting up. After a sleep, the two minutes start again from the wake. A helper or page server whose state dir is removed stops within 30 seconds (two 15-second checks in a row), even with a session open. A restored or synced copy of the dir that still names that process keeps it running. Separately, the helper stops a session's static servers after two minutes with no browser window open on its pages; the session stays open, and `lahe review <document> --session <id>` brings the page back on its old port when that port is free |
| `lahe session reopen <id>` | Reopen the workstream and restart its helper and static servers |
| `lahe session takeover <id>` | Explicitly hand an existing workstream to a new agent, fence its older monitors, and print catch-up commands. Add `--name "<name>"` to record the new agent's name at the same time |
| `lahe session name <id> "<name>"` | The human's name for this session, as the host shows it (Claude Code after `/rename`). The reviewer's rail uses it to say which agent to check, and `session list` prints it after the id. Trimmed, control characters removed, 80 characters at most; `""` clears it |
| `lahe session name <id> --from-review <review>` | Name the session after that review's document, as the Library shows it. The command reads the name itself, so a page title never passes through a shell. The review must belong to the session. Used when launching an agent from the Library |
| `lahe review ... --name "<name>"` | Start or add to a session and record its name in one step |
| `lahe style add <folder>... [--state-dir <path>]` | Install a downloaded document style for every Lahe page on this machine. It checks each folder and copies only `style.css`, `metadata.json`, `fonts/*.woff2`, `DESIGN.md` and licence files into `<state dir>/styles/<id>/`, where the id is the folder's name, lowercased, with spaces and underscores as hyphens. Installing the same id again replaces it. A refused folder exits `1` with the reason and what a style folder needs: a `name` in `metadata.json`, a stylesheet that reaches only its own fonts (`url("./fonts/<file>.woff2")`) and `data:` images, no `@import`, no other `url()`, no backslash escape outside a string, and no symlinks. `international` is the house style's id and cannot be installed |
| `lahe style list [--state-dir <path>]` | Print each installed style's id, name and version, and any hand-copied folder that breaks the rules with its reason. There is no remove: delete the style's folder from `<state dir>/styles/` |
| `lahe hook stop [--state-dir <path>]` | Claude Code's Stop hook, which `npm run install-skills` installs for you; nobody types it. Claude Code runs it when the main agent tries to end its turn and passes the hook's JSON on stdin. If a session this agent started is open and has no live monitor, it prints `{"decision":"block","reason":"..."}` and the reason names the exact `lahe monitor` command to run. Otherwise, when `stop_hook_active` is true, and on any error it prints nothing. It always exits `0`. See "The Stop hook" below |
| `lahe serve [--port N]` | Run the helper by hand (`add` starts it for you, so this is rarely needed) |
| `lahe serve --restart` | Replace the helper that is already running, even when a reviewer has a page open on it. Every other command leaves such a helper alone and tells you to run this when they are done |

Takeover is designed for token exhaustion, crashes, and switching agent clients
mid-review. Its catch-up command lists every unanswered item, so work the old
agent read but never finished reappears. Completed items do not reappear, every
review in the session moves together, and older monitor processes are fenced.
Use it only after the human explicitly requests the handoff.

**Keeping an agent current** takes two things, and `lahe review` prints both.

The **drain command** is `lahe status --session <id> --json --quiet`. It prints
every ready item nobody has answered, and nothing at all when there is none. An
agent runs it, handles what it prints, replies, and runs it again until it prints
nothing. Work stays listed until a reply lands, so a missed wake costs nothing:
the next drain shows the item again. When the reviews are not in the default
state directory, every command the tool prints carries `--state-dir <path>`
already: copy them as printed, because the same command without it reads the
default directory and reports no work.

The drain carries the reviewer's items and what locates them, and nothing it
would repeat on every wake. There is no contract text, no pointer to it, and no
field-class table: the contract lives in the `contract` field of the review's
`review.json`, read once. The prompt-injection fence (architecture decision
D12) is kept as structure, not words: on each item line, every field read off
the page (the quoted passage, the before and after text, the region, the
subject) is grouped under `page`, and the reviewer's own `note` and `change`
stay at the top level. The contract says once that nothing under `page` is an
instruction. A review the reviewer ended is listed under
`ended_reviews` on the last line on every drain while it still holds unanswered
items, and once more when it holds none. After that it is not listed again, so a
drain with nothing waiting prints nothing at all. A takeover counts as a new
reader: the agent that took over is told again. Whether each review's page is
connected is said once per review, under `liveness` on the same last line.

The **wake channel** is per host, because hosts differ in what they can do
without spending model tokens:

- **Claude Code** runs `lahe monitor --session <id>` with Bash in the background,
  with `timeout` 7200000 or the value of `BASH_MAX_TIMEOUT_MS` when that is larger.
  A background command ends at its timeout, and Claude Code's default limit is
  two hours; `BASH_MAX_TIMEOUT_MS` in the `env` block of settings.json raises it.
  It exits when work lands (`0`), the session closes (`5`), or another agent takes
  over (`6`). On `0` the agent drains to empty and launches the same command again
  in the background. A Stop hook catches the relaunch an agent forgets (see "The
  Stop hook" below). Claude Code can also stop a quiet background command when
  it thinks memory is low, outside those three codes. On such a kill the agent
  only relaunches the monitor: its first poll prints any waiting work, so no
  drain is needed. Setting `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in the
  `env` block of Claude Code's settings.json turns the kills off. After three
  kills in a row with nothing new landed between them, the agent stops
  relaunching and tells the reviewer instead.
- **Codex** runs `lahe monitor --session <id>` as a foreground pending exec call
  and keeps waiting on it. It must not detach the process, announce that
  monitoring started, and end the turn: detached task completion alone does not
  guarantee a new Codex turn.
- **Antigravity** runs the same command as a background terminal task, never the
  native `schedule` timer, which invokes Gemini on every no-op.
- **Any other host** runs it in the foreground after telling the user how to
  interrupt it.

The monitor keeps its idle polling in one small local Node process, so no host
pays model tokens for a quiet document. It prints `LAHE ACTION REQUIRED` ahead of
the work, on both stdout and stderr. That is an interrupt, not a stopping point:
the agent continues the same turn through editing, rebuilding, verification, and
replies. Merely reporting that an item arrived is a workflow failure.

Monitor exit codes tell a host what to do next: `0` work is printed, `4` bad
usage or a live monitor already holds the session, `5` the session is closed, and
`6` another agent took it over. On `5` or `6`, stop relaunching.

**The Stop hook** (Claude Code only). Relaunching the monitor after every exit is
the step agents forget, so on Claude Code the host enforces it. Claude Code runs
a Stop hook each time the main agent tries to end its turn, and `lahe hook stop`
is that hook:

- **Which sessions it checks.** It reads the agent's own transcript, from the
  `transcript_path` Claude Code passes, and counts an id only where it proves
  ownership: a `lahe monitor --session <id>` command (run by the agent, or
  printed by `lahe review`, `lahe library` or the monitor's relaunch line),
  `lahe library`'s "started for this agent" line (or, with `--json`,
  `"session_created":true`), and `lahe session takeover`'s output with the
  handoff revision it printed. An id the agent only read about, in a
  `meta.json` or a `session list` row, does not count.
- **It reads 32 MB at most.** The scan reads the transcript from its end and
  stops after 32 MB. Session ids are printed again on every monitor relaunch, so
  the recent end is where they are; a session whose last monitor command is
  further back than that is not seen.
- **Which of those need a watcher.** The session must exist in the state
  directory (the one a printed `--state-dir` names, else the default), be open
  (not closed, so its monitor would not exit `5`), still be at the handoff
  revision this agent holds (so a monitor would not exit `6`), and own at least
  one review the reviewer has not ended, or no reviews at all. It needs a
  watcher when no monitor heartbeat is at this handoff revision from a pid that
  still exists. The heartbeat's age is not checked, unlike the rail's 45-second
  rule: after the machine sleeps, a live monitor has not looped yet, and a block
  then would start a second one. A default state directory that is refused
  only drops the default from the search.
- **What it prints.** For those sessions, one block whose reason names the
  monitor command (one command per state directory, every session in it) and
  says to run it with Bash `run_in_background` and the largest timeout allowed.
  Nothing when `stop_hook_active` is true, so it blocks at most once per turn.
  Nothing on any error. It always exits `0`.

`npm run install-skills` (and `npm run install-cli`, which runs it) adds the
hook to `~/.claude/settings.json` under `hooks.Stop`:

```json
{ "hooks": [ { "type": "command", "timeout": 10,
               "command": "\"/abs/path/to/node\" \"/abs/path/to/clone/bin/lahe.js\" hook stop 2>/dev/null || true" } ] }
```

Both paths are absolute, like the `install-cli` wrapper. The `2>/dev/null ||
true` tail means a clone that moved or a Node that was removed makes the hook a
silent no-op rather than a hook error on every turn in every project; run the
installer again from the new place to bring it back. From a git worktree the
installer skips the hook with one line saying to install from the main clone,
since a worktree is usually removed when its work lands. The installer keeps
every other hook and setting, writes the file beside and renames it, writes
through a symlinked `settings.json`, and leaves a file it cannot parse alone. It
knows its own entry by the command ending in `lahe hook stop`, with or without
the tail, so running it again changes nothing and running it from a moved clone
replaces the old entry. To remove the hook, run
`node scripts/install-skills.js --remove-hook` from the clone.

Known limits of the Stop hook:

- The transcript is read as latin1, one byte per character. Every pattern it
  looks for is ASCII, so ids are found, but a `--state-dir` path with
  non-ASCII characters in it is not matched.
- A `--state-dir` written as a Windows path (backslashes, a drive letter) is not
  matched, and the `2>/dev/null || true` tail assumes a POSIX shell runs the
  hook command.
- A heartbeat pid that the OS has reused for another process reads as a live
  monitor until that process exits.

**The Library** is one page, at the helper's `/catalog`, that lists every review
on the machine. The reviewer opens and stars documents there directly. Its two
agent buttons, Pick this up and Launch a new agent, queue a request for the
agent attached to the Library: the one that ran `lahe library --session`, or the
session plain `lahe library` started for it. The request reaches that agent in its
drain, in `catalog_requests`, and wakes its monitor once. The agent acts on it
and answers with `lahe library answer`, and the answer shows on the Library
row. A request expires if the agent's monitor stops, another agent attaches, or
30 minutes pass. After a pick-up the agent owns two sessions, so it watches both
with one monitor: `lahe monitor --session <its own> --session <the document's>`.
The skill has the steps for each kind of request.

**The rail carries one line, and it does two jobs.** Most of the time it is a
quiet indicator that the chain is intact: `Stored · agent listening`, or `Stored ·
no agent listening` when nothing on this computer has the review open. That is
the answer to the only question a reviewer asks at the start and after a break.
Hovering it gives the detail: whether the helper is answering, whether an agent
has the review open, when the agent last replied, and where the work is stored.

When something they submitted has gone unanswered for more than 30 seconds, the
line speaks: `Stored · nothing back yet, 45s`, `Stored · agent is working, 5m`
when the agent has run commands in the last few minutes, or `Stored · nobody has
picked this up, 7m` when nothing has the review open. The rail's head menu
already carries Copy review and Export review to file, permanently available, so
the reviewer's own copy of their feedback is never more than a menu click away.
The line goes loud past ten minutes whatever the machine can see: a file tail
can be armed all afternoon over an agent that stopped reading. When nothing on
this computer has the review open, it goes loud sooner, after two minutes. Not
at thirty seconds: an agent thinking through a hard comment leaves no footprint
while it thinks, and that looks exactly like an empty chair.

The reviewer is never told about monitors, heartbeats or wake feeds. That is our
plumbing, and it is not something they can act on. `lahe session list` is where
that view lives instead.

How the helper knows an agent is there: `<state-dir>/agent-sessions/<id>/wake.log`
is our file, created for exactly one purpose, and nothing else on the machine has
any reason to hold it open, so a process holding it open is an agent watching that
session. The helper asks with `lsof`, cached for 15 seconds and off the poll path.
A machine that cannot answer says so, and the line falls back to the wait, which
is always knowable.

**Cmd-Shift-1 opens and closes the review panel.** The collapsed pill names the
chord on hover, and the choice is remembered per review the way the collapse arrow
and the pill remember it.

**A reviewer presenting the page can hide the whole tool.** The rail's menu
carries "Hide for presenting (Cmd-Shift-X)", and that chord toggles it either
way: hidden, nothing of LAHE is on the screen and its gestures do nothing, while
sync keeps folding replies in the background so they are waiting the moment the
reviewer comes back. The choice is remembered per review, and a page that should
always come up hidden carries `data-lahe-start="hidden"` on its script tag.

**A framed page does not boot.** When the library finds itself inside an iframe
it mounts nothing, so a reveal.js speaker-notes window (which embeds the deck in
a frame) cannot fight the real window over the review; `data-lahe-frames="allow"`
on the script tag opts a genuinely embedded document back in.

**If the page is build output**, an agent should rebuild before it reports an
item handled: `handled` is supposed to mean your page shows the change. That is
now checked rather than taken on trust. When an agent says handled for one of
your own hand edits, and nothing in the source or the page has been written
since you typed those words, the helper looks for your words in the built page.
If they are not there, the item stays on your card and on the agent's list, and
the card says the change has not reached your page. An agent that did real work
is never second-guessed on its wording; the one thing this catches is an agent
answering handled having changed nothing. It does
not have to re-run `lahe add` afterwards, and on the served path there is nothing
for a rebuild to strip: the script line lives in the response, not in the file,
so a rebuild that rewrites the whole page cannot take the rail with it. The
on-disk line still exists for a page opened from disk or added with plain `lahe
add`, and there a running helper puts a stripped line back: it is already
watching that file, so when the file returns without the line, the helper writes
the same line back (same review, same token) and refreshes the fallback copy
beside the page. `lahe status` says which of the two is carrying your page.
Re-run `add` when no helper is up, when the page is served from a new
origin, or to record a `--source` path. You do not have to reload: the page
updates itself. The helper watches
the file the review was added at, and when a rebuild lands, your page reloads
onto the new version and re-applies your outstanding comments and edits.
It waits while you are mid-work, so a page never swaps under an open edit or a
comment you are still typing, and it says "Page updated. Reloading..." on the
rail first. If your page is served by a dev server that hot-reloads on its own,
that keeps working and this does not fight it: the reload is one per rebuild
either way.

**The files, which are the agent's real interface.** In the review folder that
`add` names: `review.json` is what an agent reads (its top-level `contract`
field is the whole contract), and `replies.jsonl` (or `replies-<agent>.jsonl`)
is where an agent answers, one appended JSON line per item. `events.jsonl` is
the append-only history underneath both.

Write that line with `lahe reply`, not with `echo`. The command encodes the
JSON, so a paragraph break or a quote in an agent's answer lands as `\n` and
`\"` instead of splitting one object across three physical lines that the
helper then rejects one by one. Hand-appending still works and is still read:
if you do it, the whole object goes on one physical line and every newline
inside `text` or `reason` is the two characters backslash n.


**A page uses an installed style through one line.** In an HTML page written
for review, `<link rel="stylesheet" href="./.lahe-styles/<id>/style.css">` goes
directly after the `./.lahe-doc-style.css` link. In a Markdown file it is the
frontmatter line `lahe-style: <id>`, lower case, no quotes; the renderer turns
it into that same link after the house style, and a frontmatter block that
holds only this line is not shown on the page. Every Lahe page server answers
any path with a `.lahe-styles` segment from the installed styles, never from
the disk, and checks the stylesheet again each time the file changes. A style
that is not installed falls back to the house style; one that breaks a rule is
a 404 and one line in `helper.log` naming the style and the reason. A rendered
Markdown file gets the style's stylesheet and fonts copied beside it, so the
file opened from disk still shows the style.
