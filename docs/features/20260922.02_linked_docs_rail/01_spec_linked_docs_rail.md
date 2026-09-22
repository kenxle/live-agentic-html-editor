# Keep the editor when you follow a link

## Summary

Clicking a link on a reviewed page to a document in another folder opens it read-only, with no editor. That breaks the rule set on 2026-09-16: anything our own static server serves gets the editor. This spec closes the gap for linked documents. No new review is created by a click. The linked page uses the review the document already has in this session, or else the review of the page you came from.

## Your calls: where the security review narrows your rule

Your rule is that anything our own server serves gets the editor. The security review keeps that for every page you reach by clicking a link, and narrows it in two places. Each needs a yes or no from you.

1. **Pages you did not click to, sitting in a linked folder, stay without the editor.** When a page links to a file in another folder, the server opens that whole folder so the link works. The review puts the editor only on the files a link actually points to, not on their neighbours. Why: the editor's key would otherwise reach every page in any folder a document happens to link into. Say no, and every page in a linked folder gets the editor.
2. **If the review you came from has been deleted, the linked page opens read-only.** It does not borrow some other review's key. Why: that other review may belong to a different document, so your comment would land somewhere you did not expect. Say no, and it falls back to the newest review on that server.

Separately, and not a narrowing: a linked document that already has its own review now takes you to that review's page, instead of opening a copy with its key. You get your earlier comments that way. It also found a leak that exists today, where hidden files like `.env` in a linked folder can be fetched from the page server. That is being fixed now on its own, without waiting for this spec.

## Problem

- A reviewed Markdown page can link to a document outside its own folder. The server makes those links work by mounting the target's folder read-only, under `/.lahe-source/<hash>/`.
- Pages under a mount are served on purpose with no editor. The code says so in `src/service/static_servers.js` (`renderMarkdown` and the `roots: ownRoot ? ... : []` line).
- The 2026-09-16 rule in `docs/ongoing/STATIC_SITE_FOLDER.md` says anything our own server serves gets the rail. A mounted page is served by our own server, so it should have the rail.
- Real case: the memory audit hub links to the draft write-cost spec. The spec already had its own review, in the same agent session, on the same server. The click still landed on a read-only copy.

## Requirements

1. **A linked document that has a review in this session opens that review's own page.** Match on the review's `source_path` (for Markdown) or its target paths (for HTML), resolved to real paths. The server answers the mount URL with a redirect to the page that review already serves (for Markdown, its rendered artifact, which lives on the same server as every other Markdown review in the session). It does not inject that review's token into the mount URL. Why:
   - The rail shows a page only the items whose page path matches. Earlier comments were made on the artifact's path, not on `/.lahe-source/<hash>/<file>.md`, so injecting there would show none of them.
   - The mount render adds a read-only note the artifact does not have, so anchors can differ.
   - If that review is served by a different server in this session, injecting its token here would fail the helper's origin check, and making it pass means writing a new origin onto that review. That is a write to the review store, which requirement 3 forbids, and it widens that review's token to this server's whole origin.
   - The artifact already reloads on change, so requirement 7 comes free for this case.
   If the matching review's server is not running, fall through to requirement 2.
2. **A linked document with no review in this session opens with the review of the page that linked to it.** This is the same rule a folder review already uses for pages nobody recorded: no new review, no write to the review store. The item records the linked document's real path on disk, so the agent knows which file to edit. "The page that linked to it" means a review that registered this mount (see Approach). If none of those reviews still exists in this session, or every one of them is `--only`, the page stays read-only. It never falls back to "any newest review on this server".
3. **Nothing is created by a click.** No new review, no new meta.json, no enrollment. This keeps the 2026-09-16 lesson: per-page enrollment made 166 reviews that never got a comment.
4. **Another agent session's review never answers.** A linked document that has a review only in another session gets the linking page's review from this session, never the other session's token.
5. **The existing mount limits stay, and the serve side is made to match them.** The link rules today: only documents the rendered page links to, inside the home folder, no hidden folders, at most 16 auto mounts per server. But a mount serves the linked file's whole folder, with its subfolders and its hidden files (`/.lahe-source/<hash>/.env` is answered today). So "only documents the page links to" is true of the link, not of what the server hands out. Before the rail goes on:
   - Refuse any path under a mount with a hidden segment (the same rule `markdown_links.js` applies to the link).
   - Put the rail only on files a render actually translated a link to. Record those real paths with the mount. Other HTML in a mounted folder is served as it is today, with no rail.
   - A review opened with `--only` keeps its linked documents read-only, as today.
6. **The agent can act on it.** An item made on a linked page names the source file on disk, not the `/.lahe-source/` URL, in `review.json` and in the drain. An edit made there lands in the right file when the agent edits and replies. **The helper works out that path; the page never supplies it.** The helper maps the item's page path through this session's static server mount table (read off disk, the same way the static server does), checks the result is inside the mount's folder by real path, and records it. A path in a request body is never used as the file to edit. This is a change to what `review.json` says, so the contract text, `docs/CONTRACTS.md`, the copy in `test/unit/review_format.test.js`, the skill, and the dist bundle change together.
7. **The linked page updates when its source changes**, the same way a reviewed page does, so a handled item shows the change without a manual reload. If that turns out to need more than the existing watcher, say so in progress rather than building a new watcher. Today's poll gets this wrong in a specific way: for a single-page review, `targetForPage` in `src/service/reviews.js` maps any page path to the one recorded target, so a linked page would reload when the hub changes and never when itself changes. Use the same page-path-to-file mapping as requirement 6, and stat only: never heal a script line into a linked file on disk.

## Approach

The design call is which review a linked page uses, and why not a new one.

- **Chosen:** reuse. First the document's own review in this session (requirement 1, by redirect), else the linking page's review (requirement 2). The linking page is known from the mount: a mount is registered by rendering one page, so the server records which review's page registered it. If the mount was registered by more than one reviewed page, the newest of those registering reviews wins. Two registration paths must both record it: the server's own render (`persistAutoMounts`), and `lahe review` calling `registerMount` for a Markdown review's own folder and its links. `registerMount` merges the on-disk metadata before it writes, and the new field needs the same merge, or a later `lahe review` wipes it. A chain (hub links B, B links C) rides the hub's review, since B's render registers C's folder while serving under the hub's review. That is intended, and bounded by the 16-mount cap per server.
- **Read from disk, not from the request.** The linking page is never taken from the `Referer` header or anything else the browser sends.
- **Rejected: open a new review on first click.** It gives every linked document its own comment list, but it means the static server writes to the review store, and it recreates the empty-review pile the folder work removed.
- **Rejected: keep mounted pages read-only.** That is the bug.

Security: the key (token) that lets a page send comments now reaches linked documents. Settled in review:
- **HTML and Markdown are treated the same.** Every page this server hands out shares one web origin (`127.0.0.1:<port>`), mounts included. A script on any of them can already fetch the reviewed page and read the token off it, today, before this change. So keeping the rail off mounted HTML would protect nothing. The real limit is what the server is willing to serve under a mount, which is why requirement 5 tightens that side.
- **Rendered Markdown can carry raw HTML**, including a script tag, so "Markdown only" would not have been a script-free zone either.
- **The token stays on this server's origin.** Requirement 1 redirects instead of carrying another review's token over, so no origin is added to any review.
- **The file an agent edits is worked out by the helper** (requirement 6), never claimed by the page.
- **D11's residual gets one more sentence**: a review's token is also readable on documents its pages link to, in folders mounted for those links. Add it in the same commit as the code.
- **Known gap this makes a little worse, not fixed here:** `review.write` accepts `source_hint`, `target_path`, and `source_path` from anyone holding the token (`src/service/routes.js`), and `source_hint` is what `review.json` tells the agent the source file is. A hostile script on any served page can use it to point the agent at another file. That is true today for every served page. It needs its own board row: refuse those three fields when the request carries a browser `Origin` header, since `add` sends none.

## Tasks

1. `static_servers.js`: when a mount registers, remember which review's render registered it, and the real paths of the files it translated links to. Both registration paths (render and `registerMount`), merged like `auto_mounts`. Tests: a mount registered by review A records A; a mount registered by two reviews keeps both and the newest wins; a `lahe review` run after a render keeps the render's record.
2. `static_servers.js` `renderMarkdown` and the HTML path: for a request under a mount, refuse hidden segments; if a review in this session records this file, redirect to that review's page; else, if the file is a recorded link target, inject the registering review's rail; else serve plain. Tests: requirement 1 redirect, requirement 2 case, other-session review ignored (requirement 4), `--only` stays read-only (requirement 5), registering review gone gives read-only, an unlinked HTML sibling in the mounted folder gets no rail, `/.lahe-source/<hash>/.env` refused, a file outside the mount limits still refused.
3. The helper maps an item's page path to the real file through the mount table (requirement 6). Tests: an item made on a linked Markdown page shows the source path in `review.json` and in `lahe status --json`; a page path naming a mount prefix the server does not hold, or `..` out of a mount, records no file.
4. Reload on source change for linked pages (requirement 7), or a written note of what it would take.
5. Docs: `docs/ongoing/STATIC_SITE_FOLDER.md` (the rule now reaches linked documents), `docs/CLI.md` where `--only` is described, and the skill if an agent's steps change. A browser spec clicking from a reviewed page to a linked one and leaving a comment, with a screenshot of the rail on the linked page.

## Acceptance criteria

- [ ] Clicking from the hub to the draft write-cost spec opens it with the editor and its earlier comments.
- [ ] Clicking to a linked document with no review opens it with the editor, and a comment there lands in the linking page's review with the linked file's path.
- [ ] No review, meta.json, or enrollment is created by a click.
- [ ] Another session's review is never used.
- [ ] `--only` reviews keep linked documents read-only.
- [ ] A hidden file under a mount is refused, and an HTML file in a mounted folder that no page linked to gets no rail.
- [ ] The file named on an item comes from the helper's mount lookup, never from the request body.
- [ ] The drain names the source file for an item made on a linked page.
- [ ] `npm run gate:unit` green; the named browser spec green; screenshot on this page.

## Progress

(none yet)

## Security review, 2026-09-22

Accepted the reuse design, with four changes: redirect to a document's own review instead of injecting its token; make the serve side of a mount match its link rules (no hidden files, rail only on linked files); the helper, not the page, names the file to edit; the reload uses that same mapping and never heals.
Rejected "Markdown only" as protection that does nothing, since every served page shares one origin; the `review.write` source-hint gap is recorded as its own row rather than fixed here.
