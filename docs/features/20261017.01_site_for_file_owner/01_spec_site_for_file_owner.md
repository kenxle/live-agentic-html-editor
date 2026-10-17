# Spec: the handled check reads the page, not the raw Markdown

## Problem, user, and context

When an agent answers "handled", the helper checks that the change is really on the page Ken sees. For a Markdown document, it reads the page the way the site renders it.

To find that render, the helper asks "which site serves this file?" (`siteForFile` in `src/service/page_routes.js`). It takes the first site in the list that reaches the file. A site can reach a file in two ways:

- the file sits inside the site's own folder, or
- the site has a link into the file's folder (a mount), made when another document linked to it.

On Ken's machine, the `docs/ongoing` site of the Columbia repo has a mount into the `assignments` folder. It comes before the `assignments` site in the list. So for an assignment, the helper picks `docs/ongoing`. The render step then sees the file is not inside that site's folder and gives up. The handled check falls back to reading the raw `.md` file.

What Ken saw (review r08ea49dd8947, Homework 6, on 2026-10-16):

- Two cards where he added a new paragraph stayed stuck as "not on the page". The agent answered handled six times across the two cards, and each answer was refused, though both paragraphs were on his page.
- Raw Markdown has no paragraph structure the check can read. New paragraphs always look missing there.
- Every other edit in the document came back "can't tell", so the check was quietly doing nothing for them.

Two other callers use the same lookup:

- the rebuild step's `renderForFile` call, which warms the render cache and adds link mounts to the site, and
- `recordLinkedFor`, which records which documents a review linked to. It writes onto the wrong site in this case.

High-level fix: prefer the site that owns the file, meaning the one whose folder holds it, and use a mount only when no site owns it.

## Requirements

1. **The owning site wins.** When one site's own folder holds the file and another site reaches it only through a mount, the lookup returns the owning site, whatever the list order.
2. **The deepest owner wins.** When several folder sites hold the file, the one with the deepest folder (the longest root) is the owner. A page-only site whose root is the file itself counts as the most specific owner.
3. **A mount still counts when nothing owns the file.** A file reached only through a mount is still "served" (so `servesFile` keeps saying yes, and the healer keeps leaving it alone).
4. **The handled check reads the render.** For a Markdown document whose folder site comes after a mounting site, `pageShows` reads the rendered page. A new paragraph the agent placed passes the check.

## Approach

No design call. One function changes its choice rule; the callers stay as they are. `sites.deepestFolderSite` already picks the deepest folder site, but it only knows folder sites, and `siteForFile` also has to handle page-only sites and mounts. So `siteForFile` gets the rule inline rather than calling it.

Rejected: rendering through the mounting site. A file reached through a mount is served under `/.lahe-source/<id>/`, not at `/`, so its render would be a different page from the one at the document's own address.

## Tasks

| # | Task | Proof | Failure it catches |
|---|---|---|---|
| 1 | Unit test, written red first: two sites, the first mounting the second's folder. `renderForFile` returns the render (not null). | `test/unit/sites_mappers.test.js` new test fails before, passes after | the bug as Ken hit it |
| 2 | Unit test, red first: same setup, a free-writing item with a new paragraph placed in the `.md`. `createHandledCheck(...).pageShows` returns true. | same file | the check holding a placed paragraph |
| 3 | Unit test: two nested folder sites; the deeper one wins. A file only a mount reaches is still served (`servesFile` true). | same file | requirements 2 and 3 |
| 4 | Change `siteForFile` in `src/service/page_routes.js`. | tasks 1-3 green; `npm run gate:unit` 0 failed | |
| 5 | Replay the real review's two items against the fixed code with a scratch script (outside the repo). | both come back true | a fix that passes the fixture but not the real case |

Authority: this spec. Review owner for the diff: one `feature-dev:code-reviewer`. No browser change, so no browser run and no screenshot; `npm run gate` runs once before the PR, per CLAUDE.md.

## Acceptance criteria

- Tasks 1 to 3 pass, and tasks 1 and 2 were seen failing before the change.
- `npm run gate:unit` reads 0 failed; `npm run gate` reads 0 failed before the PR.
- Task 5's replay returns true for both stuck items.
- Analytics: none needed; the helper log already says when an item is held.
- Rollout: no flag. The always-on helper picks it up on its next restart.

## Questions

- None open. The two stuck cards on Ken's review can be closed with "Mark as done" today; this fix stops the next ones.
