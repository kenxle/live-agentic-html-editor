# Every invocation

**Things a person says to their agent.** The agent-readable playbook is
[`AGENTS.md`](../AGENTS.md); an agent that has never seen this tool needs the URL
once, and after that a plain sentence works:

> Set up a live review of `path/to/page.html`: follow
> https://raw.githubusercontent.com/kenxle/live-agentic-html-editor/main/AGENTS.md

> Open this page for a live review. You have `lahe` installed.

**The CLI.** Every command also runs uninstalled as `node bin/lahe.js ...`.

| Command | What it does |
| --- | --- |
| `lahe review path/to/page.html` | Start a review and isolated agent session: starts or reuses its static server and the shared helper, then prints one URL plus the wake, monitor, drain, and close commands. It writes NOTHING into the page's folder: the server puts the script line into each response instead |
| `lahe review another.html --session <id>` | Add a later document to the same agent workstream without receiving another agent's comments |
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints a commented snippet that you must wrap in your framework's development-only conditional |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe add ... --review <id>` | Re-attach this page to a review that already exists, by id |
| `lahe status [--session <id>] [--review <id>] [--json]` | What is open right now. Agent monitors must name their session; plain global status is only a human diagnostic |
| `lahe monitor --session <id>` | Poll locally without model wakeups, print unanswered session work, and exit |
| `lahe session list [--json]` | Read-only: every agent session on this machine, open ones first, with its handoff revision, reviews owned, unanswered items, whether anything is listening to it, and when the agent last replied. This is how you find a session id |
| `lahe session close <id>` | Close an agent workstream, stop its static servers, and keep all review history. The final close also stops the shared helper |
| `lahe session reopen <id>` | Reopen the workstream and restart its helper and static servers |
| `lahe session takeover <id>` | Explicitly hand an existing workstream to a new agent, fence its older monitors, and print catch-up commands |
| `lahe serve [--port N]` | Run the helper by hand (`add` starts it for you, so this is rarely needed) |

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

The **wake channel** is per host, because hosts differ in what they can do
without spending model tokens:

- **Claude Code** arms one Monitor, with `persistent: true` in the tool call, on
  `tail -n 0 -f <state-dir>/agent-sessions/<id>/wake.log`. Without that parameter
  the Monitor times out at its default 300 seconds, and a timing-out monitor is a
  scheduled model wakeup in disguise. The wake feed is one
  append-only file per agent session, created empty when the session is, so the
  tail can be armed before any work exists. It gets a line when a ready item
  lands, when the reviewer reopens an item, when the session is taken over, and
  when it closes. Nothing to relaunch,
  and no model turns at all while it is quiet.
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

**The rail carries one line, and it does two jobs.** Most of the time it is a
quiet indicator that the chain is intact: `Stored · agent listening`, or `Stored ·
no agent listening` when nothing on this computer has the review open. That is
the answer to the only question a reviewer asks at the start and after a break.
Hovering it gives the detail: whether the helper is answering, whether an agent
has the review open, when the agent last replied, and where the work is stored.

When something they submitted has gone unanswered for more than 30 seconds, the
line speaks: `Stored · nothing back yet, 45s`, `Stored · agent is working, 5m`
when the agent has run commands in the last few minutes, or `Stored · nobody has
picked this up, 7m` when nothing has the review open. A **Save a copy** button
appears beside it, running the same export as the rail menu, because the point of
that message is to hand the reviewer a way to get their feedback to an agent
another way. It goes loud past ten minutes whatever the machine can see: a file
tail can be armed all afternoon over an agent that stopped reading.

The reviewer is never told about monitors, heartbeats or wake feeds. That is our
plumbing, and it is not something they can act on. `lahe session list` is where
that view lives instead.

How the helper knows an agent is there: `<state-dir>/agent-sessions/<id>/wake.log`
is our file, created for exactly one purpose, and nothing else on the machine has
any reason to hold it open, so a process holding it open is an agent watching that
session. The helper asks with `lsof`, cached for 15 seconds and off the poll path.
A machine that cannot answer says so, and the line falls back to the wait, which
is always knowable.

**If the page is build output**, an agent should rebuild before it reports an
item handled: `handled` is supposed to mean your page shows the change. It does
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

