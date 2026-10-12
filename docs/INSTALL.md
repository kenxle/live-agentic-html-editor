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

- `skills/lahe/SKILL.md` holds every instruction for running a review.
- `AGENTS.md` says how each agent host connects to the tool, and points at
  install and the docs.
- `README.md` is the human-facing installation and product guide.

Do not maintain agent-specific variants of the skill. If an agent needs a new
instruction, change the canonical skill, test it, and run the installer again.

`npm link` still works as an alternative if you prefer it, and so does running
from the clone with no install at all (below).

Then, for any page you want to review:

```sh
lahe review path/to/page.html
```

`review` does the whole setup: it creates the agent session, mints that review's
token, registers the page's origin, and **starts the helper if it is not already
running**. It prints what it did and the one URL to open.

**It writes nothing into your page's folder.** The helper serves the page at its
stable address, puts the script line into it as it serves it, and publishes the
library on its own route,
so your file stays byte-identical and there is no `lahe-layer.js` sitting beside
it. That matters because a page's folder is usually a git checkout, and a script
line plus a bundle committed together will load the review rail on a deployed
copy of the page. The on-disk line and the sibling library copy still exist for
the cases with no server to inject for them: a plain `lahe add`, and any page
opened from disk.

A helper can outlive a repository update when reviews remain open. Every
`review` therefore checks two things about the one that is running: its service
contract, and whether it started before this clone's code last changed. Either
one restarts a verified older helper onto the installed code, and the output
says it happened. Nothing is lost by it: review history stays on disk, the page's
address does not change, and an open page reconnects by itself. An older clone
refuses to replace a newer helper.

For a static file, that one command also gives the page's folder its stable
address, `http://<folder and two parents>.lahe.localhost:1483/<file>`, served by
the helper itself. Open the URL on the printed `open` line:

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

Do not fork these instructions by agent: Claude, Codex, and Gemini use the same
CLI and file protocol after discovery, and the repository copy under `skills/` is
the one source of truth for the skill.

## Keeping addresses working: `lahe install`

Every document Lahe serves has a stable address. The name is the document's
folder plus its two parent folders, joined by dots, and the path is the file:

```
http://docs.features.20261011-02-stable-addresses.lahe.localhost:1483/01_brief.md
```

The address stays the same for as long as the folder exists. Without an
install, it works whenever the helper is running: `lahe review` starts the
helper, and the helper stops itself once nothing needs it. `lahe install` keeps
the helper running all the time, so an old address loads after a session
closes, after idle time, and after a reboot, with nobody running a command
first.

```sh
lahe install                 # Windows: node bin/lahe.js install
```

Run it yourself, in a terminal. It refuses to run without a terminal, so an
agent asks you to type `! lahe install`. It also refuses to run as root.

**What it sets up, per system.** A login item that starts the helper when you
log in and starts it again if it stops:

| System | Login item | Back after a crash |
|---|---|---|
| macOS | `~/Library/LaunchAgents/lahe-helper.plist`, run by launchd | about 10 seconds (launchd waits 10 seconds between starts) |
| Linux | `~/.config/systemd/user/lahe-helper.service`, run by `systemd --user` | about 2 seconds |
| Windows | a Task Scheduler task named `lahe-helper`, at logon and once a minute | up to about a minute |

On Linux without a user systemd, install says so and changes nothing; Lahe
keeps starting the helper on demand. On Windows the task runs Node with no
window. We have not yet checked by hand on a Windows desktop that no window
flashes at logon.

**What it pins.** The login item names the Node that ran the install, this
clone, the helper's port (7817) and your state folder, all as full paths. A
login item does not read your shell's settings, so nothing is looked up at
login. If you remove that Node or move the clone, run `lahe install` again.
`lahe status` says so when it happens. `install.json` in the state folder
records what was set up.

**What changes once installed.**

- The helper runs with `--always-on` and does not stop itself when quiet. It
  still stops if its state folder is removed, and the login item starts it
  again into a fresh one.
- Lahe commands ask the login item for a helper instead of starting their own.
- When this clone's code is newer than the running helper, the next Lahe
  command replaces the helper. It waits up to ten seconds for a quiet moment,
  when no comment has been written for two seconds. If none comes, it leaves
  the helper running and the next command tries again. An open page
  reconnects on its own.
- `lahe serve` by hand refuses, because the login item owns the port.
  `lahe serve --restart` restarts the helper through the login item.

**Other accounts on this computer.** An always-on helper can be reached by
other accounts on the same computer, though not by websites. Each page carries
its review's key, so another account can open the pages and read and write
every review, and what it writes reaches your agent. Install warns when more
than one account exists, and goes on.

**Taking it out.**

```sh
lahe uninstall               # Windows: node bin/lahe.js uninstall
```

This removes the login item and `install.json`, and stops the helper. On macOS
it also removes the port 80 forward and the `.lahe` setup, if Lahe made them.
After that, `lahe review` starts the helper on demand, as before. Addresses do
not change: they work whenever the helper is running.

## Optional: no port, and the short `.lahe` ending

Two more options, each separate, each asking for an admin password once. Lahe
uses neither until it has proved it works on this computer. It checks at start
and every five minutes. Until a check passes, addresses keep `:1483` and the
`.lahe.localhost` ending. `lahe status` shows whether each option is on,
whether its check passed, and why not if it did not.

- **No port** (`--port-80`) forwards this computer's own port 80 to 1483, so an
  address prints as `http://<name>.lahe.localhost/<file>`. The check: the
  helper sends itself a request with a fresh random path through port 80, and
  passes only when that request arrives at its own pages port. The forward
  covers this computer only, never traffic from the network.
- **`.lahe`** (`--lahe-names`) makes every page also answer at
  `http://<name>.lahe:1483/<file>`, or `http://<name>.lahe/<file>` with the
  port 80 forward as well. Lookups for names ending in `.lahe` go to a
  small name server inside the helper, on `127.0.0.1` port 7853. It answers
  `127.0.0.1` or `::1` for names under `.lahe`, and refuses everything else.
  The check: the helper looks up a fresh random `.lahe` name through the
  system, and passes only when its own name server saw that exact lookup. A
  page asked for at a `.lahe` address before the check passes is refused.

`lahe review` keeps printing the `.lahe.localhost` ending. `.lahe` is a shorter
alias you can type. A browser with its own secure DNS setting turned on may not
ask the system about `.lahe`. There `.lahe` fails and `.lahe.localhost` still
works. A `.lahe` address also shows "Not secure", and a few features fall
back: copy uses an older method, and the guard against two tabs of one
document acting at once is off. `.lahe.localhost` has none of these limits.
The Library is never served at `library.lahe`.

### macOS

```sh
lahe install --port-80
lahe install --lahe-names
```

Each is one `sudo` call. The files carry a `# lahe-managed` line, and Lahe
never overwrites or removes a file without it.

- `--port-80` writes `/etc/pf.anchors/lahe` (forwards port 80 to 1483 for
  `127.0.0.1` and `::1`) and `/Library/LaunchDaemons/lahe-port80.plist`, which
  loads that rule at every boot and turns the macOS firewall's packet filter
  (pf) on. It does not edit `/etc/pf.conf`. If something already listens on
  port 80, install skips this step and names the program.
- `--lahe-names` writes `/etc/resolver/lahe`, which sends `.lahe` lookups to
  `127.0.0.1` port 7853.

A later plain `lahe install` keeps whichever is set up. `lahe uninstall`
removes both, one admin password each. It leaves pf turned on, with only
Apple's own rules in it.

### Linux (written steps, untested)

Run `lahe install` with the option first, so the helper knows to check it, then
do the steps. **We have not run these steps on Linux.** Each one is checked by
the helper, so a step that does not work leaves addresses with `:1483` and
`.lahe.localhost`, and `lahe status` says which check failed.

**No port.** Install records it, then you add a redirect from loopback port 80
to 1483 to the firewall:

```sh
lahe install --port-80
sudo iptables  -t nat -A OUTPUT -o lo -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports 1483
sudo ip6tables -t nat -A OUTPUT -o lo -p tcp -d ::1       --dport 80 -j REDIRECT --to-ports 1483
```

These rules last until the next reboot. Keeping them past a reboot depends on
the distribution: on Debian and Ubuntu, the `iptables-persistent` package
saves them with `sudo netfilter-persistent save`. Untested. To undo, run the
same two commands with `-D` in place of `-A`.

The architecture planned a different route for Linux: let ordinary programs use
port 80, and have the helper listen there itself. The helper does not listen on
port 80 yet, so the redirect is the route that works with it today.

**`.lahe`.** This needs `systemd-resolved` (check with `resolvectl status`),
version 246 or later for the `:7853` form. Without it, stop here: `.lahe` is not
available on that machine.

```sh
lahe install --lahe-names
sudo mkdir -p /etc/systemd/resolved.conf.d
printf '# lahe-managed: remove this file to undo.\n[Resolve]\nDNS=127.0.0.1:7853\nDomains=~lahe\n' \
  | sudo tee /etc/systemd/resolved.conf.d/lahe.conf
sudo systemctl restart systemd-resolved
resolvectl query anything.lahe      # should answer 127.0.0.1
resolvectl query example.com        # ordinary lookups must still work
```

Untested on Linux. On some setups, ordinary lookups may also be offered to
Lahe's name server first. It refuses them, and `systemd-resolved` should move
on to your usual server. If ordinary lookups get slower or fail, undo it:
`sudo rm /etc/systemd/resolved.conf.d/lahe.conf`, then restart
`systemd-resolved`.

`lahe uninstall` removes the login item and reminds you which of these steps to
undo by hand.

### Windows (written steps, untested)

**No port.** In an administrator PowerShell, after recording it:

```powershell
node bin/lahe.js install --port-80
netstat -ano | findstr ":80 "        # if anything is listening on port 80, stop here
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=80 connectaddress=127.0.0.1 connectport=1483
netsh interface portproxy add v6tov6 listenaddress=::1 listenport=80 connectaddress=::1 connectport=1483
```

Untested on Windows. The forward lasts across restarts and needs Windows'
IP Helper service, which runs by default. To undo it:
`netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=80`,
and the same with `v6tov6` and `::1`.

The architecture planned for the helper to listen on port 80 itself on Windows.
It does not do that yet, so the forward above is the route that works today.

**`.lahe` is not available on Windows yet.** Windows can send one name ending
to a chosen name server, but only on port 53, and Lahe's name server answers on
port 7853. `node bin/lahe.js install --lahe-names` says so and changes nothing.
`.lahe.localhost` addresses work on Windows with no setup.

## Your settings file

Some steps in a review use details about you, such as where your voice
proposals go. Those live in a settings file outside the repository, so nothing
personal is committed. Create it:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/lahe"
cp docs/user.env.example "${XDG_CONFIG_HOME:-$HOME/.config}/lahe/user.env"
```

Then uncomment the lines you want and fill in your paths. It holds plain
`KEY=value` lines, and lines starting with `#` are comments:

```sh
# The folder where voice proposals go at the end of a review.
# LAHE_VOICE_PROPOSALS_DIR=/path/to/voice_proposals

# The voice documents a proposal is checked against, separated by ":".
# LAHE_VOICE_DOCS=/path/to/communication_style.md:/path/to/writing_voice.md
```

The file is optional. An agent skips any step whose setting is missing and
says so once.

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

Four separate things, because they come apart:

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
printed by `lahe review`. It closes only the session and keeps every review and
reply. The session's pages stay at their addresses. Without the install, the
helper stops once no session is open and nothing needs it; with it, the helper
keeps running. Application dev servers are never stopped by LAHE.

**Stop starting the helper at login.** Run `lahe uninstall`. See "Keeping
addresses working" above.

**Forget the reviews.** Delete the state directory (`$LAHE_STATE_DIR`, or
`$XDG_STATE_HOME/lahe`, or `~/.local/state/lahe`). It holds every review's
history and token, so this is the step that throws work away; nothing does it
for you. Uninstalling the command itself is deleting `~/.local/bin/lahe` (or
`npm unlink` in the clone, if that is how you installed it).

