# Progress: Markdown link allow list

**Building.** Rendered Markdown carries only web, email and phone links, plus relative and in-page ones; every other link type renders as plain text. Nothing is waiting on you. Last updated 2026-10-19 05:55 UTC.

## Needs your attention

Nothing is waiting on you. A related hole is on the board for your call: raw HTML in a Markdown file passes through the renderer untouched (LAHE-markdown-raw-html).

## Spec

Board row LAHE-markdown-link-schemes. A Markdown link whose address is not a web page, email or phone number rendered as a live link, so a link with a script-running scheme ran its code in the rendered page when clicked. Ken chose an allow list over a block list on 2026-10-19.

1. A link renders as a link only when its scheme is `http`, `https`, `mailto` or `tel`, or when it has no scheme (relative paths, absolute paths, `//host` links, `#anchors`).
2. Any other scheme keeps the link's words as a `span.lahe-blocked-link` whose title names the scheme. No `href` is written.
3. The scheme is read as a browser reads it: case-blind, after dropping leading spaces and control characters, with tabs and line breaks removed anywhere.
4. Inline links, reference-style links and autolinks all go through the one check, in `classify` (`src/service/markdown_links.js`).

Out of scope: raw HTML inside Markdown, which marked passes through as written. That is a separate row for Ken's call.

## Phases

This ran as a whetstone change, so the rows are whetstone's steps.

| Step | Status | Changed |
|---|---|---|
| 0 Size it | done: small, one function | 2026-10-19 |
| 1 Worktree | done: branch `claude/project-thread-9afnnh` | 2026-10-19 |
| 2 Spec | done, above | 2026-10-19 |
| 3 Spec review | skipped: Ken settled allow list vs block list in the thread | 2026-10-19 |
| 4 Human gate | done: Ken said build and ship without waiting on him | 2026-10-19 |
| 5 Build | done: tests red on the old code, green on the new | 2026-10-19 |
| 6 Code review and verify | running | 2026-10-19 |
| 7 Ship and land | not started | |
| 8 Close out | not started | |

## The record

### Test results

- `node --test test/unit/markdown_links.test.js` on the old code: 5 pass, 2 fail (the two new tests). On the new code: 7 pass, 0 fail.

## To delete at cleanup

Nothing yet.
