# Phase 3, Task 3.3 plus two fixes: the count script, one watcher line per card, one queue read per list

**Summary.** Done on branch `task/lib-fixes`, off `feat/lahe_library` at `8b0c544`. Three commits:

- the count script (Task 3.3)
- the reader reads the request queue once per list call
- the Library names the watching agent once per card

Results:

- `npm run gate:unit`: 1596 tests, 1594 pass, 0 fail, 2 todo. The two todos are the older `anchor_cases.test.js` ones.
- `npx playwright test test/browser/catalog_page.spec.js`: 13 passed (Chromium).

![The Library, light](../catalog_page_light.png)

![The Library, dark](../catalog_page_dark.png)

Both screenshots come from the spec's last test, in the same run as the test that proves the card change.

## 1. The count script (Task 3.3)

- **`scripts/catalog_opens.py`** (new). Python standard library only.
  - It reads the helper log: a path argument, or `helper.log` in the state dir. The state dir is found the way the helper finds it: `$LAHE_STATE_DIR`, then `$XDG_STATE_HOME/lahe`, then `~/.local/state/lahe`.
  - It writes one CSV row per Open: `review,time,age_days,older_than_default_view`. The time is in the `--tz` zone.
  - It prints:
    - Opens per working day, with zero days listed, from the first Open's date to the last
    - the working-day total and average
    - the weekend Opens
    - how many Opens were older than the default view
  - `--tz` defaults to the system's zone. An unknown zone exits 2 with a message, not a traceback.
  - The log prefix, the Open action and `DEFAULT_VIEW_DAYS` are read from `src/shared/protocol.js`, so the script cannot drift from the helper. If `protocol.js` stops spelling them the way the script expects, it says so and exits 2.
  - "Older" means `age_days > DEFAULT_VIEW_DAYS`. An Open exactly 7 days old is not older.
- **`test/unit/catalog_opens_script.test.js`** (new, 5 tests). Each test runs the script as a child process.
  - on `test/fixtures/catalog_log.txt` with `--tz UTC`:
    - the CSV rows
    - Opens per working day: Mon 21 = 2, Tue 22 = 0, Wed 23 = 1, Thu 24 = 0, Fri 25 = 1, Mon 28 = 1
    - 6 Opens, 5 on working days, 1 on a weekend, 3 older than 7 days
  - with `--tz Pacific/Auckland`: Friday evening UTC becomes Saturday, so the per-day counts shift
  - lines that are not Opens are ignored, including a `Library ...` error line and a torn line
  - an unknown `--tz` is refused
  - The tests skip when no `python3` is on PATH. The test file says so in each test's skip reason.

## 2. One watcher line per card (design fix)

**Before:** every row carried an "agent watching: `<name>`" badge. A seven-row card said it seven times.

**Now:**

- The card's summary line names the watcher, with the blue watching dot the rows used to carry:
  - "watched by `<agent>`"
  - "watched by `<agent>`, the agent that opened this Library", when the watcher is the attached agent
  - "no agent watching" is unchanged
- A row inside its own card has no watching badge.
- A row shown outside its card keeps the badge. Today that is only the missing section, which lists rows flat.

Files:

- `src/layer/catalog/view_model.js`:
  - `buildRow` takes the watcher its card already names
  - the card has `watched`
  - the two card strings in `TEXT` changed, with a comment giving the reason
- `src/layer/catalog/page.js`: renders the card's watch text as a nested badge, so the meta line's dot separator does not apply to it.
- `test/unit/catalog_view_model.test.js`:
  - 3 tests changed to the new wording
  - 3 new tests:
    - a watcher with no name is named by its session id
    - a watched card names its agent once
    - a row outside its card keeps the badge
  - Each ran red first.
- `test/browser/catalog_page.spec.js`: the old spec never asserted the badge text, so nothing needed rewriting. One new test covers:
  - the card line text for `s_coach` and `s_ops`
  - one watching dot on the summary
  - no watching badge in the card's rows
  - the missing row's badge after "Show missing"

  It failed against the old page code (stashed) and passes on the new.

## 3. One queue read per list (performance fix)

**Before:** the reader called the queue's `requestFor` once per row. Each call re-read and re-folded `catalog-requests.jsonl`, which is 23 reads per list on the reader fixture, every 15-second poll.

**Now:**

- `src/service/catalog_requests.js`:
  - `requestsAt(nowMs)` resolves the file once and returns a `(reviewId) => request` lookup with `requestFor`'s exact answer
  - `requestFor` now calls it
  - a `readFile` option, a test seam like the reader's
- `src/service/catalog_reader.js`:
  - a `requestsAt` option; `list` builds the lookup once per call
  - without the option, it falls back to `requestFor` per row
  - a new `queueInputs(queue)` export spells the helper's wiring once
- `src/service/index.js`: wires the reader through `queueInputs`, so the test covers the helper's own wiring.
- `test/unit/catalog_reader.test.js`: 1 new test. A real queue with a counting `readFile`, wired through `queueInputs`: one `list` reads the queue file exactly once, and every row still gets its request. It was red at 23 reads before the change.

## Deviations

- **The card's watcher strings changed from the Page Spec.** The spec's "the agent that opened this Library is watching it" and "an agent is watching" did not name the agent. Naming it once on the card is the fix, so they are now "watched by `<agent>`, the agent that opened this Library" and "watched by `<agent>`". The row badge text, "agent watching: `<name>`", is unchanged where it still shows.
- **"A row whose watcher differs from its card's"** can only happen outside a card today. The list response gives the watcher per session, not per review, so every row in a card shares its card's watcher. The rule is written as a comparison (`sameWatcher`), so a per-review watcher would work if the list ever carries one.
- **`catalog_requests.js` and `index.js` changed.** They were not named in the brief for fix 3, but the queue file is read by the queue, not the reader. So a single read needs the queue to answer many reviews at once.
- **The script's CSV goes to a file** (`--csv`, default `catalog_opens.csv` in the current directory), and the summary goes to stdout. The plan did not say where the CSV goes.

## Follow-ups

- **Orchestrator:** `dist/` was not rebuilt or committed. `check:layer` will be stale, because `view_model.js` and `page.js` changed.
- **Orchestrator:** the plan's Page Spec still has the old card strings. Update it, or accept the change under Changes from plan.

## Cleanup needed

- `node_modules` in this worktree is a symlink to the main checkout's. It is untracked and not committed. It goes when the worktree is torn down.
- `test-results/` from the Playwright runs is in this worktree and is git-ignored.
- A scratch CSV (`o.csv`) is in the session scratchpad under `/tmp`, so it needs no removal.
