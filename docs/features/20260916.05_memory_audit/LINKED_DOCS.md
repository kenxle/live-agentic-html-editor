# Keeping the editor when you follow a link

**Short version:** clicking a link to a document in another folder opens it read-only, with no editor. That was a deliberate security choice. I propose two changes, and the first one does not touch security at all. I need a yes or no on each.

## What happened

You clicked from the memory audit hub to the draft write-cost spec. The hub lives in `docs/features/20260916.05_memory_audit/`. The spec lives in `docs/features/...`. The server only puts the editor on pages inside the folder it was started for. A link out of that folder opens a plain read-only copy.

The reason is the editor's token. It is the key that lets a page send comments to the helper. A security review on 2026-09-16 kept that key inside the folder you opened, so a link could not hand it to an unrelated file.

The odd part: the spec already has its own review, in the same agent session, on the same server. The link just did not know that.

## Proposal

1. **A link to a document that already has a review in this session opens that review's page.** You get the editor, with your earlier comments on it. No new key goes anywhere: that page already has one. This fixes the case you hit.
2. **A link to a document with no review opens one for it, in the same session, on first click.** You keep the editor everywhere a link takes you. This one does widen where a key lands, so it gets a security review before it is built. The existing limits still apply:
   - only documents the page you are on actually links to
   - only inside your home folder, never a hidden folder
   - at most 16 folders per page

Links to documents in another agent's session stay read-only either way. Sessions do not see each other's comments.

## Your call

- Build 1 now?
- Build 2 as well, after a security review of the spec?

Until then, the spec's own page with the editor is: http://127.0.0.1:56458/01_spec_draft_write_cost-1f5f8917884b9ad3.html

## Where this stands, 2026-09-28

Both calls above are answered, and the work is specified but not built.

- Ken said yes to 1 and yes to 2, and added a rule of his own: no empty reviews.
- The spec is `docs/features/20260922.02_linked_docs_rail/01_spec_linked_docs_rail.md` on branch `linked-docs-rail`. It is not on main.
- It has been through a security review. Two findings from that review are their own rows: `source_hint` from a browser (hub row 19) and the page server's own folder still serving hidden files (hub row 21, board row `LAHE-server-root-hidden-files`).
- Board row: `LAHE-linked-docs-rail`.

The last line above names a page address from the day this was written. Those addresses die with the helper that served them; it is kept only as the record of what was open at the time.
