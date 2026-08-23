# Install

## What you need

**Node 18 or later.** The helper uses Node's stable core APIs plus two pinned
local packages for deterministic Markdown review: Marked for CommonMark/GFM and
Mermaid's dependency-free browser bundle for diagrams. Both are vendored under
`vendor/` in this repository, so there is no `npm install` step and nothing is
fetched at runtime; there is no separate global package or npm-published LAHE
release to keep in sync either. (The Playwright browser suite in `test/browser/`
needs Node 20 and a `npm install` for its devDependencies; running the tool does
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

**macOS or Linux for the installer.** The documented `install-cli` flow writes a
POSIX shell wrapper to `~/.local/bin`, and those are the platforms currently
supported by that installer. Windows is not yet part of the tested public CLI
workflow: the helper and the review layer are cross-platform, so a Windows user
runs `node bin/lahe.js ...` from the clone directly, or works inside WSL, where
the wrapper installs normally.

## Installing the command

```sh
git clone https://github.com/kenxle/live-agentic-html-editor
cd live-agentic-html-editor
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

`review` does the whole setup: it creates the agent session, mints that review's
token, registers the page's origin, and **starts the helper if it is not already
running**. It prints what it did and the one URL to open.

**It writes nothing into your page's folder.** The static server puts the script
line into the page as it serves it, and publishes the library on its own route,
so your file stays byte-identical and there is no `lahe-layer.js` sitting beside
it. That matters because a page's folder is usually a git checkout, and a script
line plus a bundle committed together will load the review rail on a deployed
copy of the page. The on-disk line and the sibling library copy still exist for
the cases with no server to inject for them: a plain `lahe add`, and any page
opened from disk.

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

Local links keep working in the rendered page, and the file on disk is never
rewritten to make them work. What each link form does:

- A link to a file in the document's own folder, or below it, is served from
  that folder as it always was.
- A link that leaves the folder, such as `../crucible/SKILL.md`, and an
  absolute path under your home directory, are both resolved against the source
  file's directory. LAHE serves the target's folder read-only for the session
  and points the rendered link at it.
- A link to another `.md` or `.markdown` file opens as the same rendered
  reading view, marked read-only and not under review. Its own links are
  translated the same way, so a skill to a template to a sub-template chain
  works.
- `#heading` links stay ordinary in-page anchors.
- A link LAHE will not serve renders as plain text, not a broken link, with the
  full path in its tooltip so you can open it on disk. That covers a target
  outside your home directory, a symlink pointing out of it, a hidden
  (dot-prefixed) location, a missing file, and links past the 16-folder cap on
  how many folders one document may mount.

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

## Without installing

`npm link` is a convenience, and on some machines it needs a writable npm prefix
(`npm config set prefix ~/.npm-global`) or `sudo`. You never have to sort that
out: every command works the same way from the clone, with nothing on your PATH:

```sh
node bin/lahe.js review path/to/page.html
node bin/lahe.js serve
```

## A note on the token

The script line carries a per-review token, and the helper refuses any request
that does not present it.

**On the served path the token never reaches your disk.** `lahe review` puts the
line in the response, so nothing is written into your working tree and there is
nothing to commit.

The token does end up in a file on the two paths that have no server to inject
for them: a plain `lahe add`, and a page opened from disk. If that file is in a
repository the token can be committed and shared with everyone who reads it. It
is scoped to **one review**: a leak opens that review's feedback and nothing
else, not your machine and not another review. `add` says so at the moment it
writes. The bigger risk there is not the token but the pair: the line's `onerror`
loads `lahe-layer.js` by a relative path, so a page and its sibling bundle
committed together will run the review rail on a deployed copy. Take both out
with `lahe add path/to/page.html --remove` before the page ships.

## Removing it

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

