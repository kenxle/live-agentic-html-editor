# Card edges: progress

**Done.** Rail cards no longer have the curved blue left stripe or the green wash on handled cards, and the README hero shows the new cards. Nothing is waiting on you. [PR #68](https://github.com/kenxle/live-agentic-html-editor/pull/68), merged 2026-10-14. Closed 2026-10-16 17:32 EDT.

Docs: [spec](01_spec_card_edges.md)

## Needs your attention

Nothing is waiting on you.

## Currently working on

Nothing is running.

## Phases

| Phase | Status |
| --- | --- |
| Spec | done 2026-10-14 |
| Spec review | skipped: a style change with no design call |
| Build | done 2026-10-14 |
| Code review | done 2026-10-14, no issues |
| Ship | done 2026-10-14, PR #68 |
| Close out | done 2026-10-16 |

## The record

### Task index

| Task | Status |
| --- | --- |
| Unseen mark becomes an accent border on all four sides (`src/layer/tab_done.js`) | done |
| Handled card becomes the plain card; the unused `--handled-wash` and `--handled-line` tokens go (`src/layer/overlay.js`) | done |
| Rebuild `dist/lahe-layer.js` | done |
| Retake the README hero (`docs/images/hero-thread.jpg`) | done |

### Passes

One build pass. The first gate failed on the card-states browser test in `test/browser/rail_agent_liveness.spec.js`, which still checked that a handled card is green. It now checks for the plain card. The second gate passed.

### Changes from plan

- The README hero moved from a plain Markdown demo page to the public Steady Thread home page, at Ken's request. A local proxy serves the public page with the Lahe script added. The "coach" fix in the hero's thread exists only in that proxy; the live site was not changed.

### Follow-ups

None.

### Cleanup queue

- the worktree `.claude/worktrees/rail-card-restyle` and its local branch `fix/rail-card-restyle` (merged, and deleted on GitHub)

### Test results

| Run | Unit | Browser | Helpers left running (1 is Ken's own) |
| --- | --- | --- | --- |
| Branch gate, second run | 2878 passed, 0 failed | 885 passed, 0 failed, 7 skipped | 1 |
| CI on the PR | pass | not run on GitHub | |
| Gate on main after the merge | 2878 passed, 0 failed | 885 passed, 0 failed | 1 |

### Ship

PR #68, merged 2026-10-14. Nothing to deploy: Ken's pages pick up the new bundle on reload, because the helper serves the main checkout's `dist/`.

The script that took the hero is kept outside the repo at `~/Documents/lahe-readme-hero/capture_st.js`.

## Log

- **2026-10-16.** Closed out. The style guide already describes the new cards. No diagram mentions card colors. One lesson queued, on how to take the README hero.
- **2026-10-14.** Shipped in PR #68.
