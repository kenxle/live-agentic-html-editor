# live-agentic-html-editor

Review a live HTML page in your own browser. Select a passage and comment on it,
or edit the text directly on the page. Every change is captured as a record, sent
to a small local process, and handed to your coding agent to apply against the
source.

Two pieces, and that is the whole design:

- **The library.** One built JavaScript file, added to the page with one
  `<script>` line. It runs alone: if the local process is not up, the work is
  kept in browser storage and posted when it comes back.
- **The helper.** One Node process beside the page (`lahe serve`), listening on
  `127.0.0.1:7817`. It keeps an append-only log of the review and writes the
  file your agent reads.

**Status: v1 built.** The library, the helper, and the agent surface are
implemented and tested against real browsers (Chromium, Firefox, WebKit). See
`docs/features/` for the brief, architecture, plan, and review record.

## What you need

**Node 20 or later.** The helper is plain Node with no runtime dependencies: it
uses `node:`-prefixed core modules and the global `fetch`, both of which are
stable from Node 20 on. Nothing else is installed to run the tool.

**A current Chrome, Edge, Safari, or Firefox.** The floor is the
[Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API),
and it is a floor for a reason worth stating: it is how the library draws a
highlight over your text **without putting anything into the page's DOM**. The
alternative is wrapping the highlighted words in `<span>` elements, which changes
the page you are trying to review: the app's own scripts see nodes that were
never there, its CSS selectors match differently, and its own re-renders fight
whatever was inserted. The API is available in current versions of all four
browsers.

**macOS, Linux, or Windows.** Nothing here is platform-specific. The library is
standard DOM APIs and the helper is standard Node.

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
git clone <this repo>
cd live-agentic-html-editor
npm install
npm link          # once, so `lahe` is a command on your PATH
```

Then, for any page you want to review:

```sh
lahe add path/to/page.html
```

`add` does the whole install: it writes the one script line into the page,
mints that review's token, registers the page's origin, and **starts the helper
if it is not already running**. It prints what it did and what to open.

For a dev server, point it at the project instead:

```sh
lahe add path/to/project --origin http://localhost:3000
```

Nothing in your application is edited. `add` prints the one line for your layout,
inside a development-only guard, for you to paste.

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
it is the one carrying `data-lahe-review`. If `add` copied `lahe-layer.js` into
your assets or `public/` directory, that copy is yours to delete too.

**Stop the helper.** Ctrl-C in the window running `lahe serve`, or, when `add`
started it for you, kill the pid in `service.json` in the state directory.

**Forget the reviews.** Delete the state directory (`$LAHE_STATE_DIR`, or
`$XDG_STATE_HOME/lahe`, or `~/.local/state/lahe`). It holds every review's
history and token, so this is the step that throws work away; nothing does it
for you. Uninstalling the command itself is `npm unlink` in the clone.

## Using it

The gestures are also shown as hint lines on the rail beside the page, so you do
not need this file open to work them out.

| Gesture | What it does |
| --- | --- |
| Cmd-Shift-C with text selected | Comment on the selection |
| Cmd-Shift-C with nothing selected | Element-pick mode: hover to outline, click to comment, Esc to cancel |
| Cmd-Shift-E | Edit the block under the cursor |
| Esc, or a click outside | Commit the edit and give the block back to the page |
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
| `lahe add path/to/project --origin http://localhost:3000` | Dev-server variant: edits nothing, prints the one guarded line for your layout |
| `lahe add ... --new` | Mint a fresh review even though the page already carries one |
| `lahe add path/to/page.html --remove` | Take the script line back out of the page, and change nothing else |
| `lahe add ... --source path/to/template` | Record where the source lives, so an agent edits the template rather than build output |
| `lahe serve [--port N]` | Run the helper by hand (`add` starts it for you, so this is rarely needed) |
| `lahe wait --review <id> [--since <cursor>] [--timeout <seconds>] [--state-dir <path>]` | Block until new items are ready; prints them as JSON lines plus the next cursor. Exit codes: 0 new work, 1 timeout, 2 helper unreachable, 3 unknown review, 4 bad usage. Reading acknowledges nothing |

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
