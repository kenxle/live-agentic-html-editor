# Phase 2, helper workstream (2C): progress

**Summary.** Tasks 2.8 to 2.12 are built on `free-writing-2c`, in five commits. `npm run gate:unit` is green: 1647 tests, 1645 pass, 0 fail, 2 todo (the base's 2 todo). None of these tasks names a browser spec, so no browser spec ran, and no full suite ran. `dist/` was not rebuilt or committed.

## What was built, by task

### 2.8 Helper enforcement, the draft floor, refused events (`a22dfd1`)

- `src/service/log.js`: `append` runs `record.validateRun` on the event's `record` before anything is stored. A refusal goes into `rejected` as `{event_id, code, reason}`. The event never reaches `events.jsonl`, and its `event_id` stays unused, so a fixed copy of the same event can still be stored.
- `src/layer/sync.js`:
  - A run record's drafts wait `FLUSH.RUN_DRAFT_FLOOR_MS` (30 seconds). Other drafts keep the 10-second floor. A commit is never held.
  - The withdrawal keystroke still posts on the debounce (main's rule). Later drafts wait for the run floor.
  - When the helper refuses an event with one of the four run codes, sync drops that event from the outbox, so it is posted once. The item then carries `RUN_EVENT_REFUSED`: `sync.refusalFor(itemId)` returns the failure, and the new `onItemRefused(itemId, failure)` option is called once. The helper's own code is in `failure.detail.helper_code`. A later accepted event for the same item clears it.

### 2.9 The handled check (`70b9db3`)

`src/service/handled_check.js`:

- `checkable` now accepts `format_only` records. Run records were already `edit` records.
- `verdictFor` sends a run record to `runVerdictFor` and a `format_only` record to `formatVerdictFor`.
- **Run records (AQ3).** The blocks are checked on every handled reply. The check reads the built page's leaf blocks (`normalize.leafBlocks`), finds the first block's leaf, and matches the rest with `normalize.matchRun`. A run never goes through `splitStarts`. A section label is not a leaf, so it does not break the match.
- **The anchor** follows main's per-edit rule, through `verdictFor` on `record.anchorView`. It is skipped for a container anchor, for `start_of_container`, and when the anchor has fewer than `SHORT_BLOCK_WORDS` words.
- **`format_only` records** are judged only when nothing was written (main's rule). Each span that gained bold or italic must sit inside a `strong`/`b` or `em`/`i` in a leaf block of the built page.

### 2.10 `lahe write` (`c64ee35`)

- `src/cli/commands/write.js` (new) applies every path rule:
  - `.md` or `.markdown` only
  - the parent folder must exist
  - `lstat` first, and any symlink is refused, dangling or not
  - a directory is refused
  - a new file is created with `wx`; on `EEXIST` it checks again with `lstat`
  - it never overwrites
  - the parent's real path is printed on a `notes in` line
- It then calls `review.run(argv, {notes: true, notesFolder})`.
- `src/cli/commands/review.js` has a notes mode:
  - It renders the Markdown as today and starts a one-page server whose root is the rendered page itself.
  - It registers no asset mount and no link mounts.
  - It passes `--notes` to `add`, and adds `--new` when this render already belongs to a review that is not a notes review.
  - It prints `scope` and `notes in` in place of `root`.
- `src/service/static_servers.js`, the one-page mode:
  - `isPageRoot(root)` is true when the root is a file. The server id is the hash of that file's path, so the server is keyed by the page and never reuses a folder server.
  - It serves the page (with the rail injected), `/.lahe-doc-style.css`, the three `/.lahe-fonts/*.woff2`, the Mermaid asset, and the library. Everything else is a 404, including siblings, dotfiles, `/`, and other reviews' renders in the same artifacts folder.
  - `registerMount` refuses a one-page server.
  - The idle sweep and `restartAll` pass a record's `root` back to `start`, so a restart comes back as the same one-page server. `idle_servers.js` needed no change.
- **The notes marker:**
  - `add.js`: the internal `--notes` flag, set on the new review's spec, and sent on the held-review write as `notes: true`.
  - `reviews.js`: `notes` is on the review and in `meta.json`, and rides the `review.created` event. `isNotes(id)` is new.
  - `routes.js`: `review.write` answers `notes` through `protocol.acceptsNotesFlag` and `isNotes`.
  - `projection.js`: the fold reads `notes` off `review.created`, and `projectFold` passes it to `review_format`.
- Docs:
  - `src/cli/index.js` registers `write`.
  - `docs/CLI.md` has a `write` row.
  - `docs/diagrams/module_map.md` has the `write` entry.
  - `skills/lahe/SKILL.md` has a table row and a "Notes on a blank page" scenario. The contract text is untouched, and the skill is not installed.

### 2.11 The file-name title is chrome (`4c12f61`)

`src/service/markdown.js` marks the hero `h1` with `markers.FILE_TITLE_ATTR="file-name"` when the title is the file name, which happens when the file has no `#` heading.

### 2.12 Proofreading replies (`9160b19`)

- `src/cli/commands/reply.js` gains `--proofread` and a repeatable `--suggest <block> <from> <to>`.
- Both flags work on `--status question` only, and `--suggest` needs `--proofread`.
- The command reads the item from `review.json` and refuses the line in three cases:
  - the item's rev is not the one named
  - the item has no `new_blocks`
  - `record.applySuggestions` refuses a suggestion, tried on its own and then all together. The message names each refused suggestion as `--suggest <block> "<from>" "<to>": SUGGESTION_NOT_FOUND, ...`.
- `docs/CLI.md` documents both flags.

## Tests added

| File | Tests | Covers |
| --- | --- | --- |
| `test/unit/log_run.test.js` (new) | 5 | forged runs refused with their codes, with nothing in the log or `review.json`; a refused event's id stays usable; a valid run is stored and projected whole; the size tests, computed |
| `test/unit/draft_flush_cadence.test.js` | +5 | the run floor, the comment floor, a commit not held, withdrawal then the run floor, a refused event posted once and carrying `RUN_EVENT_REFUSED` |
| `test/unit/handled_check_run.test.js` (new) | 12 | the Task 2.9 acceptance list, on real Markdown renders |
| `test/unit/markdown_render.test.js` | +4 | empty file and no-heading file are marked, a `#` heading is not, the empty render equals the Phase 1 fixture |
| `test/unit/reply_proofread.test.js` (new) | 6 | the line parses, `--suggest` on handled is refused, `--suggest` without `--proofread`, a twice-found `from` is named, a stale rev, a non-number block |
| `test/unit/write_command.test.js` (new) | 11 | the Task 2.10 acceptance list, plus the style and fonts served, an ordinary review is not notes, and a restarted one-page server |
| `test/unit/cli_dispatch.test.js` | +1 assertion | `write` is listed and routed |

Each new test was run red before its code, with one exception. The restart test in `write_command.test.js` was written after the one-page server, as a regression guard, and passed on its first run.

## Commands and results

| Command | Result | Wall time |
| --- | --- | --- |
| `npm run gate:unit` after 2.8 | 1614 tests, 1610 pass, 2 fail, 2 todo | 48s |
| the two failing files run alone (`session_list`, and the "nothing is distinguishable fails fast" timing test) | both 0 fail | a few seconds |
| `npm run gate:unit` after 2.10, before the docs | 1646 tests, 1 fail (`add_command.test.js`: `lahe write` routed but in no doc) | about 40s |
| `npm run gate:unit` (final) | 1647 tests, 1645 pass, 0 fail, 2 todo | 38s |

The two failures after 2.8 were timing-sensitive tests. They passed alone, and neither touches a file this workstream changed. Other builders were running at the time. No full browser suite ran, and no single browser spec either, since none is named for 2.8 to 2.12.

## Deviations

- **Hyphens in the run check.** `normalize.foldTypography` folds an em or en dash to `-` but leaves `--` as typed, so "`--` rendered as a dash" failed. `handled_check.js` folds runs of hyphens to one on both sides of the run match (`runWordsOf`). This is a local fold because `src/shared/` is off limits. **Replay's page check (2B) will likely hit the same gap.** The better fix is in `normalize.foldTypography`, which is the orchestrator's call.
- **`test/unit/rebuild_not_the_agents_job.test.js`** is outside the 2C row. Its test "a delete and a format-only record are never checked" contradicts Task 2.9, which checks `format_only`. I changed only that assertion, and renamed the test.
- **`src/service/projection.js`** is outside the 2C row, but the kernel handoff says the projection must carry `review.notes`. Two lines changed: the fold reads `notes` off `review.created`, and `projectFold` passes it on.
- **Notes is set when a review is created, never after.** It rides the `review.created` event, so `lahe status`, `review.json`, and every other fold of the log agree. `lahe write` on a file whose render already has an ordinary review mints a new notes review (`--new`) rather than turning the old one into notes. `review.write` with `notes: true` only reports whether the review is one.
- **The refused-event card state lives in sync, not on the stored record.** `record.js` has no field for it, and `src/shared/` is off limits. Task 3.2 reads it with `sync.refusalFor(id)` or the `onItemRefused` option. `src/layer/index.js` does not wire `onItemRefused` yet, because that file is not mine.
- **`--proofread` refuses a rev mismatch.** The rest of `reply` only warns on one. Suggestions name one revision's words, so a stale rev cannot be checked.
- **`lahe write` prints `created <path>` first** when it made the file, and `notes in <real folder>` in place of `root`.

## Surprises

- The rendered Markdown pages of a whole session share one artifacts folder. An ordinary Markdown review's server is rooted there, so it already serves every render in the session. The one-page server sidesteps that: its root is the page file.
- `review.json` is written lazily by the helper, so the notes tests fold the log (`projection.project`), the way `review_command.test.js` does.

## Follow-ups

- **For 3.2 (rail):**
  - Draw `RUN_EVENT_REFUSED` from `sync.refusalFor(id)`.
  - Wire `onItemRefused` in `index.js` to repaint the card.
- **For the orchestrator:**
  - Consider folding `--` in `normalize.foldTypography` (see Deviations).
  - Clear `planned` on `src/cli/commands/write.js` in the manifest.
- **The file-name title marker changes the rendered hero `h1`** on every Markdown page with no `#` heading. The layer skips a marked title as an anchor (`blocks.js`). Any existing browser spec that anchored an edit to such a title will change. I found no unit test that depends on it.
- **A notes page's local links** render as `/.lahe-source/...` links that 404 on its one-page server. That is by design: a notes page has no images.

## Cleanup needed

- None. No file was removed. Tests write only under the OS temp folder, and every test closes the sessions and helpers it started.
