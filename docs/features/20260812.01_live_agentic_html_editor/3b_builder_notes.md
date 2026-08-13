# 3B builder notes: install, add, and first-run

Branch `task/3b`, worktree `../lahe-worktrees/3b`, cut after CP2. Everything below was run with Node
20.19.0.

## What was built

| File | What it is now |
| --- | --- |
| `src/cli/commands/add.js` | New. The whole install: classify the target, settle the review, make the helper hold it, then write or print the one script line |
| `src/cli/index.js` | `add` wired the way `serve` is wired (`require("./commands/add.js").run(rest)`), and the stub removed. `wait` is untouched and still 3A's |
| `src/shared/manifest.js` | The one pre-authorized edit: `planned: true` dropped from `src/cli/commands/add.js`. Nothing else changed |
| `package.json` | The `bin` field: `{"lahe": "bin/lahe.js"}`. `npm link` now puts `lahe` on a PATH |
| `README.md` | Rewritten. The macOS-and-Chromium claim is gone; the real requirements, the install, the token warning, and the in-page gestures are in |
| `test/unit/add_command.test.js` | New. Twelve tests, all running the real command through `bin/lahe.js` |
| `test/browser/install_walk_3b.spec.js` | New. The done bar: a temporary HOME, `npm link`, `lahe add`, a real comment landing in `events.jsonl` |

## The decisions worth knowing about

**Which path the script line's `src` carries (D1 allows either).** For a static file: a copy in the
page's own assets directory when one sits beside the page (`assets`, `js`, `javascripts`, `scripts`,
`static`, `public`), otherwise a relative path back to this clone's `dist/lahe-layer.js`. The reason for
the split is that a page WITH an assets directory is usually moved or served as a unit, and a relative
path back into a clone breaks the moment it is; a lone `.html` file on a desktop has nowhere to put a
copy and does not want one. One refinement after looking at the output: when the relative path climbs
more than four levels the absolute filesystem path is written instead, because a static target is opened
with `file://` and a leading `/` resolves against the filesystem root there. Same file, readable line.

For a dev server the `src` is a URL, not a path, because the browser resolves it against the server. The
bundle is copied into `public/` or `static/` (published at `/lahe-layer.js` by most servers) or into
`assets/`-style directory (published at `/<dir>/lahe-layer.js`), and the printed line says to CHECK that
URL loads rather than asserting it. With no such directory, `add` prints the absolute path of the bundle
and says to copy it wherever the app serves static files from.

**`add` restarts a running helper when it has to, and says so.** There is no create-review route on the
wire, on purpose: `health` carries no review data and every other route sits behind the very token being
minted. So a helper that was started BEFORE this review existed cannot learn about it over the wire. The
options were to tell the user to restart it themselves (which breaks the second `add` on a machine, the
most ordinary thing there is) or to do it. `add` does it: SIGTERM to the pid in `service.json`, poll
until the port stops answering, write to the state directory with nothing else running, start a fresh
`lahe serve` detached, poll until it answers. It prints the reason in full: the log is append-only,
tokens persist across restarts, and any page still open re-posts what it was holding.

This is also why the disk writes are fenced. Two processes appending to one `events.jsonl` would hand
out the same `seq`, so everything `add` writes happens with no helper running.

**How `add` decides the helper already knows a review: `service.json`, not a probe.** The helper writes
that file after its listener binds and lists every review it holds with that review's token and origins,
so it is the helper's own account of itself. The alternative was an authenticated request, which needs
the token being checked and answers with a different status for four different reasons. There is one
fast path (page carries a live review, helper is up, holds it with every origin needed, no source hint
to record) and it is the only case where nothing is written and nothing restarts.

**A dev-server target with no `--origin` registers `http://localhost:3000` and
`http://127.0.0.1:3000`, and prints that it did.** The plan's sentence was "the origin registers on
first contact or via `--origin`". First-contact registration does not exist in the helper: the origin
check refuses an origin nobody registered, and building it would mean editing `src/service/*`, which is
1A's. Refusing to act without `--origin` would break the one-command promise for the ordinary Rails or
Vite case, so `add` registers the two conventional dev origins, states them on its own output, and says
how to add another (`lahe add <target> --origin <origin>`, which is idempotent). Both are registered
rather than one because browser storage is partitioned by origin and one review spans `localhost` and
`127.0.0.1` only because the helper holds a set. **Flagging this for the orchestrator** as the one place
this task's behavior is not the plan's sentence.

**The source hint is recorded, not just printed.** `--source` appends a `page.visited` event, which is
the one event in the closed vocabulary carrying page facts (`page_path`, `page_seq`, `source_hint`), so
3A's projector can put it on that page's group header. The layer does not read a source hint off the
script tag today, so the command is where it enters the log.

**The position rule for the script line**, tested three ways: immediately before the LAST `</body>` at
that tag's indentation; failing that, before the last `</html>`; failing both, appended with a trailing
newline. Last, not first, so a page that quotes `</body>` in its own prose still ends at the real one.
On a re-run the existing tag is REPLACED in place, keeping its position and indentation, so `add` twice
is idempotent down to the bytes.

**Exit codes.** 0, 1 (could not do it, with the reason on stderr), and 4 for bad usage, borrowed from
`protocol.WAIT.EXIT.BAD_USAGE` so there is one spelling of "you typed it wrong". `add` does not borrow
`wait`'s other four; they mean things `add` never means.

## The demonstrated failure

One line reverted in `src/cli/commands/add.js`: always mint a new review, never reuse the one the page
already carries.

```diff
--- a/src/cli/commands/add.js
+++ b/src/cli/commands/add.js
@@ -540,7 +540,7 @@ async function run(argv) {
     } catch (err) {
       metaPath = null;
     }
-    if (metaPath && fs.existsSync(metaPath)) reuseId = carried;
+    if (metaPath && fs.existsSync(metaPath)) reuseId = null; // DELIBERATE REVERT: always mint a new review
   }
```

```
$ node --test test/unit/add_command.test.js

not ok 1 - add twice on the same file reuses the review, and --new does not
  ---
  location: 'test/unit/add_command.test.js:152:1'
  failureType: 'testCodeFailure'
  error: |-
    add twice on the same file reuses the review it already carries
    + actual - expected

    + 'r16bdfbbc1f23'
    - 'r5f29ed990e7d'
  ...

# tests 12
# pass 11
# fail 1
```

The test was written before the command existed and failed then too, against the dispatcher stub
(`4 !== 0`, exit 4 with "lahe add is not built yet"). Commit `d8ed140` is the failing test on its own.

The revert was undone with `git checkout src/cli/commands/add.js`.

## The install walk, and how npm link was sandboxed

`test/browser/install_walk_3b.spec.js` runs the documented path end to end.

- **The HOME is temporary.** `HOME` points at a fresh `mkdtemp` directory with `XDG_STATE_HOME` and
  `LAHE_STATE_DIR` deleted from the environment, so the helper derives `~/.local/state/lahe` inside it.
  The spec asserts that directory does not exist before the walk starts, which is what "no existing
  state" means.
- **`npm link` is sandboxed with `npm_config_prefix`,** set to a directory inside that temporary HOME.
  npm writes its global bin there (`<tmp>/npm-global/bin/lahe`) and the real global bin is never
  touched. `PATH` is prefixed with that directory, and the spec asserts `command -v lahe` resolves to
  exactly that file, so the walk proves `lahe` is an installed command rather than a path being typed.
- **The only deviation from the documented command is `--port`.** The default is fixed at 7817 because a
  page carries it in its script tag; a parallel Playwright run would collide on it. This is the same
  deviation every one of 1A's specs takes.
- **Nothing is deleted.** The temporary HOME, the npm prefix and the page are left in the OS temp
  directory, listed below.

Its output:

```
$ npx playwright test test/browser/install_walk_3b.spec.js
Running 2 tests using 1 worker

  ✓  1 [chromium] › install_walk_3b.spec.js:131:3 › AC6: the install is one documented command path ›
       npm link once, then `lahe add`, and the page is ready to review (908ms)
  ✓  2 [chromium] › install_walk_3b.spec.js:192:3 › AC6: the install is one documented command path ›
       the reviewer's comment on that page lands in events.jsonl (184ms)

  2 passed (1.6s)
```

What the second test actually does: opens the added page with `file://`, waits for the real bundle to
boot from the script line `add` wrote, selects a paragraph, presses Cmd-Shift-C, types a sentence,
presses Cmd-Enter, and then polls `events.jsonl` in the temporary HOME until the record with that
sentence is on disk, marked `ready`. No harness stands in for the library and nothing is injected.

## What `add` prints

A static file:

```
lahe add: /tmp/x/report.html

  review    rf3004c6bfe9a  (minted just now)
  library   ../dist/lahe-layer.js
  helper    http://127.0.0.1:7817  (started just now)
  origin    null (a page opened from disk sends no origin, on every browser)

  The script line is in report.html, just before </body>.
  The script line points at the built library in this clone.

  A per-review token is in report.html.
  A token inside a repository can be committed and shared with everyone who reads the file.
  It opens this one review's feedback and nothing else: not your machine, not another review.

  Open it:  file:///tmp/x/report.html
```

A dev server prints the same header block, then the line wrapped in a development-only guard comment for
a human to paste, the URL the copied bundle should be served at, the same token warning, and the origins
that were registered. **Nothing in the application is edited**, and the output says so.

## The done bar, item by item

- **A clean clone in a temporary HOME with no existing state runs the one documented command path, adds
  the library to a page, and completes a review that lands in `events.jsonl`.** Yes,
  `install_walk_3b.spec.js`, both halves.
- **The script line matches `protocol.scriptTag` exactly.** Yes, asserted twice: in the unit test and
  again inside the walk, by building the expected string from `protocol.scriptTag` and finding it in the
  file, indented and otherwise byte for byte.
- **`add` twice reuses, `add --new` does not.** Yes, the first test in the file, and the one the
  deliberate revert breaks.
- **The README contains no macOS-only or Chromium-only claim.** Yes, asserted as a test rather than left
  as a promise, along with the requirements it must state.

## Gate

`npm run gate:builder`, run synchronously, exit 0:

```
> live-agentic-html-editor@0.0.0 lint
> node scripts/lint.js
lint passed (syntax: 143 files, no jsdom, manifest complete)

> live-agentic-html-editor@0.0.0 test:unit
> node --test test/unit/
# tests 347
# pass 347
# fail 0

> live-agentic-html-editor@0.0.0 test:browser
> playwright test
  1 skipped
  129 passed (23.6s)
```

`dist/` was not rebuilt and is not staged, per the dist rule.

## Notes for the orchestrator and the next builders

- **3A:** the source hint reaches the log as a `page.visited` event with `page_path`, `page_seq: 1` and
  `source_hint` set, appended by `add` before the helper starts. The projector should treat it as the
  page group's header hint.
- **4A:** the AC6 walk in a fresh user account is the same sequence this spec runs, minus `--port`:
  `git clone`, `npm install`, `npm link`, `lahe add <page>.html`, open the printed `file://` URL.
- **The one plan deviation** is the dev-server default origins, above.
- `src/cli/commands/setup.js` and `src/cli/commands/open.js` are marked `cut` in the manifest and are
  superseded by `add` in fact now, not just on paper.

## Cleanup needed

Nothing was deleted. For the Phase 4B batch:

- `test/unit/consumer_3b_install.test.js`: 0A-kernel's throwaway stub consumer for this task, which its
  own header says to delete once 3B has landed. It still passes.
- `src/cli/commands/setup.js`, `src/cli/commands/open.js`: already on the cut list, and `add` now really
  does what they described.
- Temporary directories under the OS temp directory from the specs and from the manual runs:
  `lahe-3b-*`, `lahe-install-walk-*`. Generated, outside the repo, safe to remove wholesale.
- `test-results/` in this worktree: Playwright output, gitignored.
