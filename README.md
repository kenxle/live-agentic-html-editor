# live-agentic-html-editor

Review a live HTML page in your own browser. Select a passage and comment on it,
or edit the text directly on the page. Every change is captured as a record, sent
to a small local process, and handed to your coding agent to apply against the
source.

Two pieces, and that is the whole design:

- **The library.** One built JavaScript file, added to the page with one
  `<script>` line whose `src` is the helper's own URL
  (`http://127.0.0.1:7817/lahe-layer.js`), with a copy of the same file beside
  the page as a fallback for when the helper is not running. Your work is kept
  in browser storage every keystroke, so a helper that goes away costs nothing:
  the page still opens, the rail still says the helper is away, and everything
  posts when it comes back.
- **The helper.** One Node process beside the page (`lahe serve`), listening on
  `127.0.0.1:7817`. It keeps an append-only log of the review and writes the
  file your agent reads.

**Status: v1 built.** The library, the helper, and the agent surface are
implemented and tested against real browsers (Chromium, Firefox, WebKit). See
`docs/features/` for the brief, architecture, plan, and review record.

## What you need

**Node 18 or later.** The helper uses Node's stable core APIs plus two pinned
local packages for deterministic Markdown review: Marked for CommonMark/GFM and
Mermaid's dependency-free browser bundle for diagrams. `npm install` installs
them from the clone; there is no separate global package or npm-published LAHE
release to keep in sync. (The Playwright browser suite in `test/browser/` needs
Node 20; running the tool does not.)

**A current Chrome, Edge, Safari, or Firefox.** The floor is the
[Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API),
and it is a floor for a reason worth stating: it is how the library draws a
highlight over your text **without putting anything into the page's DOM**. The
alternative is wrapping the highlighted words in `<span>` elements, which changes
the page you are trying to review: the app's own scripts see nodes that were
never there, its CSS selectors match differently, and its own re-renders fight
whatever was inserted. The API is available in current versions of all four
browsers.

**macOS or Linux.** The documented `install-cli` flow writes a POSIX shell
wrapper to `~/.local/bin`, and those are the platforms currently supported by
that installer. Windows is not yet part of the tested public CLI workflow.

## The fastest start: tell your agent

This tool is usually driven through a coding agent. After the one-time install
below, a fresh Claude, Codex, or Gemini agent should need only this:

> Find the LAHE skill and use it to review `path/to/page.html`.

The skill starts the review, tells you what to open, and works your comments and
edits as you leave them. If the machine has not been set up yet, give the agent
this repository URL and ask it to follow the install section first.

## Install

```sh
git clone https://github.com/kenxle/live-agentic-html-editor
cd live-agentic-html-editor
npm install
npm run install-cli    # installs the CLI wrapper and agent skill
lahe --help || echo "not on PATH"
```

`install-cli` writes a two-line shell wrapper at `~/.local/bin/lahe` that names
the absolute path of the Node that ran it and the absolute path of this clone. It
is there because `npm link` puts the command in the bin directory of whichever
Node ran it: under nvm that is `~/.nvm/versions/node/vXX/bin`, which is on your
PATH only while that version is selected, so the install reports success and then
`lahe` is not found in an ordinary shell. The wrapper does not care what Node is
on PATH or what nvm is doing. If `~/.local/bin` is not on your PATH, the command
says so and prints the line to add.

The same setup command copies the repository-owned `skills/lahe/SKILL.md` to
exactly two locations:

- `~/.agents/skills/lahe/SKILL.md` for Codex and Gemini CLI
- `~/.claude/skills/lahe/SKILL.md` for Claude Code

Both Codex and Gemini discover the shared Agent Skills location, so LAHE does
not install redundant `.codex` or `.gemini` copies. Claude Code uses its own
personal skill directory and needs the second identical copy. These installed
files are projections, not separate sources: update the repository skill first,
then rerun `npm run install-cli` (or the narrower `npm run install-skills`). A
pre-existing hand-maintained LAHE skill is preserved once under
`~/.local/state/lahe/skill-backups/` before migration.

The repository keeps the responsibilities separate to limit drift:

- `skills/lahe/SKILL.md` is the short discovery and cold-start workflow.
- `AGENTS.md` is the detailed operational contract agents follow after the
  skill activates.
- `README.md` is the human-facing installation and product guide.

Do not maintain agent-specific variants of the skill. If an agent needs a new
instruction, change the canonical skill or the shared playbook according to
that split, test it, and run the installer again.

`npm link` still works as an alternative if you prefer it, and so does running
from the clone with no install at all (below).

Then, for any page you want to review:

```sh
lahe review path/to/page.html
```

`review` does the whole setup: it creates the agent session, writes the one script line into the page, drops
a `lahe-layer.js` copy beside the page as the offline fallback (refreshed every
run), mints that review's token, registers the page's origin, and **starts the
helper if it is not already running**. It prints what it did and what to open.

A helper can outlive a repository update when reviews remain open. Every
`review` therefore checks the running backend's service contract. A verified
older helper is restarted onto the installed code without losing review history
or browser-queued work. An older clone refuses to replace a newer helper.

For a static file, that one command also starts or reuses a read-only Node
server rooted at the page's folder and registers its exact origin. Open the URL
on the printed `open` line:

```sh
lahe review path/to/page.html
```

Markdown is also a first-class input:

```sh
lahe review path/to/SKILL.md
```

LAHE renders the Markdown itself, gives generated documents a simple readable
style, preserves proper block and list structure, resolves relative assets, and
turns fenced `mermaid` flowcharts into diagrams using a local browser asset. It
does not modify the `.md` file. Agents should never improvise a Markdown-to-HTML
conversion or start their own review server. After editing the Markdown source,
rerun the same command to rebuild the review page before reporting the change
handled.

That direct path is for a single Markdown file that is itself the document. If
the deliverable is assembled from chapters, includes, templates, citations,
generated sections, or several source files, review the project's real HTML
build instead:

```sh
npm run build-docs
lahe review path/to/build/report.html --source path/to/build-entrypoint
```

The source argument should identify the entrypoint that explains the build's
inputs, such as the top-level Markdown file, manifest, build script, or
template. Individual comments may belong in other fragments. The agent locates
the right fragment from the captured page text, edits source, runs the canonical
build, verifies the HTML, and then replies.

Pandoc remains a good choice when it is already the document build or the
deliverable intentionally needs a reproducible multi-file compiler. Keep that
configuration in the project, including its styles, filters, and Mermaid
runtime. Do not add Pandoc just to review one `.md` file, and do not maintain a
hand-generated HTML twin of that file.

That server belongs to the agent session. `session close` stops it, and
`session reopen` restores it. Passing `--origin` means you supplied an external
server instead, so LAHE neither starts nor stops that process.

Opening the file directly (`file://`) also works and is the fallback: a page
opened from disk sends the origin `null`, which `add` always registers. What does
NOT work is registering only `null` and then opening the page through a server:
the browser sends the server's origin, the helper refuses it, and the page tells
you so with the command that fixes it.

For a dev server, point it at the project instead:

```sh
lahe review path/to/project --origin http://localhost:3000
```

Nothing in your application is edited. `add` prints the one line with a reminder
comment. That comment is not a guard: wrap the script in your framework's actual
development-only conditional before pasting it into the layout.

### Without installing

`npm link` is a convenience, and on some machines it needs a writable npm prefix
(`npm config set prefix ~/.npm-global`) or `sudo`. You never have to sort that
out: every command works the same way from the clone, with nothing on your PATH:

```sh
node bin/lahe.js review path/to/page.html
node bin/lahe.js serve
```

### A note on the token

The script line carries a per-review token, and the helper refuses any request
that does not present it. That means a token ends up written into a file. If that
file is in a repository, the token can be committed and shared with everyone who
reads it. It is scoped to **one review**: a leak opens that review's feedback and
nothing else, not your machine and not another review. `add` says so at the
moment it writes.

### Removing it

Three separate things, because they come apart:

**Take the library out of a page.**

```sh
lahe add path/to/page.html --remove
```

That deletes the one script line `add` wrote and changes nothing else in the
file. For a dev server, delete the line you pasted into your layout yourself:
it is the one carrying `data-lahe-review`. One file is left behind on a static
page: the `lahe-layer.js` copy beside it, which is the fallback the line loaded
when the helper was down. Nothing loads it once the line is gone, so delete it
whenever you like. (Older reviews may also have left one in an `assets/` or
`public/` directory.)

**Close the agent session.** Run the exact `lahe session close <id>` command
printed by `lahe review`. It stops the shared helper when no other agent session
is open and stops this session's static review servers, while retaining every
review and reply. `session reopen` starts that infrastructure again. Application
dev servers are never stopped by LAHE.

**Forget the reviews.** Delete the state directory (`$LAHE_STATE_DIR`, or
`$XDG_STATE_HOME/lahe`, or `~/.local/state/lahe`). It holds every review's
history and token, so this is the step that throws work away; nothing does it
for you. Uninstalling the command itself is deleting `~/.local/bin/lahe` (or
`npm unlink` in the clone, if that is how you installed it).

## Using it

The gestures are also shown as hint lines on the rail beside the page, so you do
not need this file open to work them out.

| Gesture | What it does |
| --- | --- |
| Cmd-Shift-C with text selected | Comment on the selection |
| Cmd-Shift-C with nothing selected | Element-pick mode: hover to outline, click to comment, Esc to cancel |
| Cmd-Shift-E | Edit the block under the cursor |
| Cmd-Enter, Esc, or clicking anywhere outside the block (the page, the rail, another window) | Commit the edit and give the block back to the page |
| Cmd-Enter in a comment box | This comment is done, and the agent may act on it |
| The open box at the foot of the rail | A note tied to nothing in particular |

Browsing is the page untouched: links navigate, buttons act, forms submit. Edit
state is entered deliberately, one block at a time, and the block is visibly
framed while it is in it. Ctrl replaces Cmd on non-macOS systems.

**When the agent answers.** An answered item moves to the Done tab. If you were
looking at another tab when it landed, the Done tab grows a small accent badge
with the number of replies you have not read yet, and each of those cards wears
a thin accent rule down its left edge. Opening the Done tab is the reading: the
badge and the rules clear. Nothing new means no badge at all, never a zero. The
count is yours alone, kept in your browser, so it survives a reload and never
reaches the agent: an answer you have not read is still unread after a refresh.

## Every invocation

**Things a person says to their agent.** The agent-readable playbook is
[`AGENTS.md`](AGENTS.md); an agent that has never seen this tool needs the URL
once, and after that a plain sentence works:

> Set up a live review of `path/to/page.html` — follow
> https://raw.githubusercontent.com/kenxle/live-agentic-html-editor/main/AGENTS.md

> Open this page for a live review. You have `lahe` installed.

**The CLI.** Every command also runs uninstalled as `node bin/lahe.js ...`.

| Command | What it does |
| --- | --- |
| `lahe review path/to/page.html` | Start a review and isolated agent session: writes the script line, starts or reuses its static server and the shared helper, then prints the URL plus the wake, monitor, drain, and close commands |
| `lahe review another.html --session <id>` | Add a later document to the same agent workstream without receiving another agent's comments |
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints a commented snippet that you must wrap in your framework's development-only conditional |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe add ... --review <id>` | Re-attach this page to a review that already exists, by id |
| `lahe status [--session <id>] [--review <id>] [--json]` | What is open right now. Agent monitors must name their session; plain global status is only a human diagnostic |
| `lahe monitor --session <id>` | Poll locally without model wakeups, print unanswered session work, and exit |
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

- **Claude Code** arms one persistent Monitor on
  `tail -n 0 -f <state-dir>/agent-sessions/<id>/wake.log`. The wake feed is one
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

**The rail says whether an agent is actually listening**, from files rather than
from anything the agent claims. It reads *watching* when a monitor heartbeat is
fresh, *agent working* when there are unanswered items and this session ran a
`lahe` command in the last few minutes, and *no agent watching* with the oldest
item's age when neither is true.

**If the page is build output**, an agent should rebuild before it reports an
item handled: `handled` is supposed to mean your page shows the change. It does
not have to re-run `lahe add` afterwards. A rebuild strips the script line out
of the built page, and a running helper puts it back: it is already watching
that file, so when the file returns without the line, the helper writes the same
line back (same review, same token) and refreshes the fallback copy beside the
page. `lahe status` says `script line re-injected after a rebuild` when that
happened. Re-run `add` when no helper is up, when the page is served from a new
origin, or to record a `--source` path. You do not have to reload: the page
updates itself. The helper watches
the file the review was added at, and when a rebuild lands, your page reloads
onto the new version and re-applies your outstanding comments and edits (R36).
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

## License

MIT. See `LICENSE`.

Credit: the interaction model (page beside a rail, select text to comment, edit
directly) was established by
[human-review](https://github.com/petergyang/human-review) by Peter Yang (MIT),
which this tool learned from and builds on.
