# Linked folder scope

**Status:** spec, waiting for review. Nothing is built. Board row `LAHE-linked-folder-scope` (serve only the files a site's pages link to, plus their images, then drop the folder cap).

## Needs your decision

- **A linked HTML page that loads files with a script gets 404 for them.** The server can see the files a page names in its HTML and CSS: stylesheets, images, scripts, fonts. It cannot see a file a script asks for while it runs, such as a dashboard fetching `data.json`. Those requests would answer 404. **Recommendation: accept that.** On your two runbook sites, the two linked HTML pages name no file in their folders at all, so nothing you use today breaks. A page that needs its whole folder can still be opened at its own address with `lahe review <page>`, which serves its folder the way it does now. The other choice is to serve a linked HTML page's whole folder tree. That brings back today's problem for that folder: an HTML file sitting in your home folder would expose all of home again.

## Problem, user, and context

A Markdown page Lahe renders can link to a file in another folder. To make that link work, Lahe mounts the target's folder on the page's site at `/.lahe-source/<hash>/`. Today a mount serves everything under that folder, subfolders included. So one link to `~/todo.md` mounts the home folder, and the page server then answers `~/.ssh/id_ed25519` with status 200. The premise check in [the link folder cap spec](../20261019.01_link_folder_cap/01_spec_link_folder_cap.md) proved this.

Other websites can't read these files: the cross-origin header and the missing CORS headers stop them. Local programs could read the files directly anyway. The gap is a script running on a reviewed page's own address. It can ask for any file under any mount.

The folder cap (`MOUNT_CAP`, now 64 per page) was meant to keep a page from quietly serving a whole tree. It never did: one mount is a whole tree. And the cap is what Ken kept hitting, because his skill repos (pstack, feature-forge) link into many folders.

Ken decided: a mounted folder serves only the files the site's pages link to, plus their images. Then the cap goes.

The user is Ken, reading his runbooks and skill docs as one connected set of pages. He follows a link, then a link on that page, and so on. That chain has to keep working.

### What a mount serves today

From the code on `origin/main`:

- **Every file in the folder tree.** `locate` turns `/.lahe-source/<prefix>/<rest>` into the mount's folder and the rest of the path, and checks only that the folder is under home (`src/service/page_routes.js:484-501`). `handle` then serves whatever file is there, after a real-path check that it stays inside the folder (`page_routes.js:2185-2199`). A folder address serves its `index.html` (`candidateOf`, `page_routes.js:504-510`). A test pins that a dotfile under a mount answers 200 (`test/unit/sites_pages.test.js:107-127`), and another pins that an HTML file no page linked to is served (`test/unit/sites_linked_docs.test.js:75-80`).
- **Markdown is rendered.** A `.md` file under a mount goes to `serveMarkdown` (`page_routes.js:2209-2210`). It gets the rail of the newest review that linked to it, or renders read-only (`pickReview`, rule 3, `page_routes.js:366`).
- **HTML is served as a page.** It goes to `serveHtmlPage` with `mounted` set (`page_routes.js:1917-1928`, `2212`).
- **Anything else is streamed as bytes.** Images, JSON, scripts, any type (`page_routes.js:2213`).
- **A page with its own review is sent to its own address.** A top-level load redirects; anything else gets the page read-only (`ownReviewOf` and `serveElsewhere`, `page_routes.js:1996-1999`, `2074-2084`, `2204-2208`).

### How the chain of links works today

When a mounted Markdown page renders, its own links are translated the same way the first page's were. `serveMarkdown` renders with the site's mounts plus the site root (`page_routes.js:1944-1950`). Each link goes through `classify` (`src/service/markdown_links.js:197-241`), which reuses a mount that already holds the target or makes a new one. New mounts are saved on the site (`page_routes.js:1955-1959`). When a review answers on the page, the linked pages are also recorded against that review in `linked_files` (`page_routes.js:1962`), which is how the next page gets the same rail. Pandoc output takes the same path: `finishPandoc` sends each link to the same `writeLink` (`src/service/markdown.js:548-551`).

Images and links that stay inside the page's own folder never go through `classify`. They keep their relative address and get the page's folder prefix in one pass over the finished HTML (`rewriteRelativeUrls`, `markdown.js:170-174`, called at `markdown.js:590`). So a linked page's image is served only because the mount serves the page's whole folder.

The test `test/unit/markdown_linked_docs.test.js:104-184` walks this chain three pages deep and fetches a non-Markdown file on the way.

### Measured on Ken's two runbook sites

Script: [scripts/measure_site.js](scripts/measure_site.js). It renders every Markdown page under the site's root the way the helper does, follows every address under a mount, renders each linked Markdown page in turn, reads each linked HTML page and its stylesheets, and writes one row per address. Counts come from that script and from [scripts/summarize.py](scripts/summarize.py), [scripts/html_detail.py](scripts/html_detail.py) and [scripts/log_growth.py](scripts/log_growth.py). The row files are in `~/Documents/lahe-linked-folder-scope/` (outside the repo, since they name real files).

| What | `feature-forge-runbooks` (repo root) | `docs/features/runbooks` |
|---|---|---|
| Markdown pages under the site root | 293 | 219 |
| Folders the site mounts in `sites.json` | 16 | 28 |
| Links past the cap today | 0 | 0 |
| Pages that link into a mount | 104 | 99 |
| Distinct files those pages link to or show under mounts | 313 | 459 |
| Most such files linked from one page | 85 | 171 |
| Images shown inline (`src`) under a mount | 0 | 12 addresses (6 distinct images, each reached through two mounts) |
| Linked HTML pages under a mount | 1 | 2 |
| Files those HTML pages name under a mount | 0 | 0 |
| Links under a mount that already fail today (a folder with no `index.html`, or a missing file) | 5 | 23 |
| Files in the mounted folders the links use (nested mounts counted twice) | 405 | 963 |
| Size of the list as one flat list of real paths | 36,805 bytes | 60,168 bytes |
| Size if the list were kept per linking page | 97,960 bytes | 141,436 bytes |

The last two rows set the storage choice under Approach. On these two sites the mounts are mostly made of linked files already. The large win is the case the premise check found: a mount of home, or of any big folder, where one linked file exposed everything else.

## Requirements

1. **A mount serves only listed files.** A file under a mount is served only when a page on the same site links to it or shows it. Any other file under a mount answers 404, even though its folder is mounted.
2. **What counts as linking.** Every address a rendered page carries in an `href`, `src` or `srcset` attribute that lands under one of the site's mounts. That covers translated links, a linked page's relative links and images, and raw HTML inside Markdown, from both marked and pandoc.
3. **The chain keeps working.** When a linked Markdown page renders, its own links and images are listed before the response is sent. So the next page in the chain, and its pictures, are served.
4. **A linked HTML page brings what it names.** When an HTML page under a mount is served, the files it names in `href`, `src`, `srcset` and CSS `url()` are listed. That includes `url()` inside stylesheets it links on the same mount.
5. **Pages a review linked keep working with no migration.** A file in the site's `linked_files` table is served. So existing sites, the Library's Open, and stored comments on linked pages keep working the moment the new code runs.
6. **The list is kept on the site and survives a restart.** It lives in the site's entry in `sites.json`, beside `mounts`. Mount addresses (`/.lahe-source/<hash>/`) do not change.
7. **The list only grows.** A link removed from a page leaves its file on the list, the same way a mount stays.
8. **The folder cap goes.** `MOUNT_CAP`, the `cap` reason for a plain-text link, and the `lahe review` line about links past the cap are removed. A notes page, which follows no links today, still follows none.
9. **Reviews do not change.** Which review answers on a mounted page, the redirect to a file's own address, and the read-only "has its own review" page work as now. The helpers that map an address back to a file (`fileForPage`, `linkedFileForPage`, the Library) do not read the list.
10. **A refused file leaves a trace.** A 404 because a file is not on the list writes one helper-log line naming the file and the site, once per file.
11. **Docs say the new rule.** `docs/ongoing/STATIC_SITE_FOLDER.md` ("Linked documents"), the link-translation paragraph in `docs/CONTRACTS.md` (it still says 16 folders), `docs/INSTALL.md`, and the board row.
12. **Ken's real sites lose nothing.** On `feature-forge-runbooks` and `docs/features/runbooks`, no link turns into plain text, and no linked page or image that answers 200 today answers 404 after the change.

## Approach

### Where the check runs

The check sits in `handle`, after the real path is known and before the own-review redirect: a mounted request whose real file is not on the list gets 404 (requirement 1, a mount serves only listed files). It does not go in `locate`. `locate` also backs the helpers that map a stored comment's address back to its file (`fileForPageIn`, `page_routes.js:592-612`, and `linkedFileIn`, `page_routes.js:622-640`). Those must keep working for old comments even when a file is not on the list yet (requirement 9, reviews do not change).

The check is on the real path, after the existing real-path checks. So a symlink inside a mount that points elsewhere is still refused as before, and a file reached through two different mounts needs one entry.

### How the list is filled: read the finished page

After a page renders, one function reads its finished HTML and lists every address under a mount. It lives in `page_routes.js` beside `locate`, as `filesUnderMounts(html, urlDir, mounts)`. For each `href`, `src` and `srcset` value, it decodes HTML entities and resolves the value against the page's own address, as the browser will. It keeps paths under `/.lahe-source/`. Each one then takes the same steps a request takes: `decodePath`, `locate`, `candidateOf`, real path, inside the mount's folder, and is a file. It collects the real paths.

Why read the finished page rather than hook `classify`: images and links inside the page's own folder never pass through `classify` (they are prefixed in one pass at `markdown.js:590`). Raw HTML in Markdown doesn't either. The finished HTML is exactly what the browser will ask for, from both engines, including the reuse addresses `createRegistry.add` builds (`markdown_links.js:112-138`). The attribute pattern is the same one `rewriteRelativeUrls` uses, so what gets prefixed is what gets listed.

Who calls it:

- `renderMarkdown` returns the list as `files`, next to `added` and `linked`, and the render cache keeps it with them (`page_routes.js:1394-1418`).
- `serveMarkdown` saves it on the site right after it saves new mounts (`page_routes.js:1955-1959`). That runs for every Markdown page, with a rail or read-only, including the "has its own review" page, and before the response goes out (requirement 3, the chain keeps working).
- `renderSitePage` does the same for rebuild and the handled check (`page_routes.js:1431-1445`).
- `serveHtmlPage` and `serveElsewhere`, for an HTML page under a mount, run the same function over the HTML. They also read `url()` in stylesheets the page links on the same mount, one level deep (requirement 4, a linked HTML page brings what it names).

### Where the list lives

A new field on the site entry: `mount_files`, an array of real paths. `sites.js` cleans it on load (absolute path strings only, no repeats), and a new `addMountFiles(name, files)` merges and records once per call, the way `addMounts` does (`sites.js:470-478`). A file is allowed when it is in `mount_files` or is a key of `linked_files`.

- **No migration step.** Old entries have no `mount_files`. Pages a review linked are already in `linked_files` (requirement 5). Everything else is listed the next time the page that links it renders. A link is clickable only on a rendered page, so the only gap is a tab the old helper rendered: a link in it to a non-page file, or a link from a page with no review, answers 404 until the tab is reloaded.
- **Downgrade is safe.** An older helper keeps the unknown field (`isEntry` checks only `root` and `mode`, `sites.js:249-252`) and serves mounts as before.
- **Addresses stay put.** Mount prefixes and `mounts` in `sites.json` are untouched, so open pages and stored comments keep their addresses (requirement 6).

Why in `sites.json` rather than memory: the helper restarts on every Lahe update. In memory, every image and data file in open tabs would 404 after a restart until each linking page re-rendered.

Why one flat list rather than a list per linking page. A list per page would let a removed link stop serving its file. But every change to a site appends the whole site entry to `sites.log` (`record`, `sites.js:353-358`), and no code shortens that log. Measured on a full walk of each site: the per-page list is 98 to 141 KB, and each of the 104 or 99 linking pages would rewrite it. The flat list is 37 to 60 KB, and only 28 or 29 renders add to it. The flat list's upper bound on log growth for a full walk is 1,041,271 bytes for `feature-forge-runbooks` and 1,922,366 bytes for `docs/features/runbooks` ([scripts/log_growth.py](scripts/log_growth.py)). The flat list never forgets, the same as mounts (requirement 7, the list only grows).

Why not keep the list in a separate file outside the log: it would avoid the log growth, but it adds a second store with its own load and loss rules. `replayLog` also overwrites a site's entry from the log whenever the two differ (`sites.js:331-342`), so a field written to `sites.json` alone would be lost on the next load. One writer and one store is simpler.

### The cap goes

With a mount serving only listed files, the number of mounts no longer changes what is exposed. The cap is removed (requirement 8). What bounds growth now is the links on disk: the list holds the files pages actually name. The most any real page names is 171 files (table above).

One thing still uses the cap: a notes page renders with `cap: 0` so it follows no links (`page_routes.js:1408`). That becomes an explicit `follow: false` option on `createRegistry`, and `classify` returns the link as plain text with reason `no-follow`. Also removed: `linkMountsSkipped` in `writeArtifact` (`markdown.js:695`) and its line in `lahe review` (`src/cli/commands/review.js:428-431`).

### Reviews on a mounted page

Nothing changes in how reviews answer (requirement 9). The list check happens first: a file that is not listed gets 404 before `ownReviewOf` is asked. A listed file follows today's path. `pickReview` with `mounted` still applies only rule 3, the newest review that linked to this file (`page_routes.js:335`, `357`, `362`, `366`). The list and `linked_files` stay separate on purpose. `linked_files` is written only when a review answered on the linking page (`page_routes.js:1962`), and it decides which rail a page carries and which origins a review accepts (`reviewAnswersOnSite`, `page_routes.js:449-452`). The list is written on every render and decides only what is served. Folding them together would let a read-only render change which review answers.

### Alternatives considered

- **Serve a linked HTML page's whole folder tree.** Rejected: it brings back the whole-tree problem for any HTML file's folder, home included. See "Needs your decision".
- **Refuse everything a linked HTML page names.** Rejected: a linked HTML page with its own stylesheet would show unstyled. It would not break Ken's two sites today (their linked HTML pages name nothing), but it would break the next built page with images beside it.
- **Check the Referer header** (serve a file when the page in the Referer links to it). Rejected: the Library and bookmarks send no page Referer, and `fetch()` lets a page script name any same-origin Referer. A stored list is simpler and covers both.
- **Refuse known secret folders** (`~/.ssh`, `~/.aws`, `~/.gnupg`) and keep whole-tree mounts. Rejected as the fix: it closes three folders and leaves the rest of home open. It is under Open questions as an extra guard.
- **Keep the cap as a guard on list size.** Rejected: the cap counted folders, not files, and Ken's pages name up to 171 files. A number low enough to matter would turn real links into plain text again.

## Tasks

The rule for this change: no `rm`, no `git clean`. Anything to remove goes on a "To delete at cleanup" list.

1. **Tests first, red.** Write the tests in the table below before any code. The new unit tests go in `test/unit/mount_files.test.js`, apart from the chain test, which extends the existing hop-to-hop test.
2. **List the files the hand-built tests reach.** Tests that bind a site with hand-made `mounts` and then fetch a file directly must list that file with `addMountFiles` first: `sites_pages.test.js` (V14), `hidden_files_served.test.js` (two tests), `page_routes_carried.test.js` (two tests), `sites_styles.test.js`. One test changes its expectation on purpose: `sites_linked_docs.test.js` "an HTML file in a mounted folder that no page linked to is served with no rail" becomes a 404 test. The two cap tests in `sites_pages.test.js` and the cap tests in `markdown_links.test.js` and `markdown_linked_docs.test.js` become the "no cap" test and the notes-page test.
3. **Build.** In this order: `filesUnderMounts` in `page_routes.js`; `mount_files`, its cleaning and `addMountFiles` in `sites.js`; `renderMarkdown` returns `files`; the callers save them; the HTML path; the check and its log line in `handle`; the cap removed and `follow: false` added in `markdown_links.js`; `writeArtifact` and `lahe review` stop reporting the cap.
4. **Docs.** `docs/ongoing/STATIC_SITE_FOLDER.md` "Linked documents", `docs/CONTRACTS.md` (the link-translation paragraph), `docs/INSTALL.md`, and the board row.
5. **Real-site check.** Copy Ken's `sites.json` into a temp state folder, with every pid in it set to one that is not running. Start a helper from the branch on that folder and free ports. Crawl both runbook sites over HTTP: every Markdown page under the root, then every address under a mount, page after page. Do the same from `main`. Write one row per address with both status codes, and fail on any address that answers 200 on `main` and 404 on the branch. Stop both helpers afterwards by the pids in their own state folders. Never touch the real helper (port 7817, `~/.local/state/lahe`). Keep the crawl script under `scripts/` beside this spec.
6. **Gate and review.** `npm run gate:unit` while building, then `npm run gate` on the integrated branch. The change is about what the page server hands out, so a security review reads the diff.

| # | Behavior | Proof test | What failure looks like |
|---|---|---|---|
| V1 | `filesUnderMounts` lists a translated link, a relative link inside a linked page, an inline image, a `srcset` entry, raw HTML `<img>`, and a folder link as its `index.html` | `mount_files.test.js`, one case per kind | a linked page renders but its image or next link answers 404 |
| V2 | `filesUnderMounts` lists nothing for an outside URL, Lahe's own files (fonts, doc style, mermaid), a `..` or symlink that leaves the mount, a missing file, or a prefix the site does not mount | `mount_files.test.js` | a file outside the linked set gets listed and served |
| V3 | One link to `~/todo.md` serves `todo.md`; `~/.ssh/id_ed25519` and `~/Documents/taxes/2025.txt` under the same home mount answer 404 | `mount_files.test.js`, the premise probe turned into a test | the hole the premise check found is still open |
| V4 | The chain: hub, then a page in another folder, then a third page, each 200 with the hub's rail; hop one's inline image 200; a file in hop one's folder that nothing links answers 404 | extend `markdown_linked_docs.test.js` "local links serve rendered documents with its rail, hop to hop" | Ken's runbook navigation breaks partway, or a whole folder is still served |
| V5 | A linked HTML page's stylesheet, its image, a `url()` inside the stylesheet, and its script all answer 200; a sibling file it does not name answers 404 | `mount_files.test.js` | linked HTML pages show unstyled, or their folder is served whole |
| V6 | A site entry with `linked_files` and no `mount_files` (an old `sites.json`) serves its linked pages with no render first | `mount_files.test.js` | existing sites and the Library's Open break after the upgrade |
| V7 | A listed image is served by a new helper started on the same state folder, with no re-render | `mount_files.test.js` | images in open tabs break after each Lahe update |
| V8 | `mount_files` is cleaned on load, merges without repeats, and is rebuilt from `sites.log` when `sites.json` is lost | `sites_binding.test.js` or `mount_files.test.js` | a bad entry is served, or the list is lost on a rebuild |
| V9 | A page linking 70 files in 70 folders renders 70 working links; a notes page still follows none | `sites_pages.test.js` (replaces the two cap tests) | the cap is still there, or notes pages start following links |
| V10 | A refused file writes one helper-log line naming it and the site, once | `mount_files.test.js` | dead links with no trace, or one log line per request |
| V11 | Reviews on mounted pages behave as before: rule 3, the redirect, the read-only own-review page, comments through a link | existing `sites_linked_docs.test.js`, `each_page_comments.test.js`, `test/browser/linked_docs_rail.spec.js`, unchanged except the one flipped test in task 2 | comments land in the wrong review, or a linked page loses its rail |
| V12 | On both runbook sites, no link is plain text and no address that answers 200 on `main` answers 404 on the branch | the real-site crawl in task 5, its row file and a zero count | a link or image Ken uses goes dead |
| V13 | Nothing else moves | `npm run gate`, 0 failed | anything else |

## Acceptance criteria

- V1 to V11 pass, and `npm run gate` reads 0 failed (V13).
- The real-site crawl (V12) reports zero addresses that answer 200 on `main` and 404 on the branch, and zero links rendered as plain text, on both runbook sites. Its row file and script are named on the progress page.
- The security review of the diff finds no way to reach an unlisted file under a mount.
- The four docs in requirement 11 say the new rule, and none still mentions the cap.
- No analytics: Lahe has none. No flag: the old behavior is one check in `handle`, and the decision was to remove it.

## Open questions

- **Refuse secret folders even when a page names a file in them?** With this change, a file in `~/.ssh` is served only if a page on the site links to it by name. A small block list (`~/.ssh`, `~/.aws`, `~/.gnupg`) would also refuse that. It costs Ken nothing he uses. Not in this change; it could be its own small row.
- **Should the list ever forget?** It only grows, like mounts. If `sites.log` size becomes a problem, a later change could keep the list per linking page or compact the log.
- **Files a linked HTML page's script loads.** See "Needs your decision". If Ken accepts the 404, the helper-log line (requirement 10) is how a broken page gets noticed.
