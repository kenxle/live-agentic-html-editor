# Keep the editor when you follow a link

## Summary

Clicking a link on a reviewed page to a document in another folder opens it read-only, with no editor. That breaks the rule set on 2026-09-16: anything our own static server serves gets the editor. This spec closes the gap for linked documents. No new review is created by a click. The linked page uses the review the document already has in this session, or else the review of the page you came from.

## Problem

- A reviewed Markdown page can link to a document outside its own folder. The server makes those links work by mounting the target's folder read-only, under `/.lahe-source/<hash>/`.
- Pages under a mount are served on purpose with no editor. The code says so in `src/service/static_servers.js` (`renderMarkdown` and the `roots: ownRoot ? ... : []` line).
- The 2026-09-16 rule in `docs/ongoing/STATIC_SITE_FOLDER.md` says anything our own server serves gets the rail. A mounted page is served by our own server, so it should have the rail.
- Real case: the memory audit hub links to the draft write-cost spec. The spec already had its own review, in the same agent session, on the same server. The click still landed on a read-only copy.

## Requirements

1. **A linked document that has a review in this session opens with that review.** Match on the review's `source_path` (for Markdown) or its target paths (for HTML), resolved to real paths. The reviewer sees the editor with that document's own earlier comments.
2. **A linked document with no review in this session opens with the review of the page that linked to it.** This is the same rule a folder review already uses for pages nobody recorded: no new review, no write to the review store. The item records the linked document's real path on disk, so the agent knows which file to edit.
3. **Nothing is created by a click.** No new review, no new meta.json, no enrollment. This keeps the 2026-09-16 lesson: per-page enrollment made 166 reviews that never got a comment.
4. **Another agent session's review never answers.** A linked document that has a review only in another session gets the linking page's review from this session, never the other session's token.
5. **The existing mount limits stay.** Only documents the rendered page actually links to, inside the home folder, no hidden folders, at most 16 folders per page. A review opened with `--only` keeps its linked documents read-only, as today.
6. **The agent can act on it.** An item made on a linked page names the source file on disk, not the `/.lahe-source/` URL, in `review.json` and in the drain. An edit made there lands in the right file when the agent edits and replies.
7. **The linked page updates when its source changes**, the same way a reviewed page does, so a handled item shows the change without a manual reload. If that turns out to need more than the existing watcher, say so in progress rather than building a new watcher.

## Approach

The design call is which review a linked page uses, and why not a new one.

- **Chosen:** reuse. First the document's own review in this session (requirement 1), else the linking page's review (requirement 2). The linking page is known from the mount: a mount is registered by rendering one page, so the server records which review's page registered it. If the mount was registered by more than one reviewed page, the newest review on this server wins, matching the folder rule.
- **Rejected: open a new review on first click.** It gives every linked document its own comment list, but it means the static server writes to the review store, and it recreates the empty-review pile the folder work removed.
- **Rejected: keep mounted pages read-only.** That is the bug.

Security: the key (token) that lets a page send comments now reaches linked documents. The exposure is the same kind the folder review already accepted under D11: the token is readable by any page the server gives the rail to. The mount limits bound which pages those are. The security review should confirm that a mounted HTML page (not only Markdown) carrying the linking page's token is acceptable, or say it should stay Markdown only.

## Tasks

1. `static_servers.js`: when a mount registers, remember which review's render registered it. Tests: a mount registered by review A records A; a mount registered by two reviews keeps both and the newest wins.
2. `static_servers.js` `renderMarkdown` and the HTML path: for a request under a mount, look up a review in this session whose source or target is this file; else use the registering review; inject the rail for the match. Tests: requirement 1 case, requirement 2 case, other-session review ignored (requirement 4), `--only` stays read-only (requirement 5), a file outside the mount limits still refused.
3. Item page path for a mounted page carries the real source path (requirement 6). Tests: an item made on a linked Markdown page shows the source path in `review.json` and in `lahe status --json`.
4. Reload on source change for linked pages (requirement 7), or a written note of what it would take.
5. Docs: `docs/ongoing/STATIC_SITE_FOLDER.md` (the rule now reaches linked documents), `docs/CLI.md` where `--only` is described, and the skill if an agent's steps change. A browser spec clicking from a reviewed page to a linked one and leaving a comment, with a screenshot of the rail on the linked page.

## Acceptance criteria

- [ ] Clicking from the hub to the draft write-cost spec opens it with the editor and its earlier comments.
- [ ] Clicking to a linked document with no review opens it with the editor, and a comment there lands in the linking page's review with the linked file's path.
- [ ] No review, meta.json, or enrollment is created by a click.
- [ ] Another session's review is never used.
- [ ] `--only` reviews keep linked documents read-only.
- [ ] The drain names the source file for an item made on a linked page.
- [ ] `npm run gate:unit` green; the named browser spec green; screenshot on this page.

## Progress

(none yet)
