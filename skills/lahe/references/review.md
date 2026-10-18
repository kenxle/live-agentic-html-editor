# Start and run a review

## Get ready and serve the page

**Check for a newer Lahe** once, at the start of your session, before your
first `lahe` command. The clone is the path inside `~/.local/bin/lahe`.

```sh
git -C <clone> fetch --quiet
git -C <clone> status -sb    # the first line says "behind N" when there is an update
```

- If the clone is behind, on its default branch, and `git -C <clone> pull --ff-only`
  succeeds, run `npm run install-skills` in the clone. When the skill or its references
  changed in the pull, reread the entrypoint and the route you are using. The next `lahe review`
  restarts the helper onto the new code by itself.
- If the clone is on another branch, or the pull refuses, change nothing in it.
  Tell your human in one line that an update is waiting, and go on.
- If the fetch fails (no network), go on with the version you have.

Choose the target from the table below and serve:

```sh
lahe review <target>
```

The command prints one `open` URL, the agent session id, the review folder, and
the wake, monitor, drain, and close commands for this session. The URL is the
document's stable address, served by the Lahe helper:
`http://<name>.lahe.localhost:1483/<file>`, or with no `:1483` when the
port-80 forward is set up (`lahe install`). The name is the document's folder
and its two parent folders, joined by dots (`repo.docs.ongoing`). A file inside
a folder that already has an address gets that folder's name and its path
there. The same file always gets the same address, and the address keeps
working after the session closes, for as long as the helper runs.

**One review per file.** A file that already has a review keeps it.
`lahe review` of that file opens the existing review and never makes a second
one:

- In your own session's review, it goes on as usual.
- In another session's review, it prints the address and whose review it is,
  and makes nothing. When that session's agent is listening, it tells you to
  ask your human before doing anything else with the page: a handoff is theirs
  to ask for. Otherwise it names `lahe session takeover <id>`, which you run
  only when the human asks. Run without `--session`, it also says: if that session
  is your own, rerun with `--session <id>`.
- `--new` and `--new-session` are refused for a file that has a review. To
  start over on one of your own reviews, retire it first:
  `lahe review retire <review-id> --session <agent-session-id>`. A retired
  review keeps its log, and answers on no page.

A page shows every comment made on it. Comments on it that are filed in
another review show on the rail read-only, with the agent that holds them; to
work on those, ask your human to have that agent pick them up from the Library.

**Read the `contract` field at the top of `review.json`** in the review folder
once, when you start on a review. It is the rules for reading an item, changing
the source, and replying, and it wins over this skill wherever the two differ.
You do not need to read it again on each wake: the drain lists the new items.
If you lose it, it is in `review.json` in the review folder.

**Name your session if your host tells you its name.** The human may run many
agents at once, and when nothing comes back on their comments, the rail tells
them which agent to go check. If your host tells you the human's name for this
session (Claude Code does after `/rename`), add `--name "<name>"` to
`lahe review`, or to `lahe session takeover <id>` when you take one over. If the
name changes later, run `lahe session name <id> "<new name>"`. If your host never
tells you a name, leave it out.

## Choose the target

The command is nearly always `lahe review <target>`. What changes by row is where
your edits go and what `handled` costs you. Picking the wrong row is how an agent
edits generated HTML that the next build throws away. (`lahe add` is the advanced
legacy command; use `lahe review` for normal work.)

| What your human is looking at | Open it with | Where your edits go | What `handled` needs |
| --- | --- | --- | --- |
| A Markdown file, on its own | `lahe review file.md` | the `.md` itself | nothing: the page re-renders and reloads itself. Check the rendered page |
| Notes they want to write on a blank page | `lahe write notes/2026-09-28.md` | the `.md` itself: place their words as written | the words in the file; the page re-renders itself |
| HTML that IS the source: a hand-written one-pager, a mockup | `lahe review page.html` | the page file the item names | in the file and on their screen |
| A FOLDER of HTML pages that is the document | `lahe review folder` | the page file the item names | in that file and on their screen |
| One page in a folder they did NOT ask you to touch | `lahe review page.html --only` | that one HTML file | in the file and on their screen |
| HTML that is BUILD OUTPUT | `lahe review page.html --source generator` | the generator, never the page | rerun the build, grep the built HTML |
| A document built from several sources | real build first, then `lahe review build/report.html --source entrypoint` | the source fragment the item points at | the canonical build, rerun and verified |
| Your own app running in dev | `lahe review project --origin http://localhost:3000` | your app's code | live in the running app |
| A page with images, CSS or fonts beside it | as its row above | as its row above | as its row above; read the asset rules below |
| A page whose own stack hot-reloads it | as its row above | as its row above | nothing extra |

**The rail follows the reviewer.** The address serves a whole folder: the one you
named, or the folder the page you named lives in. Every HTML page in it carries
the rail, so there is nothing to enroll page by page.

### A Markdown file

Pass the source file. Direct `.md` and `.markdown` targets are rendered by
`lahe review` itself, including fenced `mermaid` blocks, and it never writes the
Markdown source.

Use this row only when that one file is the document. A document assembled from
several inputs is the multi-source row. When a project already builds with
Pandoc, keep its command, template, styles, and filters in the project so another
agent can rebuild the same output.

After a change there is nothing to rerun. LAHE notices the `.md` is newer than
the page it rendered, renders it again, and the reviewer's page reloads onto the
new render on its own. Do not rerun `lahe review` for that file, and never tell
the reviewer to refresh or clear a cache.

A local link that renders as plain text is one the tool cannot serve. It is not a
bug to fix in the source.

### A folder of pages

The folder needs at least one `.html` file of its own; a folder with none is the
app-in-dev row. The open link is `index.html`, else the first page in name order.

### One page in a folder nobody chose

`lahe review ~/Downloads/statement.html` serves the whole Downloads folder. Read
the `root` line `lahe review` prints: it names what the link can reach. If that is
a folder you would not want served, pass `--only`. It cannot be added to a review
afterwards, so decide when you open it.

### Assets

A single page is served from its OWN folder. An asset beside the page loads; an
asset above it does not:

```
page/index.html  ->  <img src="local.css">        200
page/index.html  ->  <img src="../assets/x.png">  404
```

A folder review has the same limit one level up, at the folder you named. From
disk the page looks perfect, so load the link yourself and check the assets before
you hand it over. If they live above the page, move them under it or move the page.

## Hand over the URL

Give them the `open` line exactly as printed. One link.

Then say which session and which review the page landed on. The output says
whether it minted a new review, reused one, or matched one by path. Say it before
they start commenting, so a page on the wrong review is caught while it costs
nothing.
Then arm your host's monitor right away, in the same turn, without being asked. A session with no monitor goes silent: the reviewer's comments land and
nobody answers, and they have no way to tell why.

## Drain and handle work

Two things keep you current: a way to be woken, and one command to run when you
are.

**The drain command:**

```sh
lahe status --session <id> --json --quiet
```

It prints every ready item nobody has answered, and nothing at all when there is
none. Handle every item it prints, rebuild, verify, append your replies, then run
it again. Repeat until it prints nothing. Work stays listed until your reply
lands, so a wake you miss costs you nothing.

Its last line can be a summary. It prints only when something in it needs you:
an ended review, a Library request, or a page that is not connected (under
`liveness`). Two lists in it are work too: `ended_reviews` (read [finish](finish.md)) and `catalog_requests`, requests from the Library page (read [Library](library.md)).

**Copy the printed commands exactly.** Outside the default state directory, every
command the tool prints carries `--state-dir <path>`.

**The wake channel is per host.** Use the one for yours and only that one. Every
wake means: run the drain command.

Read only your host's monitor guide: [Claude Code](host-claude.md),
[Codex](host-codex.md), or [Antigravity and other hosts](host-other.md).
Read [feedback](feedback.md) before handling drain items. A held comment is
invisible until the reviewer releases Hold; the drain is the current work list.

Stay responsive during long tasks. Where available, hand long work to a
background subagent; otherwise cut it into short pieces and drain between
them. If new feedback changes or cancels that work, stop or redirect it.

For an existing review, another page, or a takeover, read
[sessions](sessions.md). For build output or a dev server, also read
[webapps and builds](webapps.md). For connection problems, read
[troubleshooting](troubleshooting.md).
