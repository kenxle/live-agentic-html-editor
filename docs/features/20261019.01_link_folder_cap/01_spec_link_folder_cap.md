# Linked folder cap

**Status:** built and shipped by the agent without a review gate, at Ken's request. This page is the record.

## Problem, user, and context

A Markdown page Lahe renders can link to files in other folders. Lahe serves each of those folders read-only at the page's address so the links work. A cap limits how many folders it will serve. Past the cap, a link turns into plain text that names the file on disk.

Ken's skill docs (pstack and feature-forge) are now spread across many folders, and he is hitting the cap on real documents. Two things cause it:

- **The server counts the wrong thing.** The cap is meant to count the folders one page links to. The comment on `MOUNT_CAP` says "one render", and the unit test is named "the per-render mount cap". But when the helper renders a page on request, it counts every folder the whole site has ever served. Once a site has collected 16 folders across all its pages, no page on it can link a new folder. `lahe review` renders with a fresh count, so the two paths disagree.
- **16 is too low for one page.** Ken's real documents link into up to 34 folders on one page.

Measured on Ken's machine (scripts in the scratchpad, numbers from the scripts):

| What | Count |
|---|---|
| Sites in the real helper | 81 |
| Sites serving 16 or more folders | 4 (largest: 27) |
| `feature-forge-runbooks` site | exactly 16, the one Ken is hitting |
| Markdown files scanned in his skill repos | 554 |
| Files linking into more than 16 folders | 5 |
| Files linking into more than 32 | 2 |
| Files linking into more than 64 | 0 |
| Most folders linked from one file | 34 (pstack `poteto-help/SKILL.md`) |

The cap exists so that a page linking a whole tree of folders does not quietly serve that tree. That reason still holds. The fix keeps the cap and makes it count what it says it counts.

## Requirements

1. **The cap counts per page.** A render counts only the folders that render newly serves. Folders the site already serves are free, the same as in `lahe review`.
2. **The cap is 64 folders per page.** That is almost twice the largest real document.
3. **Past the cap, nothing else changes.** A link past the cap still renders as plain text naming the file, `lahe review` still says how many links went past it, and a `--only` page still follows no links.
4. **Docs say the new number.** `docs/INSTALL.md` names the cap.

## Approach

One design call: count per page, not per site. The other choice was to keep the site-wide count and raise the number. A site-wide count runs out over time, because a site never forgets a folder, so any number would be hit again.

A per-page count has one gap: a page that links more than 64 folders gets the rest served on a later render, once the first 64 are already on the site. `lahe review` has always worked this way. No real document comes close to 64, and every served folder still has to be under the home folder, so this is accepted.

The change: `page_routes.renderMarkdown` stops passing the site's folders as already counted, and `createRegistry` loses the `consumed` option, which nothing else uses. `MOUNT_CAP` goes from 16 to 64.

## Tasks

1. Write the failing test: a site that already serves 16 folders renders a page that links one new folder, and that link is served.
2. Make the change in `src/service/markdown_links.js` and `src/service/page_routes.js`.
3. Update `docs/INSTALL.md`.
4. Run `npm run gate`. The change touches serving, so code review covers path safety.

| Behavior | Proof | Failure it catches |
|---|---|---|
| A site with 16 served folders still links a page's new folder | new test in `test/unit/sites_pages.test.js` | the site-wide count blocking Ken today |
| One page can link up to 64 folders, the 65th is plain text | `test/unit/markdown_links.test.js`, existing cap test (uses `MOUNT_CAP`) | the cap gone, or off by one |
| A `--only` page follows no links | existing tests | per-page counting letting `--only` follow links |
| Nothing else moves | `npm run gate`, 0 failed | anything else |

## Acceptance criteria

The verification table passes, and `npm run gate` reads 0 failed. No analytics: Lahe has none. No flag: the change is small and the old number is one constant away.

## Review

**Spec review (security):** see the summary below.
