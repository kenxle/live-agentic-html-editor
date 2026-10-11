# Reviews: Stable addresses architecture

Two reviews ran on the first draft of the architecture. Both changed it; the summary tables in the architecture say how.

## Architect review: Stable addresses

Reviewed: [02_architecture_stable_addresses.md](02_architecture_stable_addresses.md) at commit `96435da`, against the brief, its questions leaf, [the decisions page](../../ongoing/STABLE_ADDRESSES.md), recon, alternatives, and the code in this worktree. Nothing was run.

## Summary

The big shape is right: the helper serves every page on one port, routes by Host, and a name is its own origin. Ken's settled decisions are all honored. The weak part is the serving unit. "One name per file, rooted at the file's folder, with a redirect between pages" was written against today's HTML single-page case, and it does not fit what the rest of the code assumes about Markdown, folders, linked docs, and item page paths.

Needs action before the plan:

- **Three blockers.** A folder review bricks its own `review.write` after about seven pages (AR1). The helper's page-to-file mapping reads `page_path` relative to the review's folder, and per-file origins change that meaning, so agents get told the wrong file (AR2). A per-file root at the file's folder breaks Markdown's `/.lahe-source/` links and images and any folder site that uses `../` or `/assets/` paths (AR3).
- **Two settled rules get lost without anyone deciding to drop them.** The rail stops following the reviewer to the pages next to a single reviewed page, and to linked docs (AR4). Notes pages lose their one-page-only serving (AR7).
- **Several components that depend on page-server records are missing from the components table.** These are the healer, the reload stat, the handled check, projection, and rebuild (AR5, AR6).
- **A simpler shape fixes most of this.** See "A simpler shape" at the end.

| ID | Severity | Kind | One line |
|---|---|---|---|
| AR1 | blocker | defect | Two origins per bound file overflow the review's 16-origin cap, and `review.write` then refuses every call |
| AR2 | blocker | defect | Per-file origins change what `page_path` means; folder, multi-page and linked-doc mapping to files breaks |
| AR3 | blocker | defect | Root = the file's folder breaks Markdown `/.lahe-source/` URLs and folder sites' `../` and `/` asset paths |
| AR4 | important | defect | Binding rule drops "the rail follows the reviewer" for siblings and linked docs; first-visit binding is sticky; `--only` undefined |
| AR5 | important | defect | Retiring page servers makes `servesPath` false, so the healer writes tokens into reviewed HTML files |
| AR6 | important | defect | "Create or reuse the review (unchanged)" is false: `add` needs an origin or it writes the script line to disk |
| AR7 | important | defect | Notes pages lose the one-page-only rule (FREE_WRITING security decision) |
| AR8 | important | defect | Non-secure `.lahe` also removes Web Locks, so the duplicate-tab guard silently turns off |
| AR9 | important | risk | Stale helper is never replaced while tabs are open, and the helper now carries all serving code |
| AR10 | important | defect | The login item does not pin the state folder; CLI and login-item helper can use different state |
| AR11 | important | risk | Aliases cover the layer but not `review.json` grouping; built from server records, computed once |
| AR12 | important | defect | Worktree fallback only knows `.claude/worktrees/`; Ken's `lahe-worktrees/` docs will not map |
| AR13 | important | challenge | Uninstall removes the resolver, so `.lahe` addresses stop working, against requirement 6 |
| AR14 | important | risk | Library Open of an older row steals the rail from a live session; Library kinds not redefined |
| AR15 | minor | risk | Losing `addresses.json` can reassign a clash suffix to a different file |
| AR16 | minor | risk | Redirect keyed on `Sec-Fetch-Mode: navigate` also catches iframes, and misses requests without the header |
| AR17 | minor | defect | Leftover page servers are stopped only in always-on mode |
| AR18 | minor | risk | Fixed DNS port and the new `::1` listener need gating and soft failure |
| AR19 | minor | defect | Docs and code lists are incomplete |
| AR20 | minor | taste | Rail prefs and style choice become per document |
| AR21 | minor | risk | "CLI client header" is not a real factor in `address.bind` authority |
| AR22 | minor | risk | Windows and `sudo` install details will trip the plan |
| AR23 | minor | defect | Name rule has no answer for an empty name or case-only differences |
| AR24 | minor | risk | No design note for requirement 11 (light when idle) |

### Findings

### AR1. Folder reviews overflow the origin cap and brick `review.write`

- **severity** blocker
- **kind** defect
- **where** architecture "Data / State Changes", Review `origins` (line 63) and "Folder reviews" (line 99); `src/service/routes.js:170-194`; `src/shared/protocol.js:118`
- **what** Binding adds two origins (`.lahe` and `.lahe.localhost`) per bound file to the review's `origins`, and a folder review binds every page it serves on first visit.
- **why** `ORIGIN_LIMIT` is 16. The internal `registerOrigin` has no cap, so the list grows past it. But `review.write` checks the total the review already holds (`wouldHold.length > ORIGIN_LIMIT`), even when the call adds no new origin. So once a folder review has bound about seven pages, every later `review.write` on it is refused. That includes `lahe review <folder>` run again and `lahe add` on the same review. Each registration also rewrites `service.json`, which holds every review's token, and here that happens on a page GET.
- **fix** Do not put name origins on the review at all. When the Origin is one of Lahe's own names, the helper checks it against the registry: is this name's file served with this review right now? Keep `review.origins` for loopback, dev-server, and `null` origins as today. This also removes the `service.json` rewrites and the `origin.registered` event noise.

### AR2. Per-file origins change what `page_path` means, and the helper's page-to-file mapping breaks

- **severity** blocker
- **kind** defect
- **where** architecture "Page identity" (line 71) and "Serving a request" (lines 85-86); `src/service/reviews.js:854-905` (`pageUnderFolder`, `targetForPage`), `src/service/handled_check.js:542-575` (`pageFilesFor`), `src/service/static_servers.js:1252` (`linkedFileForPage`), `src/service/projection.js:371-395`
- **what** Today an item's `page_path` is the page's path under the review's served root. The helper uses it to name the file an agent edits, to pick which file's mtime reloads the page, and to judge "handled". Under the design, a folder review's page `site/sub/p.html` is served at `p.lahe:7817/` or `/p.html`, so its `page_path` is `/` or `/p.html`.
- **why** `pageUnderFolder` then resolves `/` to `site/index.html`, so a comment on `sub/p.html` is reported against the index file. The agent edits the wrong file. `targetForPage` suffix-matches on the path, so a multi-page review whose page path is `/` matches nothing, and the page never reloads after an edit. `linkedFileForPage` only understands `/.lahe-source/<hash>/` paths read from page-server records, which are being retired. None of these modules is in the components table. The design also serves one page at two paths (`/` and `/<file name>`), so one document gets two `pageKey`s.
- **fix** Pick one of these and write it down:
  - Keep `page_path` meaning "path under the serving root" (see AR3), so the existing mapping keeps working.
  - Or resolve an item's file from its origin through the registry, and change all four mappers to use that.

  Either way, give each page exactly one URL path and redirect the other spelling to it. Use the file's own path rather than `/`, because `targetForPage` matches on the name. Add `reviews.js`, `handled_check.js`, `projection.js` and `review_format.js` to the components table.

### AR3. "Root = the file's folder" breaks Markdown and folder sites

- **severity** blocker
- **kind** defect
- **where** architecture line 89 (reserved paths), line 96 ("the root a name serves from is its file's folder"); `src/service/markdown.js:159-170` (`assetPrefix`, `rewriteRelativeUrls`), `src/service/markdown_links.js:57-59, 125-172`
- **what** Every relative URL in rendered Markdown is rewritten to `/.lahe-source/<hash of source folder>/...`. A link outside the source folder (`../../ongoing/STABLE_ADDRESSES.md`, `../images/x.png`) is translated to another folder's mount. The reserved paths list leaves out `/.lahe-source/`, and nothing says where mount tables live once page-server records and `SIGHUP` reloads are gone. Separately, a folder review today roots at the folder. So `site/sub/p.html` can load `../style.css` or `/assets/app.js`. With the root at `site/sub/`, both now point above the root.
- **why** Every Markdown review loses its images and its links to other files. That is most of what Ken reads, and it breaks requirement 8a (links and relative assets keep working). Wireframe sets and real site folders lose shared styles and scripts.
- **fix** Make the serving root a property of the name, recorded once in the registry. For a folder review, it is the review's folder, with the page at its path under it (`p.lahe:7817/sub/p.html`). For a single file, it is the file's folder. For Markdown, keep `/.lahe-source/<hash>/` mounts. Store each name's mount table in the registry (or a helper-owned file beside it), and scope it to that name, so one name does not serve another document's mounted folders. Then say whether a Markdown name serves the artifact that `rebuild.js` keeps current, or renders the source on request. Today the review's target is the artifact (`review.js:246-252`), and the reload stat and the handled check both read it, so serving a different render from the source would make them disagree.

### AR4. The binding rule drops "the rail follows the reviewer"

- **severity** important
- **kind** defect
- **where** architecture lines 98-99, 166; `src/service/static_servers.js:829-933` (`backsServer`, `findReviewForRequest`), `docs/ongoing/STATIC_SITE_FOLDER.md` (Ken's 2026-09-16 rule, linked documents section)
- **what** Only folder reviews bind unbound pages. A single-page review's siblings and a Markdown hub's linked documents are "served read-only". The first-visit binding is also stored and sticky.
- **why** Ken set the rule himself: a single-page review lends its rail to every page in its folder, linked docs ride the linking review (`linked_files`), and `--only` opts out. The design drops all three without saying so. A sticky binding means a later `lahe review site/` with a new review never takes over pages already bound to the old folder review. The rail would stay on an old, maybe closed, review. Writing on GET also brings back the second-writer worry the static-site doc avoided by having the server write nothing.
- **fix** Store only name to file (and root) in the registry. Pick the review per request, the way `findReviewForRequest` does today: a review that recorded this file, else the newest review whose served root covers it and is not `--only`, else the newest review that linked to it. Drop the session filter, since sessions no longer own servers. Keep one explicit override, set only by a command or by Open, that wins only while it is newer than any review created after it. Put this rule in its own short section of the architecture.

### AR5. Retiring page servers turns the healer on for served files

- **severity** important
- **kind** defect
- **where** components table line 29; `src/service/reviews.js:957-967, 1011-1017`, `src/service/static_servers.js:1013-1028` (`servesPath`), `src/service/heal.js:164`
- **what** The healer writes a stripped script line back into a reviewed HTML file unless `servesPath` says a live or idle-stopped page server covers it. With no page-server records, `servesPath` returns false for every file.
- **why** On the next poll, the helper writes the review id and live token into the reviewer's own working tree, in every reviewed HTML file. The design was built to prevent exactly that. The page then also carries two script tags.
- **fix** Replace `servesPath` with a registry question: does a name serve this file? Keep healing only for `file://` and `lahe add` reviews. List `heal.js` and `reviews.js` in the components table, with a test that a served file's bytes on disk do not change after a poll.

### AR6. `lahe review` is not "unchanged" before the bind

- **severity** important
- **kind** defect
- **where** architecture "Binding a file", line 108; `src/cli/commands/review.js:239-275`
- **what** Today `lahe review` passes `--origin http://127.0.0.1:<page port>` and `--under-review` to `add`. Without an origin, `add` takes the `file://` path: it writes the script line into the HTML file, copies the bundle beside it, and prints its own "Open it" and fallback lines.
- **why** With no page server there is no origin to pass. The name origins are only known after `address.bind`, which needs a review id that `add` has not minted yet, and `review.write` refuses non-loopback origins.
- **fix** Spell out the new order and the new `add` mode. For example: `add --served-by-helper` registers no origin, writes nothing to disk, and prints nothing; then `address.bind` names the file. Also say what `recordLinks` becomes (`review.js:276-289`). The rest of the CLI changes depend on this.

### AR7. Notes pages lose their one-page-only rule

- **severity** important
- **kind** defect (intersects security)
- **where** architecture lines 59, 88; `src/cli/commands/write.js:17-20`, `docs/ongoing/FREE_WRITING.md:72-75`
- **what** `kind: notes` exists, but the serving flow applies "any other file under the folder: serve it as bytes" to every name.
- **why** Notes usually sit in `~`, `~/Desktop` or `~/Documents`. The one-page server exists so a notes file does not serve its whole folder, dotfiles included (security review 6 of free writing). Under this design, `notes.lahe:7817/.zshrc` answers.
- **fix** Give each name a serving mode in the registry (`page-only` for notes, `folder` otherwise). Page-only answers the page, style, fonts and library, and 404s everything else, as today.

### AR8. Non-secure `.lahe` also loses Web Locks

- **severity** important
- **kind** defect
- **where** architecture "Failure Modes", line 163, and components line 33; `src/layer/store.js:206, 1385-1400`
- **what** The design and the recon only plan for the missing clipboard API. `navigator.locks` is also only available in a secure context. Without it, `claimWindow` grants every tab the window ("unchecked").
- **why** On the default `.lahe` ending, the duplicate-tab guard (`duplicate_tab.spec.js`) is silently off. Ken keeps many tabs and restores sessions, so two live tabs of one document can both act as the holder and write.
- **fix** List it as a failure mode. Then choose one: a localStorage-based holder lease as the fallback, or accept and document it. Add a browser test on a `.lahe`-style non-secure host (a Chromium host-resolver rule makes this possible without the resolver). Grep the layer for every secure-context API before the plan is written.

### AR9. A stale helper is never replaced, and it now serves every page

- **severity** important
- **kind** risk
- **where** architecture lines 127-129, 169; `src/cli/commands/session.js:199-240`, and the second copy in `add.js:658-668`
- **what** The design keeps "replace only when no review window is open". It also only covers a stale helper, not a helper that is down.
- **why** With always-on serving and tabs left open overnight, some window is nearly always held, so new code never takes over. Before this feature, page servers started fresh with current code; now the Markdown render, injection, and page routes all live in the stale helper. Second problem: if the login item's helper is down or throttled, both `startHelper` copies spawn a detached helper. launchd's restart then hits a taken port and loops. Third: a CLI run from a worktree with newer files sees the main clone's helper as stale on every command and kickstarts it each time, and the restart still runs the main clone's code.
- **fix** When installed, the CLI never spawns: it kickstarts or reports. Compare source stamps against the clone the login item names, not the CLI's own clone. Let a stale always-on helper be replaced while windows are open, since the address and port no longer change and the layer already survives helper restarts (`helper_restart_holds.spec.js`). Wait for a short quiet moment in the outbox, not for zero windows.

### AR10. The login item does not pin the state folder

- **severity** important
- **kind** defect
- **where** architecture line 65 (`install.json` fields), line 123; `src/service/state_dir.js:121-135`
- **what** The state folder comes from `$LAHE_STATE_DIR`, then `$XDG_STATE_HOME`, then the default. launchd, systemd user units, and Task Scheduler do not start with the user's shell environment.
- **why** If Ken's shell sets either variable, the login-item helper and the CLI use different state folders. The CLI finds no `service.json`, tries to start its own helper on 7817, fails, and the reviews and registry split in two.
- **fix** Record the resolved state folder in `install.json`, and pass `--state-dir` and `--port` in the login item. Have `/health` report a state-folder id, so the CLI can say "the running helper uses a different state folder" instead of failing on the port.

### AR11. Aliases fix the rail but not `review.json`, and their source is fragile

- **severity** important
- **kind** risk
- **where** architecture lines 61, 69, 71; `src/shared/review_format.js:411-510`
- **what** Aliases go into the script tag and `samePage` in the layer. `review_format.js` groups items for the agent by `pageKey` and `samePage` with no alias list. Aliases are read once from old page-server records (port history times the twin hosts).
- **why** The agent sees one document split into an old group and a new group, and items posted on `.lahe` and on `.lahe.localhost` land in two groups as well. Records only hold ports that were recorded since port history existed. An install that picks another port adds another origin later, but the aliases were computed once.
- **fix** The simplest identity is the file. The helper already resolves an item's file for `review.json`, so group by resolved file in `review_format`, and send the layer that file's known page keys, computed at each serve rather than once. If aliases stay, pass the same list to `projectReview`, and derive it from the bound review's own items that map to this file, not from server records.

### AR12. Worktree fallback only covers `.claude/worktrees/`

- **severity** important
- **kind** defect
- **where** architecture lines 23, 91-92; brief requirement 13 (a worktree document survives its worktree); `src/service/catalog_reader.js:76, 885-893`
- **what** The Library's mapping is the regex `<repo>/.claude/worktrees/<name>/<rest>`. It is also only trusted when a page-server record's root sits in a worktree, and those records are being retired.
- **why** Ken's own worktrees for this feature are at `~/Documents/workspace/lahe-worktrees/<name>`, a sibling folder the regex never matches. So this feature's own docs would get the "file is gone" page. The trust anchor is going away too.
- **fix** At bind time, while the worktree still exists, read its `.git` file (gitdir, then commondir) and record the main checkout path in the registry entry. The registry is written only by the helper, so it replaces the page-server record as the trust anchor. Fall back to the regex for old entries.

### AR13. Uninstall breaks `.lahe` addresses, against requirement 6

- **severity** important
- **kind** challenge
- **where** brief requirement 6 ("installing, uninstalling, or a broken setup never makes an address that worked stop working") and requirement 7 ("uninstall removes the `.lahe` setup"); architecture lines 138, 181
- **what** The server answers both endings, but once `/etc/resolver/lahe` is removed, nothing resolves `name.lahe`. The name server only runs when the resolver is set up.
- **why** Every `.lahe` bookmark and history entry dies on uninstall. The two requirements contradict each other, and the architecture claims requirement 6 without resolving it.
- **fix** Ask Ken. Options: uninstall leaves the resolver and the name server in place (the resolver is harmless when nothing answers); uninstall keeps the addresses dead and says so; or always print `.lahe.localhost` and treat `.lahe` as a short alias. Write the chosen behavior into the architecture.

### AR14. Library Open can steal the rail, and the Library's kinds are not redefined

- **severity** important
- **kind** risk
- **where** architecture lines 30, 60, 166; `src/service/catalog_reader.js:866-905`, `src/service/catalog_actions.js:243-298`
- **what** Open sets the binding. "Openable" today means "a recorded page server can be restarted". Worktree rows depend on a page-server record. Open reopens closed sessions and swaps origins.
- **why** Ken opening an older row for a file that a live agent session is reviewing moves the rail off the live review, without any warning. The `openable`, `via-agent`, `worktree` and `legacy` rules, the reopen-session step, and the sweep that follows it all lose their meaning, and the architecture gives one line to all of it.
- **fix** Add a Library section to the architecture:
  - **openable** means the file is on disk and Lahe can serve it (HTML or Markdown).
  - **worktree** comes from the registry's recorded main checkout (AR12).
  - **via-agent** stays for dev-server and `--origin` reviews.
  - **legacy** means `lahe add` script-line reviews: say whether Open now gives them a name.

  Open of a file already bound to a newer review in an open session goes to the address without rebinding, unless Ken confirms. Say whether Open still reopens a closed session.

### AR15. Registry loss can point a bookmark at a different file

- **severity** minor
- **kind** risk
- **where** architecture lines 39-58, 170
- **what** Clash suffixes depend on the order files were first named. A corrupt or missing `addresses.json` (or a removed state folder, which the design restarts into fresh) rebuilds names in a different order.
- **why** `readme-personal-2` could then name another file. A bookmark that opens the wrong document is worse than one that says "gone".
- **fix** Keep an append-only log of name grants beside the file, or a last-good copy. On a file that cannot be read, refuse to mint new clash suffixes rather than starting empty.

### AR16. Redirect test on `Sec-Fetch-Mode: navigate`

- **severity** minor
- **kind** risk
- **where** architecture line 97
- **what** Iframe loads also have mode `navigate`. Some clients send no Sec-Fetch headers at all.
- **why** A wireframe page that frames its sibling screens gets each frame redirected to another origin, which breaks same-origin frame access and the layer's frames option. A request with no header falls to "bytes", so it gets no redirect and no rail.
- **fix** Redirect only on `Sec-Fetch-Dest: document`. Treat a missing header plus `Accept: text/html` as a navigation. Serve iframe requests as bytes, read-only.

### AR17. Leftover page servers in clone mode

- **severity** minor
- **kind** defect
- **where** architecture line 165
- **what** The one-time stop of old page-server processes only runs on the first always-on start. In clone mode, `session close` "stops nothing but the session".
- **why** Page servers started before the upgrade keep running on a clone with no install. That is the battery cost the bulletin row LAHE-idle-battery-cost (finished sessions' page servers keep running) is about.
- **fix** Run the sweep on every helper start until no record names a live pid.

### AR18. Name server port and the `::1` listener

- **severity** minor
- **kind** risk
- **where** architecture lines 26, 124, 152, 161
- **what** The DNS port (7853) is a constant, and a second listener on `::1` is added.
- **why** If test helpers start the name server, they collide on 7853. On a Linux box or container with no IPv6 loopback, binding `::1` fails, and if that is treated as fatal the helper does not start.
- **fix** Start the name server only when `install.json` records a resolver, with the port read from it. Treat an `::1` bind failure as a log line, not an exit.

### AR19. Docs and code lists are incomplete

- **severity** minor
- **kind** defect
- **where** components table, lines 21-35
- **what** Missing:
  - `docs/ongoing/STATIC_SITE_FOLDER.md` and `docs/ongoing/FREE_WRITING.md`, which both describe per-session servers
  - `README.md:91`
  - `src/cli/index.js`, the command list, for `install` and `uninstall`
  - `src/service/rebuild.js`, `projection.js`, `handled_check.js`, `heal.js`, `markdown.js`, `markdown_links.js`, `review_format.js`
  - the manifest entries for five new files
- **why** Requirement 12 (agents are told) says no doc may still describe per-session servers. A file missing from the manifest fails `lint`.
- **fix** Add them to the table. The protocol change should also name the new script-tag attribute in `protocol.scriptTag`, so the wire spelling stays in `src/shared`.

### AR20. Per-document origins reset rail prefs and style choice

- **severity** minor
- **kind** taste
- **where** recon section 5; `src/layer/style_switch.js:87`
- **what** Rail prefs, the hold toggle, and `lahe.style.v1` live in per-origin storage.
- **why** Within a folder review, these were shared across pages. Now each page starts fresh, so Ken picks a style on one page and the next page ignores it.
- **fix** Note it as accepted, or keep the style choice per review on the helper.

### AR21. "CLI client header" is not an authority factor

- **severity** minor
- **kind** risk (for the security reviewer)
- **where** architecture lines 117, 177; `src/shared/protocol.js:613` (CLIENTS is "layer or cli")
- **what** Any page with a registered origin can send `x-lahe-client: cli` after a preflight. So `address.bind` rests on the token plus the target check, and the target check reads `meta.json` target paths that `review.write` records.
- **why** The architecture's stated authority is stronger than the real one.
- **fix** State the real factors. Have the security review decide whether a page token may mint names for files under its folder.

### AR22. Install details that will trip the plan

- **severity** minor
- **kind** risk
- **where** architecture lines 140-152
- **what**
  - Task Scheduler's restart on failure cannot be set with plain `schtasks` flags; it needs a task XML import.
  - A task that runs `node.exe` shows a console window unless something wraps it.
  - The `sudo` step needs a person at a terminal; an agent's shell will hang on it.
  - macOS shows a "Background Items Added" notice that names the program, which may be `node`.
- **why** Each of these is a surprise for a builder partway through a task.
- **fix** Mark each as unverified in the architecture, and plan one spike per system. Have `lahe install` refuse to run without a TTY, and print the command for the human to run.

### AR23. Name rule gaps

- **severity** minor
- **kind** defect
- **where** architecture line 58
- **what** A file name with no ASCII letters or digits becomes an empty name. On macOS, `fs.realpathSync` keeps the case the caller used, so `Docs/A.md` and `docs/a.md` can be two files to the registry.
- **why** An empty name is an invalid host. Case-only differences give one file two names.
- **fix** Use a fallback stem (`doc`) plus a clash number. Use `fs.realpathSync.native` for the registry key.

### AR24. Requirement 11 has no design note

- **severity** minor
- **kind** risk
- **where** architecture as a whole; `src/service/reviews.js:1094-1115`, `src/service/index.js:197`
- **what** The helper loads every review into memory at start and rewrites the token file on each origin registration. Serving now also runs in the same process.
- **why** The plan has to set limits for requirement 11 (light when idle) before building, with no design input on what drives the cost.
- **fix** Name the expected cost drivers: review count, polling tabs, open sockets, and the Markdown render cache. Note launchd's default limit of 256 open files for a login item, and raise `NumberOfFiles` in the plist if the measurement calls for it.

## A simpler shape

Three changes remove AR1, AR2, AR3, AR4 and most of AR11 together:

1. **The registry maps a name to a file, a serving root, a mode, and, for Markdown, its mounts. Nothing else.** It does not store a bound review or aliases.
2. **The page's URL path stays its path under the serving root,** as today. Only the origin changes. Item `page_path` keeps its meaning, every page-to-file mapper keeps working, and an alias is just "old origin, same path".
3. **The helper decides the review per request and checks Origin against the registry.** It uses today's `findReviewForRequest` rule without the session filter, so no origins are added to reviews.

## Verified claims

Recon citations checked and correct: `samePage`, `pageKey` and `pageFrom` (`src/shared/record.js:372-515`), `isRegisterableOrigin` and the 16-origin cap, the `servesPath` heal stand-down, `findReviewForRequest` session scoping and `--only`, `linkedFileForPage`, Markdown asset prefixes, `rebuild.js` depending on `staticServers.list` and `recordLinks`, the `startHelper` replace rule, and the Library worktree regex. Recon missed `navigator.locks` (AR8) and the healer flip (AR5).

## Cleanup needed

Nothing created except this file.


## Security review: Stable addresses architecture

Reviewer: review-security, on [the architecture](02_architecture_stable_addresses.md), 2026-10-11. Read with [recon](parts/architecture/recon.md), [alternatives](parts/architecture/alternatives.md), [the brief](01_brief_stable_addresses.md), D11 in the [original architecture](../20260812.01_live_agentic_html_editor/02_architecture_live_agentic_html_editor.md), and the code in `src/shared/protocol.js`, `src/service/auth.js`, `src/service/static_servers.js`, `src/service/index.js`, `src/service/routes.js` and `src/service/catalog_reader.js`. Nothing was run.

## Summary

Two blockers. Both are cheap to fix in the design now and expensive after the build.

- **SR1:** the server answers `*.lahe` names on machines where Lahe does not control how `.lahe` resolves. Whoever answers DNS for that machine (a hostile Wi-Fi network, a squatter on the name server port) can run a DNS rebinding attack under a real document name. That reads documents, their tokens and the Library. The design says rebinding is stopped by the Host check; for `.lahe` it is not.
- **SR2:** `address.bind` is reachable from any page. The "CLI header" is the public string `cli`, the token is on the page's script tag, and the page's origin is registered. Its one remaining guard, "a file under the review's folder", rests on paths a page can already write through `review.write`. So a page can name arbitrary files and steal other documents' rails.

| # | Severity | Kind | Finding |
|---|---|---|---|
| SR1 | blocker | defect / challenge | `.lahe` Hosts are answered where Lahe does not own `.lahe` resolution, so DNS rebinding works under a real name |
| SR2 | blocker | defect | `address.bind` is callable by page script, and its folder check reads page-writable paths |
| SR3 | important | defect | Per-file origins do not wall documents off: every name serves its whole folder tree, dotfiles included |
| SR4 | important | risk | Always-on, fixed port, guessable names, no token to read a page: other OS users and sandboxed local code can read documents |
| SR5 | important | defect | `http://*.lahe` gets no `Sec-Fetch-*` headers, so the Library's checks and the "navigation only" rule cannot work there |
| SR6 | important | risk | The name server port can be squatted; the ending check would pass for a squatter; a bad packet can crash the helper |
| SR7 | important | defect | A plain GET mints permanent names and adds origins, from any link on any website |
| SR8 | important | risk | No cross-origin resource policy: websites can embed and probe document assets |
| SR9 | important | defect | A name points to a path, not a file: worktree fallback and path reuse put a review token on a file nobody bound |
| SR10 | minor | risk | Old random-port origins stay valid credentials forever after page servers retire |
| SR11 | minor | risk | Host routing details: order, grammar, IDN names, escaping, listen addresses |
| SR12 | minor | risk | `sudo`, resolver file and login item hygiene |
| SR13 | minor | risk | The aliases attribute needs escaping, a cap and a trusted source |
| SR14 | minor | risk | Chrome's Local Network Access and browser DNS behaviour are assumed, not checked |

## Findings

### SR1. `.lahe` names are answered where Lahe does not own `.lahe` resolution

```
severity   blocker
kind       defect (and a challenge to part of requirement 6)
where      Architecture "Serving a request" (Host routing), "Which ending is printed",
           Security & Privacy Notes ("DNS rebinding sends a foreign Host");
           brief requirement 6 (both endings always answer) and requirement 10
```

**What.** The helper serves `<name>.lahe` and `library.lahe` on every system, whether or not this machine's resolver sends `.lahe` to Lahe's own name server.

**Why.** The Host check stops rebinding only when the attacker must use a name the server does not know. With `.lahe`, the attacker can use a name the server does know, as long as the attacker controls how that name resolves. On Linux, Windows, and a Mac without the resolver file (or after `lahe uninstall`), a `.lahe` lookup goes to whatever DNS server the network hands out. A hostile Wi-Fi network, a compromised router, or a future real `.lahe` top-level domain can then do this:

1. Answer `readme.lahe` with the attacker's own IP and serve a page at `http://readme.lahe:7817/`. Ken reaches it from a link.
2. Re-answer `readme.lahe` with `127.0.0.1`. The attacker's script fetches `/` from its own origin. The request reaches the helper with `Host: readme.lahe:7817`, a registered name.
3. The response is the document with its review id and token injected, and the script can read it because it is same-origin. Every file under the document's folder is readable the same way (SR3).
4. The script calls `127.0.0.1:7817` with `Origin: http://readme.lahe:7817`. That origin is registered on the review, so it passes D11's token and origin checks. It can read the review and post comments that go to Ken's agent.
5. Same for `library.lahe`: the Library page carries the Library token, and `Origin` equals `http://` + Host, so the Library's own checks pass.

Names are easy to guess: `readme`, `index`, `notes`, `site`, and Lahe's own document names. Chrome's Local Network Access prompt may stop step 2 in Chrome; Firefox and Safari have no such step. The `.lahe.localhost` ending is safe only where the browser hard-wires `*.localhost` to loopback and never asks DNS. Chrome and Firefox do this. Safari is not established, and the architecture's line "Browsers send `*.localhost` to this computer on every system" is unverified.

**Fix.**

- Answer `*.lahe` and `library.lahe` Hosts only while the same test that picks the printed ending passes: the resolver is installed, Lahe's own name server holds the port, and a lookup returns loopback. Use the nonce check in SR6 so a squatter cannot pass it. At every other time, and on Linux and Windows, refuse a `.lahe` Host with a 400.
- This is a challenge to requirement 6's "the server answers both endings for every name". It loses Ken nothing. On a machine where Lahe's resolver is not in place, the only thing that can send a `.lahe` name to this computer is someone else's DNS, so the only visitor that refusal turns away is an attacker. After uninstall, Ken's `.lahe` bookmarks stop resolving whatever the server does.
- Add a browser-walk row: in Safari, Chrome and Firefox on macOS, `x.lahe.localhost` resolves to loopback with no DNS query on the network (a packet capture, or a hostile resolver in the test). If Safari asks the network, also write `/etc/resolver/lahe.localhost` during install, or print `.lahe` only and treat Safari as unsupported for `.lahe.localhost`.
- Rewrite the Security & Privacy line about rebinding to say what the Host check covers and what it does not.

### SR2. `address.bind` is callable by page script

```
severity   blocker
kind       defect
where      Architecture "Binding a file" (address.bind authority), Security & Privacy Notes
           ("Origins are added by the helper, never by the wire");
           src/shared/protocol.js:168-170 (CLIENT_CLI = "cli", in CLIENTS);
           src/service/routes.js:233 (review.write records body target_path);
           src/service/catalog_reader.js:889-892 ("meta.json's paths alone are page text")
```

**What.** The design gives `address.bind` "the same authority as `review.write`: loopback Host, the CLI client header, the review's token". A page on its own origin holds all of these.

**Why.**

- The Host is `127.0.0.1:7817` because that is where every page sends its API calls.
- `x-lahe-client: cli` is a constant the layer could send as easily as `layer`. It exists to force a preflight, not to identify the caller. The preflight passes because the page's origin is registered (`anyReviewRegistered`, `src/service/index.js`).
- The token is on the page's script tag, and `checkRequest` accepts the page's own `Origin`.
- That leaves one guard: "the target must be the review's own file or a file under its folder". The review's recorded paths are page-writable: `review.write` takes `target_path` from the body and appends it to `target_paths`. The Library's reader already treats those paths as page text.

So a page can:

- record `/Users/ken/.ssh/config` and bind it. That mints a permanent name whose folder, `~/.ssh`, the always-on server then serves (SR3, SR4, SR1).
- re-bind a sibling document's name to its own review. Ken's comments on that document then flow into a review the attacker page can read, and the real review loses its rail. The design's "only `address.bind` adds origins" stops being a control, because `address.bind` is on the wire.

**Fix.**

- Give `address.bind` a credential no page can hold. Use a random CLI secret in an owner-only file in the state folder, minted by the helper at start (or a field in `service.json`, which is already 0600). The CLI reads it and sends it; the route compares it in constant time.
- Also refuse any `address.bind` request that carries an `Origin` header or any `Sec-Fetch-*` header. A browser always sends `Origin` on a cross-origin POST. Confirm that Node's `fetch` in the CLI sends neither.
- Take the target file from the CLI request, never from `meta.json`. Check it on the helper side: realpath, regular file, owned by the helper's user, no hidden segment, not inside the state folder, and not a folder SR3 refuses as a root.
- Once a name's binding comes from the registry, `findReviewForRequest`-style matching on `target_paths` must not decide which token a page gets. Add unit tests: a page-shaped request (with `Origin`, without the secret) to `address.bind` is refused, and a `review.write` with `target_path` cannot widen what may be bound.

### SR3. Per-file origins do not wall documents off

```
severity   important
kind       defect
where      Architecture "Serving a request" ("any other file under the folder: serve it as bytes";
           "A script's fetch of a sibling HTML file gets the bytes"), Security & Privacy Notes
           ("Each name is its own origin ... stronger than today"); brief requirement 4;
           src/service/static_servers.js:749 (hasHiddenSegment, called nowhere),
           :1637 (root branch serves any file under the root)
```

**What.** Every name serves every file under its file's folder, recursively, as bytes to its own origin. Sibling `.html` and `.md` files are included, and so are dotfiles.

**Why.**

- Requirement 4 says script on one document cannot read another document's page. Under this design, `a.lahe` can `fetch("/b.html")` and read `b`'s source. It cannot read `b`'s injected token or storage, but the document content is what Ken wants walled off.
- A document in a broad folder exposes the whole tree. `~/notes.md` gives a name whose root is the home folder.
- Today's serving has no hidden-segment rule outside mounts. The helper `hasHiddenSegment` exists, but its own comment says nothing calls it, so `.git/config`, `.env` and `.ssh/` under a root are served. Today that is bounded by a short-lived random port. After this feature it is a permanent, guessable address (SR4, SR1).
- A sibling HTML that `lahe add` wrote a script line into (a `file://` review) carries that review's token in its bytes. Read across origins, that token works for any review that registered `null`, by D11's stated residual.

**Fix.**

- Refuse any path with a hidden segment on every page route, checked on both the requested path and its realpath.
- For a single-file name, serve as assets only the types a page loads (images, styles, scripts, fonts, media), and give other documents only the navigation redirect. Keep the wider rule (sibling HTML as bytes) for folder reviews, where the reviewer chose the folder, and print the root as `lahe review` does today.
- Refuse to make a name whose root would be the home folder, the filesystem root, `/Users`, `/home`, or a temp root. Point the user at `--only` or a narrower folder instead.
- Correct the Security & Privacy note: per-file origins separate storage and tokens, not file contents within a folder.

### SR4. Other OS users and sandboxed local code can read documents

```
severity   important
kind       risk
where      Security & Privacy Notes ("A local program could load a page and read its token,
           as it could read the state folder"); brief requirement 10; D11's
           "the final boundary is the user account"
```

**What.** The design makes page serving always on, at a fixed port, under names derived from file names, with no credential needed to GET a page or its folder's files.

**Why.** D11 draws the line at the user account: a process running as Ken can already read the state folder. These local readers are not Ken's account, and loopback serves them anyway:

- another OS user on the same Mac or Linux machine;
- a container with host networking;
- a sandboxed app or extension that has network access but no file access.

Today they would need to find a short-lived random port. After this feature they connect to 7817, send `Host: readme.lahe.localhost`, and read the document, its review token (and so post comments that reach Ken's agent), and the folder's files with Ken's file permissions. The Library at `library.lahe.localhost` hands out its token the same way. Requirement 10 says "only this computer can reach it", but the review should not read that as "only Ken".

**Fix.** Pick one and state it in the doc:

- **(a)** Add a browser-held credential. `lahe review` opens the first URL with a one-time code. The server swaps it for an `HttpOnly; SameSite=Strict` cookie: scoped to `lahe.localhost` for that ending, host-only per name for `.lahe`. Page and Library responses then need the cookie, and a bookmark still works in the same browser profile. Without the cookie, the server shows a "open this from Lahe" page with no content.
- **(b)** Accept the risk, write it into D11's residuals as a new line, and have `lahe install` refuse or warn on a machine with more than one interactive user.

Either way, fix the Security & Privacy sentence, which is wrong for these callers.

### SR5. `http://*.lahe` gets no Fetch Metadata headers

```
severity   important
kind       defect
where      Architecture "Serving a request" ("Only a top-level navigation (Sec-Fetch-Mode:
           navigate) ... is redirected"), Library routing for library.lahe;
           src/service/auth.js:247-251 (Library requires Sec-Fetch-Site; missing is refused);
           src/shared/protocol.js:378-445 (sec_fetch_site per catalog route)
```

**What.** Browsers send `Sec-Fetch-Site`, `Sec-Fetch-Mode` and `Sec-Fetch-Dest` only to potentially trustworthy URLs. `http://x.lahe` is not one, which the design already concedes for the clipboard. Treat this as needing a browser check, but the Fetch Metadata spec states it.

**Why.**

- The Library refuses a request with no `Sec-Fetch-Site`, on every route including the page itself. So `library.lahe` cannot work as specified. The easy fix a builder will reach for is to allow a missing header. That reopens the check, which is the Library's defence against other pages.
- The page route's navigation test has nothing to read on `.lahe`. If "missing" is treated as "navigate", every script fetch of a sibling gets a 302 and mints a name (SR7). If it is treated as "not navigate", requirement 8a's links fail on `.lahe`.

**Fix.**

- Keep the Library's missing-header refusal exactly as it is. Serve the Library only on secure-context Hosts (`127.0.0.1`, `localhost`, `library.lahe.localhost`), and answer `library.lahe` with a 302 to `library.lahe.localhost`. That needs a change to requirement 15's wording; it still gives a stable address.
- For page redirects, use `Sec-Fetch-Mode` when present. When absent, decide by `Accept` including `text/html` together with no `Origin` header (a same-origin GET navigation sends none), and never mint a name on that path (SR7).
- Add a unit test that the Library refuses a request without `Sec-Fetch-Site` on every Host.

### SR6. The name server can be squatted or crashed

```
severity   important
kind       risk
where      Architecture "`.lahe` on macOS", "Which ending is printed", Failure Modes
           ("The name server's port is taken. The helper logs it and serves on")
```

**What.** `/etc/resolver/lahe` points every `.lahe` lookup at `127.0.0.1:7853` permanently. Any local process, any user, can bind that UDP port when the helper does not hold it: before the login item starts, during a crash loop, or after the helper lost the race.

**Why.**

- A squatter answers `.lahe` with any address it likes. That is SR1's attack with no hostile network needed. It could also send `library.lahe` to a lookalike Library that collects comments.
- The planned ending check (does `library.lahe` resolve to loopback?) passes for a squatter that answers that one name honestly.
- If the name server socket sets `reuseAddr`, libuv on macOS sets `SO_REUSEPORT`, and a second process can share the port and receive queries.
- The DNS parser runs inside the helper. One malformed packet that throws takes down pages, the API and the Library. A local process can repeat it after each restart.

**Fix.**

- Bind the socket exclusively, never with `reuseAddr`.
- Make the ending check prove Lahe answered. At start, mint a random nonce. The name server answers `check-<nonce>.lahe` with a loopback address derived from it (for example `127.83.x.y`), and the helper confirms that exact address through the system resolver.
- Tie SR1's `.lahe` Host gate to this check. If the helper cannot bind 7853, or the nonce check fails, it refuses `.lahe` Hosts and prints `.lahe.localhost`. A plain "logs it and serves on" is not enough.
- Parse defensively: check bounds on every read, answer only a single-question standard query for `A` or `AAAA`, drop anything else silently, and wrap each packet in try/catch so a bad one cannot reach the process. Add fuzz-style unit tests with truncated and oversized packets.

### SR7. A GET mints permanent names and adds origins

```
severity   important
kind       defect
where      Architecture "Serving a request" ("302 to that file's own name (named on first
           visit)"; "A page under it with no binding of its own is bound to the folder review on
           first visit"); Data ("A name is never reused"); ORIGIN_LIMIT, src/shared/protocol.js:118
```

**What.** Navigating to `known.lahe:7817/<any .html or .md under the folder>` writes a permanent registry entry. For a folder review, it also adds two origins to the review.

**Why.**

- Any website can cause the write with a link or `window.open`. A top-level navigation needs no permission. On `.lahe`, with no Fetch Metadata (SR5), script fetches may trigger it too.
- Names are never removed or reused, so the registry and `addresses.json` grow without bound.
- Each new name widens what the always-on server answers for.
- Folder reviews hit `ORIGIN_LIMIT` (16) after eight pages. If "the helper adds them internally" means past the cap, the cap that guards against "a caller quietly accumulating origins" is gone for exactly the callers who can trigger it.

**Fix.**

- Mint on a request only when it shows it came from the page itself: `Sec-Fetch-Site: same-origin`, or (on `.lahe`) a `Referer` whose host is the requesting name. Otherwise serve the sibling read-only with no name and no rail, or show a short "open from Lahe" page.
- Cap new names per folder and per hour, and log each mint, as the brief's logging section already asks.
- State the origin cap for folder reviews. Either the internal add obeys a cap that is sized for folders and stated in the doc, or folder-review pages share the folder review's own origins under a stated rule. Never leave internal adds unbounded.

### SR8. Websites can embed and probe document assets

```
severity   important
kind       risk
where      Architecture "Serving a request" (assets "as bytes"); page responses today send only
           cache-control, content-type and nosniff (src/service/static_servers.js:756-763, :1715-1720)
```

**What.** Page and asset responses carry no `Cross-Origin-Resource-Policy`, and nothing checks where a subresource request came from.

**Why.** A website can put `<img src="http://readme.lahe.localhost:7817/diagram.png">` or `<script src=".../data.js">` in its page. From onload or onerror it learns which names and files exist on Ken's machine, and it can run any script file as cross-site script inclusion. Firefox and Safari allow public pages to load loopback subresources; Chrome's Local Network Access asks first. Today the same is possible, but only against short-lived random ports. After this feature the address is fixed and the names are guessable.

**Fix.**

- Send `Cross-Origin-Resource-Policy: same-origin` on every page-route response, the 404 and 410 pages included.
- Where `Sec-Fetch-Site` is present, refuse `cross-site` non-navigation requests with a 403.
- Send `X-Frame-Options: DENY` or `frame-ancestors 'none'` on injected pages, so a website cannot frame a reviewed document and use clickjacking to post comments.

### SR9. A name points to a path, not a file

```
severity   important
kind       defect
where      Architecture "Serving a request" (worktree fallback: "Tree yes -> Page"); Data
           ("`file` is the real path"); brief requirement 13 (worktree copy);
           src/service/catalog_reader.js:570-597 (worktreeCandidate checks)
```

**What.**

- When the bound file is gone, the flow serves the main-checkout copy under the worktree file's name, with the bound review's token injected, and with the main checkout's folder as the asset root.
- Separately, if any bound file is deleted and something else is created at the same path, the name serves the new file with the old review's token.

**Why.**

- The fallback breaks "one name, one file". The main copy may already have its own name and review, so the same bytes are served at two origins with two tokens. The review's rail lands on content it never covered.
- Path reuse is worse in a shared or world-writable folder (`/tmp`, a shared project folder). Another user creates a file at the freed path, and their HTML runs with Ken's review token injected. It can then post comments into Ken's agent queue. D12 fences page text, but these are reviewer-channel items.

**Fix.**

- On fallback, 302 to the main copy's own name, minting it if needed, and leave its binding to the normal rules. Never inject the worktree name's review into another file.
- Reuse `worktreeCandidate`'s checks as they are: real path under the repo, no hidden segment, owned by the current user, a page by real extension. Run them per request, not once.
- Record the owner uid, plus device and inode, at bind time. Inject the rail only when the served file's owner is the helper's user. When the inode changed, serve read-only until the next `lahe review` re-binds.

### SR10. Old random-port origins stay valid forever

```
severity   minor
kind       risk
where      Architecture Data ("aliases"), Failure Modes ("Old open tabs on random ports... stops
           leftover page-server processes")
```

**What.** Reviews keep `http://127.0.0.1:<old port>` and `localhost:<old port>` in `origins` after the page servers are retired. The design moves the matching role to aliases but does not remove the auth role.

**Why.** Those ports are now free for any program, including Ken's next dev server. A page served there passes preflight and the origin half of D11 for an old review, leaving the token as the only factor. The one-time stop of leftover page servers signals pids from records. Without the start-instant check D11 describes, a recycled pid kills an unrelated process.

**Fix.** At migration, keep each old port origin as an alias (display only) and remove it from `origins` with `origin.removed`, which is loopback-only and already exists. For the leftover-server stop, reuse the health probe with id and instance, and signal only a process that answers as that server.

### SR11. Host routing details

```
severity   minor
kind       risk
where      Architecture "Serving a request"; src/service/index.js (OPTIONS handled before any
           routing; catalog matched on raw path)
```

**What and why.** The design names the routing table but not these rules, and each has a quiet failure:

- **Order.** `handle()` answers `OPTIONS` and matches catalog paths before anything else today. Host dispatch must come first, or a document Host gets CORS preflight answers and catalog path matching.
- **Grammar.** Accept exactly one label before `.lahe` or `.lahe.localhost`, lowercase, with port equal to the helper's own. Refuse a trailing dot (`x.lahe.`, a separate origin), nested labels (`a.library.lahe`), and labels starting `xn--` or with `--` in positions 3 and 4. The name rule must never produce those last two: a file named `xn--...` would show as a Unicode lookalike of another name in the address bar, which the brief calls the UI.
- **Escaping.** The 404 page repeats the requested name and the 410 page names the path. Both are attacker-influenced (Host via SR1, file names on disk), so HTML-escape them.
- **Listen addresses.** Listen on `127.0.0.1` and `::1` exactly. Never `::` or `0.0.0.0` to get both at once, which would expose every document to the local network.

**Fix.** Put these four rules in the architecture and pin each with a unit test.

### SR12. `sudo`, resolver file and login item hygiene

```
severity   minor
kind       risk
where      Architecture "`.lahe` on macOS", "Login item per system"
```

**What and why.**

- The resolver write is the one root step. If it is built with shell interpolation, a port or path from config becomes root command input.
- `lahe uninstall` deleting `/etc/resolver/lahe` unconditionally removes a file Lahe may not own.
- Run under `sudo` as a whole, `lahe install` would write root-owned files into the home folder.
- An agent running `lahe install` in a terminal where Ken recently typed his password reuses `sudo`'s cached credential silently.
- Windows `schtasks` command lines built from a clone path with spaces or quotes can break, or be injected into.

**Fix.**

- Write the resolver file from a temp file with `sudo install -m 0644 -o root -g wheel`, using fixed text and an integer port. Add a marker comment, and have uninstall remove the file only when the marker matches.
- Refuse to run `lahe install` as root.
- Refuse it with no TTY, so agents cannot run it. The skill must say a person runs it.
- Quote the Windows task command with a tested quoting helper, and refuse clone paths with quote characters, as `catalog_reader.js` already does for candidate paths.
- Put nothing secret in the plist, unit or task.

### SR13. The aliases attribute

```
severity   minor
kind       risk
where      Architecture Data ("Script tag gains data-lahe-aliases"), "Page identity"
```

**What and why.**

- The aliases are JSON (quotes, file paths) placed in an HTML attribute on every injected page. A path holding `"` or `<` breaks out of the attribute if escaped by hand.
- Aliases come from "old page-server records". If a later change sources them from `meta.json`'s paths instead, a page could widen which items show as its own. Those paths are page-writable (SR2).

**Fix.**

- Build the attribute through the same escaper `protocol.scriptTag` uses.
- Cap the alias count and total length.
- Source aliases only from helper-owned server records.
- Keep aliases strictly a display filter inside one review, never an input to any auth check.

### SR14. Browser behaviour that is assumed, not checked

```
severity   minor
kind       risk
where      Architecture Failure Modes (browser skips the resolver); alternatives ("Pages call the
           API same-origin ... worth revisiting if Chrome's local-network rules")
```

**What.** The design assumes these, none of them shown:

- a page at a `.lahe` name that resolved to loopback counts as loopback for Chrome's Local Network Access, so its calls to `127.0.0.1:7817` need no prompt and no `Access-Control-Allow-Private-Network` header;
- Chrome's built-in DNS client honours `/etc/resolver`;
- `.lahe.localhost` is a secure context in Safari.

**Why.** If any of these is wrong, a builder will reach for a security relaxation to make the page work. Examples: adding `Access-Control-Allow-Private-Network: true` to every preflight, or widening which origins pass.

**Fix.** Add browser-walk rows in Chrome, Firefox and Safari for each assumption, run before the build commits to `.lahe` as the printed ending. Write down in advance that a failure means printing `.lahe.localhost` for that browser, not loosening a check.

## What holds up

- Keeping the API on loopback Hosts only, and keeping `review.write`'s loopback-only origin rule, is right. So is keeping the Library's exact-Host, same-origin and token checks.
- Moving page serving into the helper removes the per-server Host-check gap (`LAHE-static-server-host-check`) and the port-history origin swapping.
- Per-name origins do separate storage and tokens better than shared `127.0.0.1` ports did, including cookies, which ports never separated. SR3 is about file contents, not storage.

## Cleanup needed

Nothing. This review created only this file.
