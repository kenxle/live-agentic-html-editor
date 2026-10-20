# Linked folder scope

**Status:** shipped in [PR #89](https://github.com/kenxle/live-agentic-html-editor/pull/89). Your helper runs it now. Results are under "Verification results" below. Board row `LAHE-linked-folder-scope` (serve only the files a site's pages link to, plus their images, then drop the folder cap).

## Decided

- **A linked HTML page that loads files with a script gets 404 for them.** The server can see the files a page names in its HTML and CSS: stylesheets, images, scripts, fonts. It cannot see a file a script asks for while it runs, such as a dashboard fetching `data.json`. Those requests would answer 404. **Decided: accept that.** On your two runbook sites, the two linked HTML pages name no file in their folders at all, so nothing you use today breaks. A page that needs its whole folder can still be opened at its own address with `lahe review <page>`. That serves its folder the way it does now, except the secret folders listed under requirement 13, which this change refuses everywhere. The other choice is to serve a linked HTML page's whole folder tree. That brings back today's problem for that folder: an HTML file sitting in your home folder would expose all of home again.

## Problem, user, and context

A Markdown page Lahe renders can link to a file in another folder. To make that link work, Lahe mounts the target's folder on the page's site at `/.lahe-source/<hash>/`. Today a mount serves everything under that folder, subfolders included. So one link to `~/todo.md` mounts the home folder, and the page server then answers `~/.ssh/id_ed25519` with status 200. The premise check in [the link folder cap spec](../20261019.01_link_folder_cap/01_spec_link_folder_cap.md) proved this.

Other websites can't read these files: the cross-origin header and the missing CORS headers stop them. Local programs could read the files directly anyway. The gap is a script running on a reviewed page's own address. It can ask for any file under any mount.

A site's own root has the same shape. `lahe review ~/todo.md` makes a site rooted at the file's folder (`planSite`, `src/cli/commands/review.js:486`), here the home folder. `rootProblem` refuses only the filesystem root and the state folder (`src/service/sites.js:122-134`), so that site serves all of home, `~/.ssh` included. None of Ken's 83 sites is rooted at home today, and none mounts home, but nothing stops it.

The folder cap (`MOUNT_CAP`, now 64 per page) was meant to keep a page from quietly serving a whole tree. It never did: one mount is a whole tree. And the cap is what Ken kept hitting, because his skill repos (pstack, feature-forge) link into many folders.

Ken decided: a mounted folder serves only the files the site's pages link to, plus their images. Then the cap goes.

**What the list protects against, and what it does not.** The list stops a script from reading files that no page names. It does not stop a hostile document. A cloned repo's README can link `../../.ssh/id_ed25519` and carry its own `<script>`: the Markdown renderer passes raw HTML through (no `renderer.html` override in `src/service/markdown.js`), and served pages carry no script policy, only `frame-ancestors 'self'` (`src/service/page_routes.js:1815-1829`). That document writes the list itself. So this change also refuses a short list of secret paths everywhere (requirement 13), which covers the worst files for that case. Whether rendered Markdown should run raw HTML and scripts at all is board row `LAHE-markdown-raw-html`.

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

### Two spellings of one file

`classify` takes real paths with plain `fs.realpathSync` (`markdown_links.js:181`, `183`, `219`). `handle` takes them with `fs.realpathSync.native` (`realOrNull`, `page_routes.js:67-71`). On a case-insensitive disk these differ. Checked on this Mac: a file `todo.md` reached as `Todo.md` comes back as `Todo.md` from the plain call and `todo.md` from `.native`. `linked_files` keys come from `classify`, so they carry the link's spelling, while `handle` asks with the disk's spelling. A list built the same way would refuse a file whose link is spelled differently from the disk.

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
| Links that point into a path on the secret list | 0 | 0 |
| Links under a mount that already fail today (a folder with no `index.html`, or a missing file) | 5 | 23 |
| Files in the mounted folders the links use (nested mounts counted twice) | 405 | 963 |
| Size of the list as one flat list of real paths | 36,805 bytes | 60,168 bytes |
| Size if the list were kept per linking page | 97,960 bytes | 141,436 bytes |

The secret-list row comes from a search of the row files for the paths in requirement 13. On these two sites the mounts are mostly made of linked files already. The large win is the case the premise check found: a mount of home, or of any big folder, where one linked file exposed everything else.

## Requirements

1. **A mount serves only listed files.** A file under a mount is served only when a page on the same site links to it or shows it. Any other file under a mount answers 404, even though its folder is mounted.
2. **What counts as linking.** Every address a rendered page carries in an `href`, `src` or `srcset` attribute that lands under one of the site's mounts. That covers translated links, a linked page's relative links and images, and raw HTML inside Markdown, from both marked and pandoc.
3. **The chain keeps working.** When a linked Markdown page renders, its own links and images are listed before the response is sent. So the next page in the chain, and its pictures, are served.
4. **A linked HTML page brings what it names, from its own folder only.** When an HTML page under a mount is served, the files it names in `href`, `src`, `srcset` and CSS `url()` are listed, including `url()` inside stylesheets it links. Only files under the page's own mount prefix and inside the page's own folder count. A name that points at another mount, or above the page's folder, is not listed.
5. **Pages a review linked keep working with no migration.** A file in the site's `linked_files` table is served. So existing sites, the Library's Open, and stored comments on linked pages keep working the moment the new code runs.
6. **The list is kept on the site and survives a restart.** It lives in the site's entry in `sites.json`, beside `mounts`. Mount addresses (`/.lahe-source/<hash>/`) do not change.
7. **The list only grows, until it is rebuilt.** A link removed from a page leaves its file on the list, the same way a mount stays. Rebuilding a site's list from a fresh walk of its pages is a separate board row (task 7).
8. **The folder cap goes.** `MOUNT_CAP`, the `cap` reason for a plain-text link, and the `lahe review` line about links past the cap are removed. A file limit per page replaces it (requirement 14). A notes page, which follows no links today, still follows none.
9. **Reviews do not change.** Which review answers on a mounted page, the redirect to a file's own address, and the read-only "has its own review" page work as now. The helpers that map an address back to a file (`fileForPage`, `linkedFileForPage`, the Library) do not read the list.
10. **A refused file leaves a trace.** A 404 because a file is not on the list, or is on the secret list, writes one helper-log line naming the file and the site, once per file.
11. **Docs say the new rule.** `docs/ongoing/STATIC_SITE_FOLDER.md` ("Linked documents"), the link-translation paragraph in `docs/CONTRACTS.md` (it still says 16 folders), `docs/INSTALL.md`, and the board row.
12. **Ken's real sites lose nothing.** On `feature-forge-runbooks` and `docs/features/runbooks`, no link turns into plain text, and no linked page or image that answers 200 today answers 404 after the change.
13. **Secret paths are refused everywhere.** These paths under home, and everything inside them, are never listed and never served, from a mount or from a site's own root: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.config/gcloud`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.kube`, `~/.docker`, `~/Library/Keychains`. A link to one renders as plain text naming the file, like any link Lahe cannot serve. A request for one answers 404.
14. **One page may name at most 256 files under mounts.** The limit counts every distinct file a render names under a mount, listed already or not, so a page past it stays past it on every reload. Links past it render as plain text with a title saying the page links too many files, and the helper log gets one line naming the page.
15. **The log carries only new paths.** `sites.log` gets a short line holding only the paths a render added, never the whole list. The whole list lives in `sites.json`.
16. **One spelling for every path.** Every real path the list stores or compares is taken with `fs.realpathSync.native`, the call `handle` already uses. `linked_files` keys are compared after the same call, so a key written in a link's spelling still matches.

## Approach

### Where the check runs

The check sits in `handle`, after the real path is known and before the own-review redirect. Two tests run there, in this order:

1. Any request, from a mount or the site's own root, whose real path is on the secret list gets 404 (requirement 13, secret paths are refused everywhere).
2. A mounted request whose real file is not on the list gets 404 (requirement 1, a mount serves only listed files).

The check does not go in `locate`. `locate` also backs the helpers that map a stored comment's address back to its file (`fileForPageIn`, `page_routes.js:592-612`, and `linkedFileIn`, `page_routes.js:622-640`). Those must keep working for old comments even when a file is not on the list yet (requirement 9, reviews do not change).

Both tests use the real path, after the existing real-path checks. So a symlink inside a mount that points elsewhere is still refused as before, a symlink that points into `~/.ssh` is refused by the secret test, and a file reached through two different mounts needs one entry.

### The secret list

One function, `isSecretPath(real)`, sits in `markdown_links.js` beside `mountableDir`, the module that already owns the home boundary. It resolves each listed path against the home root with `.native` and answers whether `real` is that path or inside it. Three places call it:

- `classify`, so a link to a secret file renders as plain text and never makes a mount;
- the listing function, so nothing secret is ever listed, whatever a page names;
- `handle`, for every request, which is what covers a site rooted at home.

The list is short on purpose. It names the files whose theft does the most harm: SSH, GPG and cloud keys, git and package-registry tokens, container and Kubernetes credentials, and the macOS keychains. Six of them exist on Ken's machine today: `.ssh`, `.config/gh`, `.config/gcloud`, `.npmrc`, `.docker` and `Library/Keychains`. None of his runbook links point into any of them (table above). A site's own root still serves the rest of its tree: the list is a floor under every site, not a scope for root sites.

### How the list is filled: read the finished page

After a page renders, one function reads its finished HTML and lists every address under a mount. It lives in `page_routes.js` beside `locate`, as `filesUnderMounts(html, urlDir, mounts)`. For each `href`, `src` and `srcset` value, it decodes HTML entities and resolves the value against the page's own address, as the browser will. It keeps paths under `/.lahe-source/`. Each one then takes the same steps a request takes: `decodePath`, `locate`, `candidateOf`, real path with `.native`, inside the mount's folder, is a file, and not on the secret list. It collects the real paths.

Why read the finished page rather than hook `classify`: images and links inside the page's own folder never pass through `classify` (they are prefixed in one pass at `markdown.js:590`). Raw HTML in Markdown doesn't either. The finished HTML is exactly what the browser will ask for, from both engines, including the reuse addresses `createRegistry.add` builds (`markdown_links.js:112-138`). The attribute pattern is the same one `rewriteRelativeUrls` uses, so what gets prefixed is what gets listed.

Who calls it:

- `renderMarkdown` returns the list as `files`, next to `added` and `linked`, and the render cache keeps it with them (`page_routes.js:1394-1418`).
- `serveMarkdown` saves it on the site right after it saves new mounts (`page_routes.js:1955-1959`). That runs for every Markdown page, with a rail or read-only, including the "has its own review" page, and before the response goes out (requirement 3, the chain keeps working).
- `renderSitePage` does the same for rebuild and the handled check (`page_routes.js:1431-1445`).
- `serveHtmlPage` and `serveElsewhere`, for an HTML page under a mount, run the same function over the HTML with one more limit: only files under the page's own mount prefix and inside the page's own folder are kept. They also read `url()` in stylesheets the page links in that folder, one level deep (requirement 4). Without that limit, a linked HTML file could name files under any other mount on the site and get them listed.

### One spelling for every path

`classify` and `noteRelative` switch from `fs.realpathSync` to `fs.realpathSync.native` (`markdown_links.js:181`, `183`, `219`), and so does `homeRoot` (`markdown_links.js:52`). Then new `linked_files` keys, `mount_files` entries and the request's real path all carry the disk's spelling (requirement 16, one spelling for every path). Old `linked_files` keys may carry a link's spelling, so the check passes each key through `.native` once and keeps the result per site, rebuilt when the entry changes. One side effect: `pickReview` rule 3 looks up `linked_files` by the request's `.native` path (`page_routes.js:323-325`), so a page linked in a different case from the disk starts getting its linking review's rail for new links. That is the rule working as written, not a change to it.

### Where the list lives

A new field on the site entry: `mount_files`, an array of real paths. `sites.js` cleans it on load (absolute path strings only, no repeats), and a new `addMountFiles(name, files)` merges it. A file is allowed when it is in `mount_files` or is a key of `linked_files` after `.native`.

How it reaches the log (requirement 15, the log carries only new paths). Today every change appends the whole site entry to `sites.log` (`record`, `sites.js:353-358`), and no code shortens that log. A list of hundreds of paths in every such line would grow the log fast. So:

- `addMountFiles` appends a short line, `{event: "mount-files", name, add: [the new paths]}`, then writes `sites.json` whole.
- Whole-entry lines leave `mount_files` out.
- Reading the log rebuilds a site's list by joining every `mount-files` line for that name. `replayLog` compares entries with `mount_files` set aside, then joins the lists (`sites.js:331-342`).
- An older helper skips the new lines, since `readLog` keeps only lines whose `site` is a full entry (`sites.js:279`).

Other properties:

- **No migration step.** Old entries have no `mount_files`. Pages a review linked are already in `linked_files` (requirement 5). Everything else is listed the next time the page that links it renders. A link is clickable only on a rendered page, so the only gap is a tab the old helper rendered: a link in it to a non-page file, or a link from a page with no review, answers 404 until the tab is reloaded.
- **Downgrade is safe.** An older helper keeps the unknown field (`isEntry` checks only `root` and `mode`, `sites.js:249-252`) and serves mounts as before.
- **Addresses stay put.** Mount prefixes and `mounts` in `sites.json` are untouched, so open pages and stored comments keep their addresses (requirement 6).

Why in `sites.json` rather than memory: the helper restarts on every Lahe update. In memory, every image and data file in open tabs would 404 after a restart until each linking page re-rendered.

Why one flat list rather than a list per linking page. A list per page would let a removed link stop serving its file. Measured on a full walk of each site: the per-page list is 98 to 141 KB, and each of the 104 or 99 linking pages would rewrite part of it. The flat list is 37 to 60 KB, and only 28 or 29 renders add to it. With the short log lines, the log grows by the new paths only: at most the flat list's size per site on a full walk. Forgetting is handled by a rebuild instead (requirement 7).

### The folder cap goes; a file limit replaces it

With a mount serving only listed files, the number of mounts no longer changes what is exposed. The folder cap is removed (requirement 8).

What still needs a bound is the list itself. A generated page with thousands of links would add thousands of paths in one render. So one render may name at most 256 files under mounts (requirement 14). The most any real page names is 171 (table above), so 256 leaves half again as much room. The limit is counted in the render registry, so links past it render as plain text at render time, with the title `this page links more than 256 files; open it on disk: <path>`. It counts every file the page names, already listed or not. The cap's own code review found why: counting only new entries lets a page creep past the limit a little more on each reload. Images, which never pass through `classify`, count toward the same limit in `filesUnderMounts`. An image past it is not listed and shows broken; the same log line names the page.

One thing still uses the old cap: a notes page renders with `cap: 0` so it follows no links (`page_routes.js:1408`). That becomes an explicit `follow: false` option on `createRegistry`, and `classify` returns the link as plain text with reason `no-follow`. Also removed: `linkMountsSkipped` in `writeArtifact` (`markdown.js:695`) and its line in `lahe review` (`src/cli/commands/review.js:428-431`). `lahe review` prints the file-limit count instead, when a page passes it.

### Rebuilding a site's list

A list that only grows keeps serving a file after its link is removed. Rebuilding it means walking every page of the site and every page it links, as `scripts/measure_site.js` does, then replacing `mount_files` with what the walk found. That needs a trigger (a command or a helper route with the CLI secret), a full render of the site, and its own tests. It is more than a small task, so it is a separate board row, `LAHE-linked-files-rebuild` (task 7). Meanwhile the secret list (requirement 13) covers the worst case: a stale entry can never be a key or credential file.

### Reviews on a mounted page

Nothing changes in how reviews answer (requirement 9). The list check happens first: a file that is not listed gets 404 before `ownReviewOf` is asked. A listed file follows today's path. `pickReview` with `mounted` still applies only rule 3, the newest review that linked to this file (`page_routes.js:335`, `357`, `362`, `366`). The list and `linked_files` stay separate on purpose. `linked_files` is written only when a review answered on the linking page (`page_routes.js:1962`), and it decides which rail a page carries and which origins a review accepts (`reviewAnswersOnSite`, `page_routes.js:449-452`). The list is written on every render and decides only what is served. Folding them together would let a read-only render change which review answers.

### Alternatives considered

- **Serve a linked HTML page's whole folder tree.** Rejected: it brings back the whole-tree problem for any HTML file's folder, home included. See "Needs your decision".
- **Refuse everything a linked HTML page names.** Rejected: a linked HTML page with its own stylesheet would show unstyled. It would not break Ken's two sites today (their linked HTML pages name nothing), but it would break the next built page with images beside it.
- **Check the Referer header** (serve a file when the page in the Referer links to it). Rejected: the Library and bookmarks send no page Referer, and `fetch()` lets a page script name any same-origin Referer. A stored list is simpler and covers both.
- **Refuse known secret folders and keep whole-tree mounts.** Rejected as the whole fix: it closes a few folders and leaves the rest of home open. Kept as a floor under the list (requirement 13), because the list alone does not stop a hostile document.
- **Keep the folder cap.** Rejected: it counted folders, not files, and Ken's pages link into up to 34 folders. A file limit bounds the list directly.
- **Keep the list in a separate file outside the log.** Rejected: it adds a second store with its own load and loss rules, and `replayLog` would overwrite a field written to `sites.json` alone. Short log lines give the same saving inside the one store.

## Tasks

The rule for this change: no `rm`, no `git clean`. Anything to remove goes on a "To delete at cleanup" list.

1. **Tests first, red.** Write the tests in the table below before any code. The new unit tests go in `test/unit/mount_files.test.js`, apart from the chain test, which extends the existing hop-to-hop test.
2. **List the files the hand-built tests reach.** Tests that bind a site with hand-made `mounts` and then fetch a file directly must list that file with `addMountFiles` first: `sites_pages.test.js` (V14), `hidden_files_served.test.js` (two tests), `page_routes_carried.test.js` (two tests), `sites_styles.test.js`. One test changes its expectation on purpose: `sites_linked_docs.test.js` "an HTML file in a mounted folder that no page linked to is served with no rail" becomes a 404 test. The two cap tests in `sites_pages.test.js` and the cap tests in `markdown_links.test.js` and `markdown_linked_docs.test.js` become the file-limit test and the notes-page test.
3. **Build.** In this order: `isSecretPath` and the `.native` switch in `markdown_links.js`; `filesUnderMounts` in `page_routes.js`; `mount_files`, its cleaning, `addMountFiles` and the short log lines in `sites.js`; `renderMarkdown` returns `files`; the callers save them; the HTML path with its own-folder limit; the two checks and the log line in `handle`; the folder cap removed, the file limit and `follow: false` added in `markdown_links.js`; `writeArtifact` and `lahe review` report the file limit instead of the cap.
4. **Docs.** `docs/ongoing/STATIC_SITE_FOLDER.md` "Linked documents", `docs/CONTRACTS.md` (the link-translation paragraph), `docs/INSTALL.md`, and the board row. Each names the secret list and the file limit.
5. **Real-site check.** Copy Ken's `sites.json` into a temp state folder, with every pid in it set to one that is not running. Start a helper from the branch on that folder and free ports. Crawl both runbook sites over HTTP: every Markdown page under the root, then every address under a mount, page after page. Do the same from `main`. Write one row per address with both status codes, and fail on any address that answers 200 on `main` and 404 on the branch. Stop both helpers afterwards by the pids in their own state folders. Never touch the real helper (port 7817, `~/.local/state/lahe`). Keep the crawl script under `scripts/` beside this spec.
6. **Gate and review.** `npm run gate:unit` while building, then `npm run gate` on the integrated branch. The change is about what the page server hands out, so a security review reads the diff.
7. **Add board row `LAHE-linked-files-rebuild`.** Rebuild a site's `mount_files` from a fresh walk of its pages, so a removed link stops serving its file. Not part of this change.

| # | Behavior | Proof test | What failure looks like |
|---|---|---|---|
| V1 | `filesUnderMounts` lists a translated link, a relative link inside a linked page, an inline image, a `srcset` entry, raw HTML `<img>`, and a folder link as its `index.html` | `mount_files.test.js`, one case per kind | a linked page renders but its image or next link answers 404 |
| V2 | `filesUnderMounts` lists nothing for an outside URL, Lahe's own files (fonts, doc style, mermaid), a `..` or symlink that leaves the mount, a missing file, or a prefix the site does not mount | `mount_files.test.js` | a file outside the linked set gets listed and served |
| V3 | One link to `~/todo.md` serves `todo.md`; `~/.ssh/id_ed25519` and `~/Documents/taxes/2025.txt` under the same home mount answer 404 | `mount_files.test.js`, the premise probe turned into a test | the hole the premise check found is still open |
| V4 | The chain: hub, then a page in another folder, then a third page, each 200 with the hub's rail; hop one's inline image 200; a file in hop one's folder that nothing links answers 404 | extend `markdown_linked_docs.test.js` "local links serve rendered documents with its rail, hop to hop" | Ken's runbook navigation breaks partway, or a whole folder is still served |
| V5 | A linked HTML page's stylesheet, its image, a `url()` inside the stylesheet, and its script all answer 200; a sibling file it does not name answers 404 | `mount_files.test.js` | linked HTML pages show unstyled, or their folder is served whole |
| V6 | A site entry with `linked_files` and no `mount_files` (an old `sites.json`) serves its linked pages with no render first | `mount_files.test.js` | existing sites and the Library's Open break after the upgrade |
| V7 | A listed image is served by a new helper started on the same state folder, with no re-render | `mount_files.test.js` | images in open tabs break after each Lahe update |
| V8 | `mount_files` is cleaned on load, merges without repeats, and is rebuilt from the `mount-files` log lines when `sites.json` is lost | `sites_binding.test.js` or `mount_files.test.js` | a bad entry is served, or the list is lost on a rebuild |
| V9 | A notes page still follows no links | `sites_pages.test.js` (replaces a cap test) | notes pages start following links |
| V10 | A refused file writes one helper-log line naming it and the site, once | `mount_files.test.js` | dead links with no trace, or one log line per request |
| V11 | Reviews on mounted pages behave as before: rule 3, the redirect, the read-only own-review page, comments through a link | existing `sites_linked_docs.test.js`, `each_page_comments.test.js`, `test/browser/linked_docs_rail.spec.js`, unchanged except the one flipped test in task 2 | comments land in the wrong review, or a linked page loses its rail |
| V12 | On both runbook sites, no link is plain text and no address that answers 200 on `main` answers 404 on the branch | the real-site crawl in task 5, its row file and a zero count | a link or image Ken uses goes dead |
| V13 | Nothing else moves | `npm run gate`, 0 failed | anything else |
| V14 | A hostile README in a linked folder links `../../.ssh/id_ed25519` and `~/.aws/credentials` by absolute path, and raw HTML `<img src>` to a file in `~/.gnupg`: both links render as plain text, nothing is listed, and a direct request for each answers 404. A symlink in a linked folder pointing into `~/.ssh` answers 404 | `mount_files.test.js` | a document that names a key gets it served |
| V15 | A site rooted at home (`lahe review ~/todo.md`): `todo.md` and `~/notes/other.md` answer 200, while `~/.ssh/id_ed25519`, `~/.config/gh/hosts.yml` and `~/Library/Keychains/login.keychain-db` answer 404 | `mount_files.test.js` | a root site still serves every secret under it |
| V16 | A page naming 260 files under mounts: 256 work, 4 render as plain text with the limit title, one log line; the same on three reloads | `sites_pages.test.js` (replaces the other cap test) | no bound on the list, or a page creeps past the limit on reload |
| V17 | Each render that adds files appends one `mount-files` line holding only the new paths; no whole-entry line carries `mount_files`; an older reader of the log ignores the new lines | `mount_files.test.js` reading `sites.log` | the log grows by the whole list on every change |
| V18 | On a case-insensitive disk, a link spelled `Todo.md` to the file `todo.md` is listed as `todo.md` and answers 200, and an old `linked_files` key spelled `Todo.md` still lets the page be served. The test skips itself on a case-sensitive disk and says so | `mount_files.test.js` | a link answers 404 only because of its spelling |
| V19 | A linked HTML page names a file under another mount and a file in its parent folder: neither is listed and both answer 404; its own folder's stylesheet answers 200 | `mount_files.test.js` | a linked HTML file reaches files under other mounts |

## Acceptance criteria

- V1 to V11 and V14 to V19 pass, and `npm run gate` reads 0 failed (V13).
- The real-site crawl (V12) reports zero addresses that answer 200 on `main` and 404 on the branch, and zero links rendered as plain text, on both runbook sites. Its row file and script are named on the progress page.
- The security review of the diff finds no way to reach an unlisted file under a mount, or any file on the secret list from any site.
- The four docs in requirement 11 say the new rule, and none still mentions the folder cap.
- Board row `LAHE-linked-files-rebuild` exists (task 7).
- No analytics: Lahe has none. No flag: the old behavior is two checks in `handle`, and the decision was to remove it.

## Verification results

- **Full gate (`npm run gate:all`, run alone, kept awake):** unit 3126 passed, 0 failed (5 skipped); browsers 2728 passed, 0 failed, none flaky (Chromium, Firefox, WebKit). No helper left running.
- **Your two real sites, main against this branch (V12, `scripts/crawl_compare.js` on a copy of your helper's site records):**

  | Site | Addresses | Lost (200 on main, 404 here) | Links turned to plain text |
  |---|---|---|---|
  | `docs.features.runbooks` | 15,632 | 0 | 0 |
  | `documents.workspace.feature-forge-runbooks` | 8,201 | 0 | 0 |

  The crawl reads addresses more widely than the code does (unquoted values, `poster`, `data`, `@import`, inline style `url()`), so it can catch a file the code fails to list.
- **Code review:** no way found to reach an unlisted or secret file. Five findings, all fixed with tests: the order of the checks is now pinned; the scanner reads unquoted values, `poster`, `data`, `@import` and inline styles; the 256-file limit is counted one way, so a link past it is plain text and never a dead link; the secret folders are resolved once per home folder; the refusal log has its own cap.
- **One test fixed along the way:** the Firefox style switcher test opened a comment box while Firefox was still undoing a scroll, so the box landed 40px off. It failed on `main` too. The test now waits until the page stops moving, the way a reviewer opens a box. No check was loosened.

## Open questions

- **Files a linked HTML page's script loads.** See "Needs your decision". If Ken accepts the 404, the helper-log line (requirement 10) is how a broken page gets noticed.
- **Should the secret list grow?** It is short on purpose, and each entry is a path where credentials live by default. Adding a path is a one-line change with a test.

## Review

Accepted all six security findings: the secret list for mounts and site roots (requirement 13), the HTML own-folder limit (requirement 4), the 256-file limit per page (requirement 14), log lines with only new paths (requirement 15), one `.native` spelling for every path (requirement 16), and a rebuild as its own board row with the secret list covering stale entries meanwhile (requirement 7, task 7).
Rejected: nothing. Whether rendered Markdown should run raw HTML stays with board row `LAHE-markdown-raw-html` rather than becoming a new decision here.
