# Progress: Small board fixes

**Building.** Five board rows Ken asked for on 2026-10-19, shipped as one whetstone change. Nothing is waiting on you. Last updated 2026-10-19 06:20 UTC.

## Needs your attention

Nothing is waiting on you. "Helper" is still the word in about 230 user-facing strings and in the skill and contract (LAHE-brand-rename-helper). That rename touches the contract and all its copies, so it is left for its own change.

## Spec

| Row | Change | Test |
|---|---|---|
| LAHE-inject-minified-line | When markup comes before `</body>` (or `</html>`) on its line, the script tag goes directly before the closer on that line, not at the line's start, which on a minified page is inside `<style>`. Removing it restores the file byte for byte. | `add_command.test.js`, "on a minified page" |
| LAHE-csv-served-as-download | `.csv` and `.tsv` are served as `text/plain; charset=utf-8`. Browsers download `text/csv`, so plain text is what makes the rows show in the tab. | `hidden_files_served.test.js`, "a CSV or TSV" |
| LAHE-lint-duplicate-functions | Lint check 1b compiles each file inside a strict block (never runs it) and reports a name declared twice at the top level. No false positives on the 538 tracked files. | `lint_duplicates.test.js` |
| LAHE-style-change-regenerates-fixture | `LAHE_REGEN_FIXTURES=1 node --test test/unit/markdown_render.test.js` rewrites `empty_notes.html`; the failure message names the command. A regen on main is byte-identical to the committed fixture. | `markdown_render.test.js` |
| Brand rows | Lahe, not LAHE, in the Library, CLI handover text, failures, INSTALL.md and skill references; the rail's down message says "The Lahe program is down"; the End review label says what ending does; INSTALL.md calls the script the review layer; the README names Gemini CLI. | Pinned strings updated in their unit and browser tests |

## Phases

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done: five small rows, one PR | 2026-10-19 |
| 1 Worktree | done: local branch, shipped on `claude/project-thread-9afnnh` after the link fix merges | 2026-10-19 |
| 2 Spec | done, above | 2026-10-19 |
| 3 Spec review | skipped: each row already named its fix | 2026-10-19 |
| 4 Human gate | done: Ken said build and ship without waiting on him | 2026-10-19 |
| 5 Build | done: each new test red on the old code, green on the new | 2026-10-19 |
| 6 Code review and verify | running | 2026-10-19 |
| 7 Ship and land | not started | |
| 8 Close out | not started | |

## The record

### Test results

- Unit, Node 20.20.0: 3,055 tests, 3,039 pass after the skill-wording fix, 2 fail. Both failures (`sites_dispatch` V10 and `sites_styles` fix round 1) fail the same way on main in this cloud container, which runs as root; they pass on Ken's Mac and on GitHub CI.

## To delete at cleanup

- `test/unit/zz_dup_probe.js`, a probe for the lint check, held in `git stash` on the cloud container only. Nothing in the repo.
