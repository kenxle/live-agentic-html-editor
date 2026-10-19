# Progress: Markdown heading ids

**Done.** Every heading in a rendered Markdown page now carries the id GitHub gives it, so `[text](#some-heading)` links land. Shipped in [PR #82](https://github.com/kenxle/live-agentic-html-editor/pull/82). Last updated 2026-10-19 15:16 UTC.

**Docs:** [Spec](01_spec_markdown_heading_ids.md)

## Needs your attention

Nothing is waiting on you.

## Phases

This ran as a whetstone change, so the rows are whetstone's steps.

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done: one renderer function and its tests | 2026-10-19 |
| 1 Worktree | skipped: one builder, working on the session's own branch | 2026-10-19 |
| 2 Spec | done | 2026-10-19 |
| 3 Spec review | skipped: the board row already named the fix (GitHub-style slugs) and Ken asked for it | 2026-10-19 |
| 4 Human gate | done: Ken asked for it launched | 2026-10-19 |
| 5 Build | done | 2026-10-19 |
| 6 Code review and verify | done: one reviewer, nothing blocking, four optional findings taken | 2026-10-19 |
| 7 Ship and land | done, merged as 24074c1 | 2026-10-19 |
| 8 Close out | done | 2026-10-19 |

## The record

### Changes from plan

- From the review: no trim (GitHub keeps the hyphen a leading tag or trailing image leaves), a code span reads as written, numeric entities decode and a no-break space drops.
- From the review: a slug starting with `lahe-` gains a `section-` prefix, so a heading named "Lahe surface root" cannot take the id the review layer mounts on. This is the one departure from GitHub.
- Main gained the pandoc renderer (PR #80) while this waited, and the merge conflicted. Pandoc-drawn headings now get the same ids, read off pandoc's HTML, and a test checks both engines agree. Main had also added its own `decodeEntities`; one is kept.
- The entity decoder moved from `src/service/handled_check.js` into `src/service/markdown.js`, so the handled check and the heading ids read text the same way.

### Follow-ups

None.

### Screenshot

None: the change adds an attribute and draws nothing new.

### Test results

The run is in a Linux cloud container on Node 20.20.0. Its resolver does not answer `*.localhost` names, so the gate ran with a scratch preload that resolves them to loopback, the way macOS and browsers do. Its Chromium is Playwright's 1194 build, which the run named by path.

- Main after merge, 24074c1, gate run alone: unit 3,082 pass, 2 fail (the same two container failures), 11 skipped. Chromium 912 passed, 0 failed, 8 skipped. Helpers 0 before, 0 after.
- Branch after the main merge, 6777c89, gate run alone, with pandoc 3.9 on PATH so the pandoc tests ran: lint passed, bundle check passed, menu bar check skipped. Unit 3,082 pass, 2 fail (the same two container failures below), 11 skipped. Chromium 912 passed, 0 failed, 8 skipped. Helpers 0 before, 0 after.
- Branch, 0567373, gate run alone: lint passed, bundle check passed, menu bar check skipped (not macOS). Unit 3,036 pass, 2 fail. Chromium 907 passed, 1 failed, 8 skipped.
- The 2 unit failures fail the same way on main and come from the container: V10 expects a refused IPv6 address the container does not refuse, and the style 404 test (fix round 1) uses `chmod 000`, which root, the container's user, reads through.
- The 1 Chromium failure, `reply_toast.spec.js:559`, passed 18 of 18 when its spec file ran alone.
- Helpers: 0 before and 0 after.

### To delete at cleanup

- The reviewer's detached worktree of main at 6cedb55, in the session scratchpad outside the repo. It is listed in `git worktree list` of the cloud clone only.

## Log

- **2026-10-19 15:16.** Merged after GitHub CI passed; the post-merge gate on main is clean. Board row LAHE-markdown-heading-ids is done.
- **2026-10-19 15:30.** The PR got no CI run and main moved under it; merged main and reran the gate.
- **2026-10-19.** Ken asked for the board row LAHE-markdown-heading-ids to be launched. Built, reviewed, gated.
