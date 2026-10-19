---
name: verify-lahe
description: Drive a disposable Lahe review the way a reviewer and an agent would (open a page, select, comment, edit, press choices, use the rail and the Library, answer as the agent) and capture proof. Use to prove a Lahe change works, reproduce a reported bug, or gather evidence for a PR. Covers the browser page, the rail, the helper and the lahe CLI.
---

# Verify Lahe

Lahe has two users at once: a reviewer in the browser and an agent at the
command line. A change is proven when you have done what each of them does, in
a real browser against a real helper, and captured what changed.

`bin/lahe-verify` is the control tool. It starts a throwaway review from this
checkout, holds a browser on it, and lets you act one command at a time. Every
command is logged as evidence. Read [the feature map](features/README.md) to
find the recipe for the feature you are proving.

The Playwright suite is the regression net, not a replacement for this. Use it
as the repo's gates say (see [Regression specs](#regression-specs)).

## Launch

From the checkout root, using the Node in `.nvmrc` (20 or later, because
Playwright needs it):

```sh
skills/verify-lahe/bin/lahe-verify up --run <name>
```

`<name>` is any short id you choose, such as `fix-choice-reword`. Pass the same
`--run <name>` to every later command. Without `--run`, `up` invents an id and
prints it.

What `up` does:

- Makes `$TMPDIR/lahe-verify/<name>/` with `state/`, `work/`, `profile/` and `evidence/`.
- Copies the document into `work/`. The default is
  [fixtures/sample.md](fixtures/sample.md), which has a heading per feature, a
  list, a choice group and unique sentences to anchor on. Use `--doc <file>`
  for another `.md` or `.html` file.
- Runs `node bin/lahe.js review <work/doc> --port <free>` with
  `LAHE_STATE_DIR=<run>/state`, `LAHE_PAGES_PORT=0` and `LAHE_DIRECT_LAUNCH=off`.
  It never touches the real helper on 7817 or `~/.local/state/lahe`.
- Starts a keeper process that launches Chromium (headless; set
  `LAHE_VERIFY_HEADED=1` to watch it) and opens the review.

Ready means `up` printed `open`, `session` and `review`, and returned. It waits
for the rail to boot (`window.__lahe.booted`) before it returns.

Variants:

- `up --write --doc notes.md` runs `lahe write` instead, for a blank notes page.
  The file does not need to exist.
- `up --evidence <dir>` puts the evidence somewhere that survives a reboot. The
  OS clears `$TMPDIR` eventually.

A fresh machine needs `npm ci` (for Playwright only; Lahe itself has no
dependencies) and `npx playwright install chromium` once. On Linux use
`npx playwright install --with-deps chromium`. See [references/cloud.md](references/cloud.md).

## Doctor

Run this first, and again whenever anything surprises you:

```sh
skills/verify-lahe/bin/lahe-verify doctor --run <name>
```

It reads only, prints `ok` or `FAIL` per check, and exits 2 on any failure:

- the helper in this run's state folder is alive, owned by this run, and answers `/lahe/v1/health`
- `dist/lahe-layer.js` matches `src/` (the same check as `npm run check:layer`)
- the keeper and its Chromium are running on this run's profile
- the page is this run's review, the rail booted, the layer version matches `package.json`, and the rail shows no failures

A stale bundle means you would be testing old code. Run `npm run build:layer`,
then `down` and `up` again. Builders do not commit the rebuilt `dist/`; put it
back with `git checkout -- dist/lahe-layer.js` when you are done.

If the process is healthy but the page is stuck (an editor that will not open,
a card that will not change), do not keep poking. Save a screenshot, `down`,
and `up` a fresh run.

## Drive

Four kinds of command. All take `--run <name>`.

**The reviewer, in the browser** (`page <action>`):

| Action | What it does |
| --- | --- |
| `page select <target> --text "<phrase>"` | Drags the mouse across the phrase inside the target, like a reviewer selecting text. Prints what got selected. |
| `page caret <target> --text "<phrase>"` | Clicks just after the phrase (add `--start` for just before). Without `--text`, clicks at the end of the target. |
| `page key <combo> [<combo>...]` | Presses keys, such as `ControlOrMeta+Shift+KeyC`, `ControlOrMeta+Enter`, `Escape`, `Enter`. |
| `page type "<text>"` | Types into whatever has focus. |
| `page click <target>` (also `dblclick`, `hover`) | A real mouse click at the element's centre. |
| `page goto [<url>]`, `page reload` | Navigate. Without a URL, `goto` opens the run's review. Both wait for the rail on the review page. |
| `page wait "<js expression>" [--timeout ms]` | Waits until the expression is true in the page. Use this, never a sleep. |
| `page text <target>`, `page html <target>` | Reads an element. |
| `page eval "<js expression>"` | Reads page state. Read only: never use it to cause the outcome you are proving. |
| `page rail [<name>]` | Prints the rail as JSON: tab, status, failures, items with state and reply, and every visible control with its label. With a name, also saves it as evidence. |
| `page shot <name> [--full]` | Screenshot into evidence. |
| `page aria <name>` | Accessibility snapshot of the page into evidence. It cannot see inside the rail; use `page rail` for that. |

**Targets.** The page is ordinary DOM; the rail sits in a closed shadow root
that normal selectors cannot reach.

- A page target is any Playwright selector: `text=The shed roof leaks`,
  `[data-choice="bed-size"] button[value="large"]`, `role=button[name="Open"]`.
- `rail:<css>` looks inside the rail: `rail:[data-tab=done]`,
  `rail:[data-style-id=sample]`.
- `rail-text:<words>` finds the visible rail control whose label, title or
  text holds those words: `rail-text:Mark as done`, `rail-text:End review`.
  Run `page rail` to see the labels.

**The agent** (`agent ...`), using this run's session and review:

| Command | What it does |
| --- | --- |
| `agent drain` | `lahe status --session <s> --json --quiet`: what an agent would be handed. |
| `agent wait "<text>" [--timeout ms]` | Polls the drain until a line contains the text. Choice presses and some drafts reach the helper a moment after the click, so wait on the drain, not the page. |
| `agent reply <item> <rev> <status> [--text ...] [--reason ...]` | `lahe reply` for this review as agent `verify`. `handled` also names the run's source file. |
| `agent status` | The full catch-up status, including `ended_reviews`. |

To act as the agent on a change, edit the file printed as `source` by `up`
(also in `info`), then reply. The helper notices the file changed and the page
reloads itself. Never reload the page to cover for a rebuild that did not happen.

**Any other lahe command**, against this run's helper and state:
`lahe-verify cli --run <name> -- <args>`. Examples: `-- session close <s>`,
`-- monitor --session <s>`, `-- style add test/fixtures/styles/sample`,
`-- library --port <helperPort>`. For commands that read stdin (such as
`reply --batch`), add `--stdin <file>`. The helper's port is `helperPort` in
`info`.

**Housekeeping:** `info --run <name>` prints run.json (paths, session, review,
ports, commit). `list` shows every run and whether it is up or down.

### Proof standards

- Use the reviewer's real input: mouse selection, the documented chords, clicks on the real buttons. The hooks on `window.__lahe` are for reading state and finding rail elements, not for making things happen.
- Capture the action and the result. Screenshot or `page rail` before and after, not only at the end.
- Check the other side too. A reviewer action is proven when the agent's drain shows it. An agent action is proven when the page shows it, and still shows it after `page reload`.
- A real file change is part of the proof for an edit: read the source file and the rebuilt page.
- The stub agent here is you, through the real CLI. It proves the protocol and the page. It does not prove that a real Claude or Codex host wakes up.

## Evidence

Everything lands in the run's `evidence/` folder (printed by `up` and `down`):

- `commands.jsonl`: one line per command with time, arguments, result or error, and CLI stdout, stderr and exit code
- `NNN-<name>.png` from `page shot`, `NNN-<name>.aria.yml` from `page aria`, `NNN-<name>.rail.json` from `page rail <name>`

`run.json` beside it records the checkout, commit, number of dirty files, Node
version and platform. When you report, give: the run id, the commit, the
feature and entry point from the map, what you did, what you saw, and the
evidence paths. Mark each mapped entry point as passed, failed, blocked (with
the missing precondition), or not run. Never report a path you did not drive as
verified through a different one. Do not commit evidence that holds real review
tokens or personal documents.

## Cleanup

```sh
skills/verify-lahe/bin/lahe-verify down --run <name>
```

`down` closes the session, stops the helper with the repo's own
`stopTempHelpers` (only pids named by this run's state folder), stops the
keeper and its Chromium (only processes whose command line names this run),
and prints `left running: nothing`. It exits 3 if anything survived. It never
touches the evidence folder; it prints the path and file count so you can see
the proof survived.

Run `down` after every run, including failed ones, before starting the next.
Check the repo's leak count before and after your work:
`ps -axo command | grep -c "[l]ahe.js serve"`. The two numbers should match.
Do not delete run folders yourself; `$TMPDIR` belongs to the OS.

## Helpers

`bin/lahe-verify` is one Node file with no dependencies beyond the repo's own
Playwright. Run it with no arguments for usage.

The keeper (`lahe-verify _keeper`, started by `up`) is the one process that
holds the browser. Page commands send it their action over a local port with a
per-run token. This matters: Chromium blurs the page every time a DevTools
client disconnects, and a blur ends an open edit (an empty notes page closes, a
half-typed block commits). One long-lived holder keeps focus steady across
commands.

The keeper runs the tool's code as it was at `up`. After you change
`bin/lahe-verify`, `down` and `up` a new run before trusting the change.

In zsh, a variable holding `--run name` does not split into two words. Write
`--run <name>` out in each command.

## Regression specs

The browser suite already covers most features in depth, with its own helper,
fixture and teardown per spec. After your live proof, run the spec the feature
map names for the area you changed, by itself:

```sh
npx playwright test test/browser/<file>.spec.js --workers 1 --trace on --output <fresh folder>
```

Do not run the whole suite during development; the repo's
[gate rules](../../CLAUDE.md) say when that happens. A spec passing is not a
substitute for driving the user path, and the user path is not a substitute
for the gate.

## Maintenance

[maintain-verification-skill](../maintain-verification-skill/SKILL.md) keeps
this skill and the map honest as Lahe changes. When a user-facing path lands,
add it to the map with a recipe you have driven.
