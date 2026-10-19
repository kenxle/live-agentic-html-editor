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

1. **The cap counts per page.** A render counts each folder the page links into once, whether the site serves it already or not. The folder the page sits inside (the site's root, or the mount it is read through) is free. What the site served for other pages does not count.
2. **The cap is 64 folders per page.** That is almost twice the largest real document.
3. **Past the cap, nothing else changes.** A link past the cap still renders as plain text naming the file, `lahe review` still says how many links went past it, and a `--only` page still follows no links.
4. **Docs say the new number.** `docs/INSTALL.md` names the cap.

## A second fix landed at the same time

While this was being built, a Codex session in the feature-forge repo hit the same limit on Ken's pages. It committed its own fix to Lahe's local `main`, 6731010f, and did not push it. That fix makes a link reuse the site's own folder, or a folder the site already serves, when the target sits inside one. A link like that no longer uses up the cap.

The two fixes cover different links, so this branch sits on top of 6731010f and one pull request ships both:

- **6731010f:** links that stay inside one tree.
- **This change:** links out to separate places, such as `~/.claude/skills` or the pstack plugin cache, once a site has collected 16 folders.

One edit to 6731010f's work: its registry test set up "cap already reached" as one counted folder with a cap of 1. This change removes the counted list, so the test now says cap 0. What it checks is the same.

Measured on Ken's real sites by rendering every Markdown file the way the helper does, with the folders each site serves today:

| Site | Code | Pages with dead links | Links turned to plain text |
|---|---|---|---|
| `feature-forge-runbooks` (repo root, 288 pages) | main with 6731010f | 9 | 169 |
| `feature-forge-runbooks` (repo root, 288 pages) | this branch | 0 | 0 |
| `docs/features/runbooks` (215 pages) | main with 6731010f | 0 | 0 |
| `docs/features/runbooks` (215 pages) | this branch | 0 | 0 |

## Approach

One design call: count per page, not per site. The other choice was to keep the site-wide count and raise the number. A site-wide count runs out over time, because a site never forgets a folder, so any number would be hit again.

A first version counted only the folders a render newly served. The code review found the hole in that: each reload treats the last render's folders as already served, so a page linking 200 folders gets 64 more working links on every reload, and the "past the cap" line from `lahe review` turns false. The fix counts every folder the page links into, served or not, except the one the page sits inside. A brand-new mount always counts, even one that contains the page's folder, so a link to a file directly in home is not free.

The change: `createRegistry` in `src/service/markdown_links.js` keeps a `counted` list of folders this render linked into, `classify` passes the page's folder to `add`, and the `consumed` option is gone. `page_routes.renderMarkdown` stops passing the site's folders as already counted. `MOUNT_CAP` goes from 16 to 64.

## Tasks

1. Write the failing test: a site that already serves 16 folders renders a page that links one new folder, and that link is served.
2. Make the change in `src/service/markdown_links.js` and `src/service/page_routes.js`.
3. Update `docs/INSTALL.md`.
4. Run `npm run gate`. The change touches serving, so code review covers path safety.

| Behavior | Proof | Failure it catches |
|---|---|---|
| A site with 16 served folders still links a page's new folder | new test in `test/unit/sites_pages.test.js` | the site-wide count blocking Ken today |
| A page past the cap stays past it on every reload | new test in `test/unit/sites_pages.test.js`, three loads | the per-render count leaking across reloads (code review) |
| One page can link up to 64 folders, the 65th is plain text | `test/unit/markdown_links.test.js`, existing cap test (uses `MOUNT_CAP`) | the cap gone, or off by one |
| A `--only` page follows no links | existing tests | per-page counting letting `--only` follow links |
| Nothing else moves | `npm run gate`, 0 failed | anything else |

## Acceptance criteria

The verification table passes, and `npm run gate` reads 0 failed. No analytics: Lahe has none. No flag: the change is small and the old number is one constant away.

## Review

**Spec review (security): ship as is.** Accepted as is. Its findings:

- **A site's served folders can now grow with no limit.** A page inside a linked folder can link folders of its own, and a site never forgets a folder. This is not a new hole. One link to a file in `~/.ssh` or `~/.aws` already served that whole folder at 16. The real limits are unchanged: a folder must be under the home folder, checked on every request; the page server answers only this machine; and each site has its own address, so other sites can't read its files.
- **A decision for Ken, separate from this change.** A linked folder serves every file in it, not only the file the page linked. Tighter options: serve only the linked files, or refuse folders like `~/.ssh`, `~/.aws` and `~/.gnupg`. It is on the board as `LAHE-linked-folder-scope`.

## Premise check: the cap does not limit exposure

Both fixes on this page share one belief: that limiting the number of linked folders limits what a page can expose. Before shipping, that belief was tested.

- **The check:** in a temp home folder, a page linked one file, `~/todo.md`. That made one mount, well inside any cap. Then the probe asked the page server for files the page never linked.
- **The result:** `~/.ssh/id_ed25519` and `~/Documents/taxes/2025.txt` both came back with status 200. A mount serves its whole folder tree, and the home folder itself can be a mount. Neither commit here touches that code, so `origin/main` does the same.
- **What follows:** the count never limited exposure, at 16 or at 64. Raising it here costs no safety, so this change still ships to unblock Ken's pages. The condition to remove is "a mount serves a whole tree": serve only the files a site's pages link to, plus their images, and the cap can go. That is a design change to serving, so it waits for Ken on board row `LAHE-linked-folder-scope`.
- **Who can reach it today:** not other websites. The cross-origin header and the missing CORS headers stop them. Local programs could read the files directly anyway. The gap is scripts running on a reviewed page's own address.
- **Minor.** The render cache key includes every folder the site serves, so a new folder clears the cache for every page on that site. That costs speed, not safety. Accepted.

**Code review:** one important finding, fixed. Counting only the folders a render newly served let the cap leak across reloads, as described under Approach. The fix is in, with a test that loads the page three times. Everything else it was asked to check held: already-served folders are found before the cap is checked; `--only` pages follow no links; the reuse URLs are encoded right; a symlinked folder that points outside the site gets its own mount, never a site address the server would refuse; and nothing still reads `consumed`.

## How the whetstone run went

Ken asked for this run partly to see whether the whetstone skill still works. He waived the two human gates (the spec review in the browser and approval on the pull request), so this page went up at the end as a record. Notes on the skill:

- **Worked as written:** sizing it, the spec, choosing a reviewer by what the change touches (security, because it is about what the server serves), test first, code review on the diff, and the full local gate.
- **Step 1 does not fit this repo.** `st-worktree` asks for a dev worktree with a server. Lahe has neither `scripts/worktree.sh` nor a dev server, so the worktree was a plain `git worktree add`.
- **Step 6, item 4 does not fit this repo.** It describes `code/.env.development.local` and a layout partial, which is how Steady Thread works. Lahe pages get the rail from `lahe review`.
- **`st-commit` disagrees with the global rules.** It says to write `.claude-commit`; the global CLAUDE.md says to add a timestamp to the name. The run followed the global rule.
- **Two gates disagree.** CLAUDE.md says to run `npm run gate` (Chromium) before a pull request. `st-ship` reads `.claude/guardrails.md`, which names `npm run gate:all` (three browsers). The run did both. `gate:all` found five failures that also fail on `origin/main`: two were already on the board, and three new WebKit ones went on as `LAHE-active-filter-webkit`.
- **`origin/main` moved during the run** (the pandoc render merged). `st-ship`'s merge step caught it. The pandoc path sends links through the same `classify`, so the fix holds there too: the real-site check, rerun with pandoc installed, still showed no dead links.
- **Not covered by the skill:** another session changing the same code mid-run. The fix was to rebase on its commit and ship both together. A line about checking `git log origin/main..main` in the main checkout before shipping would have caught it sooner.
