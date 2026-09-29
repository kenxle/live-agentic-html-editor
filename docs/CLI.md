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
| `lahe review path/to/notes.md` | A Markdown file that is the whole document: LAHE renders it to HTML in its own state directory and puts the review on that render. Your `.md` is never written to. The agent edits the `.md` and replies; it does not rerun anything, because the helper notices the source is newer and renders again by itself. In the rendered page, a link that leaves the documentation opens in a new tab, and a link to another local `.md` opens as another rendered page in the same tab, read-only |
| `lahe review ... --only` | Keep this review to the page it was given. The default is the opposite: our server serves the page's whole folder and the rail follows the reviewer onto every HTML page in it, including pages added later, so a link or a typed filename never lands them somewhere they cannot comment. Use `--only` when that folder holds files nobody asked to review, a Downloads folder or a Desktop. It cannot be undone on a review afterwards. `lahe review` prints the served `root`, which is the line that tells you whether you want this |
| `lahe review another.html --session <id>` | Add a later document to the same agent workstream without receiving another agent's comments |
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints a commented snippet that you must wrap in your framework's development-only conditional |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe add ... --review <id>` | Re-attach this page to a review that already exists, by id |
| `lahe status [--session <id>] [--review <id>] [--json]` | What is open right now. Agent monitors must name their session; plain global status is only a human diagnostic |
| `lahe reply --review <id> --item <itm> --rev <n> --status handled\|not_handled\|question` | Write one reply. Add `--text` or `--reason` for what you want to say, `--file <path>` per file you changed, `--needs-see` when the reviewer should read it, `--agent <name>` for the card and the per-agent file. The command encodes the JSON, so a newline or a quote in your answer cannot split the line |
| `lahe monitor --session <id>` | Poll locally without model wakeups, print unanswered session work, and exit |
| `lahe monitor --session <id> --session <other>` | Watch several sessions with one monitor. The first is the primary. A session that closes or is taken over is dropped with a line and the rest are still watched |
| `lahe library [--session <id>] [--name <name>] [--json]` | Start the helper if needed and print the Library's address, the helper's own origin plus `/catalog`. It never opens a browser: run `open` on the URL. `--session` attaches your session, so the Library hands its Pick this up and Launch requests to you; the session must be open, and the last one attached wins. Without `--session` it always starts a new agent session (no reviews), attaches it, names it with `--name`, and prints the session id and its monitor, drain and close commands, as `lahe review` does. Run it bare the first time, then pass the `--session` it printed. A session a bare run started is marked `created_by: "library"` in session.json, and the helper closes it once it owns no reviews and its agent has run no monitor and no lahe command for `CATALOG.LIBRARY_SESSION_IDLE_MS` (30 minutes). `--json` prints `{url, attached, helper_started, session, session_created}` |
| `lahe library serve <request-id> --session <id>` | Serve the document a `legacy` or `worktree` pickup names, as `lahe review` does. The command reads the path itself (a legacy row's own document, or a worktree row's checked main-repo candidate), so no page-derived path passes through a shell. A legacy row is served as a fresh review in your session (`lahe review --new`), since the legacy review belongs to no session; the old comments stay on the old review, and the command prints that. `--session` is your own session, the one the request is for. |
| `lahe library answer <request-id> --session <id> --status done\|refused --text "..."` | Answer one request from the drain's `catalog_requests` section. `--session` is your own session, the one the request is for. The text shows on the Library row, at most 500 characters. Refused: an unknown id, another session's request, an expired request, a second answer (it prints the first), and text that is too long |
| `lahe session list [--json]` | Read-only: every agent session on this machine, open ones first, with its handoff revision, reviews owned, unanswered items, whether anything is listening to it, and when the agent last replied. This is how you find a session id |
| `lahe session close <id>` | Close an agent workstream, stop its static servers, and keep all review history. The final close also stops the shared helper, unless the Library page polled it in the last two minutes or a review page is still open |
| `lahe session reopen <id>` | Reopen the workstream and restart its helper and static servers |
| `lahe session takeover <id>` | Explicitly hand an existing workstream to a new agent, fence its older monitors, and print catch-up commands. Add `--name "<name>"` to record the new agent's name at the same time |
| `lahe session name <id> "<name>"` | The human's name for this session, as the host shows it (Claude Code after `/rename`). The reviewer's rail uses it to say which agent to check, and `session list` prints it after the id. Trimmed, control characters removed, 80 characters at most; `""` clears it |
| `lahe session name <id> --from-review <review>` | Name the session after that review's document, as the Library shows it. The command reads the name itself, so a page title never passes through a shell. The review must belong to the session. Used when launching an agent from the Library |
| `lahe review ... --name "<name>"` | Start or add to a session and record its name in one step |
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
default directory and reports no work. `lahe status --json` never prints the
contract text, in any mode: line one is always a pointer to the `contract`
field in the review's `review.json`, the one place the contract lives. There
is no flag that trades the pointer back for the full text, on purpose: an
agent that is woken thirty times should not have to remember one to avoid
reading 3,800 tokens it already has thirty times.

The **wake channel** is per host, because hosts differ in what they can do
without spending model tokens:

- **Claude Code** runs `lahe monitor --session <id>` with Bash in the background.
  It exits when work lands (`0`), the session closes (`5`), or another agent takes
  over (`6`). On `0` the agent drains to empty and launches the same command again
  in the background. Claude Code can also stop a quiet background command when
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

