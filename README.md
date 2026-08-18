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

**Node 18 or later.** The helper is plain Node with no runtime dependencies: it
uses `node:`-prefixed core modules and the global `fetch`, both of which are
stable from Node 18 on. Nothing else is installed to run the tool. (The
Playwright browser suite in `test/browser/` needs Node 20; running the tool does
not.)

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

This tool is usually driven through a coding agent, and the repo carries an
agent-readable playbook. Paste this to your agent, filling in the page:

> Read https://raw.githubusercontent.com/kenxle/live-agentic-html-editor/main/AGENTS.md
> and follow it to set up a live review of `path/to/page.html`, then act on my
> feedback as it arrives.

The agent installs the tool, starts the review, tells you what to open, and
works your comments and edits as you leave them. Everything below is the same
path done by hand.

## Install

```sh
git clone https://github.com/kenxle/live-agentic-html-editor
cd live-agentic-html-editor
npm install
npm run install-cli    # puts a `lahe` wrapper in ~/.local/bin
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

`npm link` still works as an alternative if you prefer it, and so does running
from the clone with no install at all (below).

Then, for any page you want to review:

```sh
lahe add path/to/page.html
```

`add` does the whole install: it writes the one script line into the page, drops
a `lahe-layer.js` copy beside the page as the offline fallback (refreshed every
run), mints that review's token, registers the page's origin, and **starts the
helper if it is not already running**. It prints what it did and what to open.

**Review a static file over a local server**, which is the ordinary way. Serve
the page's own folder and register that origin:

```sh
cd path/to            # the folder holding page.html
python3 -m http.server 8000 --bind 127.0.0.1 &
lahe add page.html --origin http://127.0.0.1:8000
# then open http://127.0.0.1:8000/page.html
```

Opening the file directly (`file://`) also works and is the fallback: a page
opened from disk sends the origin `null`, which `add` always registers. What does
NOT work is registering only `null` and then opening the page through a server:
the browser sends the server's origin, the helper refuses it, and the page tells
you so with the command that fixes it.

For a dev server, point it at the project instead:

```sh
lahe add path/to/project --origin http://localhost:3000
```

Nothing in your application is edited. `add` prints the one line with a reminder
comment. That comment is not a guard: wrap the script in your framework's actual
development-only conditional before pasting it into the layout.

### Without installing

`npm link` is a convenience, and on some machines it needs a writable npm prefix
(`npm config set prefix ~/.npm-global`) or `sudo`. You never have to sort that
out: every command works the same way from the clone, with nothing on your PATH:

```sh
node bin/lahe.js add path/to/page.html
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

**Stop the helper.** Ctrl-C in the window running `lahe serve`, or, when `add`
started it for you, kill the pid in `service.json` in the state directory.

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
| Esc, or clicking anywhere outside the block (the page, the rail, another window) | Commit the edit and give the block back to the page |
| Cmd-Enter in a comment box | This comment is done, and the agent may act on it |
| The open box at the foot of the rail | A note tied to nothing in particular |

Browsing is the page untouched: links navigate, buttons act, forms submit. Edit
state is entered deliberately, one block at a time, and the block is visibly
framed while it is in it.

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
| `lahe add path/to/page.html` | Start a review on a static file: writes the one script line, mints the review and its token, starts the helper if it is not running, prints what to open |
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints a commented snippet that you must wrap in your framework's development-only conditional |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe add ... --review <id>` | Re-attach this page to a review that already exists, by id |
| `lahe status [--review <id>] [--json]` | What is open right now: per review, the pages, the counts, the items waiting on you, and whether the reviewer's page is still connected. Blocks on nothing. `--json` prints the contract and field classes on line one, before any page text |
| `lahe serve [--port N]` | Run the helper by hand (`add` starts it for you, so this is rarely needed) |

`lahe status --json --seen-file <path>` is the keep-up loop: run it on a timer,
and any item line in the output is new work. The seen file records what was
printed, so nothing is shown twice and a restarted loop misses nothing. There is
no blocking watch command. Older historical plans may mention `lahe wait`; it
was retired and removed. Use only the status loop above, which covers every
review at once and needs no cursor.

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
