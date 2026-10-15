# Spec: a review follows its document out of a worktree

## Summary

When a worktree is removed, the documents reviewed in it still exist in the main checkout at the same path. Today their review stays behind: serving the main copy starts a new, empty review, and even a review re-attached by hand shows an empty rail. After this change, the main copy continues the old review, and every earlier card (open and done) shows on its page. The old address sends the browser to the new one when the new page carries that review. The Library opens the main copy with its rail.

**Ken's calls** (each has a default, so building is not blocked):

- **Q1, a security trade-off.** Library Open on a moved document gives the main copy an address and the old review's rail, with no agent involved. The default is yes, within the limits in "Trust".
- **Q2.** When the main copy already has a newer review, which review gets the page? The default: the newer review keeps the page only if it holds comments on the document. If it holds none and the old review does, the old review gets the page. See R8.

## 1. Problem, user and context

Ken reviews a feature's progress page while the feature is built in a git worktree. His comments live in that review. When the feature lands, the worktree is removed, and the same file now lives in the main checkout. His words on a card:

> why can't we copy the review over from the worktree? why do we have to start a new one? for the same doc, i prefer to have access to my earlier comments and not lose them just because we moved out of the worktree and onto main.

What happens today:

- **The old address** (`docs.features.<folder>.lahe.localhost`) shows the main copy read-only, with a "This file's worktree is gone" note and no rail.
- **`lahe review <main copy>`** makes a new review at a new address (`live-agentic-html-editor.docs.features.<folder>.lahe.localhost`), with none of the old comments.
- **Re-attaching by hand** with `--review <old id>` puts the old review on the page, but the rail shows "Active 0, Done 0". This is Ken's state now: review `r183d18583a43` has the main path added to its recorded paths, the newer review `rb653ac6496cf` is retired, and the session is open. The cards are missing because `fileForPageIn` resolves the worktree address to the worktree path, which is gone. So `records.read`, the page's spellings, the handled check and the reload check all leave those records out.
- **The Library's Hand to agent fails on these rows.** A row whose worktree site the registry saw is kind `worktree` with no `candidate`. Launch is refused (`PROTO_NO_LAUNCH`), and Pick this up ends in `lahe library serve` refusing. An older row the registry never saw is served in the agent's own session, which makes a new review.

The root cause is one missing fact: nothing in Lahe says "this file in a gone worktree is now that file in the main checkout". Every check compares paths, and the two paths differ.

## 2. Requirements

**R1. When a worktree is gone.** A site's worktree is gone when its root is not on disk and git agrees: the worktree's admin folder (`<main>/.git/worktrees/<name>`) is missing, or its `gitdir` file names a file that does not exist. A worktree that was moved or renamed (`git worktree move`), or whose admin folder still names an existing worktree, is not gone. The site saves the admin folder's path when it is bound. A site bound before this change has no saved admin folder, so the check looks for the admin folder whose `gitdir` names the worktree, then for the one named after the worktree's folder.

**R2. Which main checkout is trusted.** The site saves the main checkout's real path when it is bound. At use, every one of these must hold, or there is no move:
- the main checkout's real path today equals the saved one;
- `<main checkout>/.git` is a folder;
- the main checkout is inside the home folder and outside Lahe's state folder;
- the twin root (the main checkout plus the site root's path inside the worktree) has a real path inside the main checkout's real path.

**R3. Same document.** A file is the same document as a file in a gone worktree when:
- the gone file is under the root of a registry site whose worktree is gone (R1, R2), the site's own root and not just its worktree;
- the main checkout has a regular file at the same path under the twin root;
- that file's real path is inside the twin root's real path (a symlink that leaves the twin root does not count) and outside the state folder.

**R4. One rule, one place.** One function in `page_routes.js` answers R1 to R3. Its inputs are the registry, the home folder and the state folder. The read-only fallback (`mainCheckoutCopy`), the Library's `worktreeSiteFor`, and every check below use it, so none of them can disagree.

**R5. One seam for records.** `fileForPageIn` uses R4: for a site whose worktree is gone, a page path whose file is missing names the main copy. `fileOfItem`, `pageRecords`, `spellingsFor`, the handled check (`handled_check.pageFilesFor`) and the reload check (`reviews.targetMtime`) all go through it.

**R6. The file's review.** A review that recorded a gone worktree file holds its main copy. `holderOfFile` tier 1, `pickReview` rule 1, `ownReviewOf` and the Origin check (`reviewAnswersOnSite`) all count it. The Origin check tries the direct match first and asks R4 only when that fails.

**R7. `lahe review` continues the old review.** `lahe review <main copy>` finds the old review as the file's review and makes no second one.
- In the review's own open session, it continues that review: it passes `--review <old id>`, and `add` records the main path. A recorded source that is no longer on disk is replaced by the main copy as the review's first source (`recordPaths`). The old path stays in the list.
- In another session's review, it does what it does for any file with another session's review: it gives the main copy its address, says whose review it is, and moves nothing. The immutable-owner rule stands.
- When the owning session is closed, the rail on the main copy still shows the old review, and it shows no agent watching. The command says nobody is listening and names `lahe session takeover <owner>`, which reopens the session. The agent runs it only when Ken asks, then runs `lahe review <main copy> --session <owner>`.
- `--new` on such a file is refused with "already has a review".

**R8. A direct review and a moved review on the same file.** Both are tier 1. The newest review that holds committed comments on the file wins. If no tier-1 review holds any, the newest wins, as today. Stamps cannot flip this: re-serving an empty review does not take the page from one with comments. The rule runs only when a moved review is among the candidates, so ordinary pages are unchanged. The losing review's cards show read-only on the rail, named by title and agent. `holderOfFile` and `pickReview` share the rule, so `lahe review`, Library Open and the page always agree.

**R9. The earlier cards show.** On the main copy's page the rail shows every committed record the old review made on the worktree file, open and done. They come over through `records.read` and the page's spellings, the path old-port comments already use. Drafts never come over.

**R10. The agent reads the new path.** In `review.json`, a page group whose source hint names a gone worktree file names the main copy instead. The Library reader and the projection prefer a recorded source that exists.

**R11. The old address.** A top-level page load of the old address redirects (302) to the main copy's own address only when `pickReview` on the main copy picks a review that holds the gone file. The redirect target is built only by `ownAddressOf` from the registry, never from the Host or the request. Otherwise the old address shows the main copy read-only with no script tag. Its note names the review that holds the copy, when one does, by title. It never prints a shell command or a path inside a command. It tells Ken to open the document from the Library to keep commenting.

**R12. The Library: a moved document is an ordinary document.** A row whose recorded file is gone and whose main copy meets R3 becomes kind `static`, openable, at the main copy, with `moved: true`. The row says: "Moved from a worktree that is gone. Your comments came with it."
- Open, Pick this up and Launch a new agent work as for any static row. Pick this up and Launch take the session over. No path goes into a hand-off message.
- Before any of the three, the helper gives the main copy its address, as Open does (R13), and records the main path on the review when it is the file's review.
- The ownership check (`siteOwnedByUser`) runs on the main copy and the plan's root, never skipped.
- Two reviews of the moved document in one session fold into one row (the document key is the main copy).
- Unread replies on a moved row count again in the menu bar summary, since the main copy's page now shows them.
- A row whose main copy fails R3 keeps today's behavior.

**R13. What Library Open may bind (Q1).** A row's recorded path is page text: a page holding the review's token can set it through `review.write`. So a moved plan is vouched only when the gone path is under a registry site's own root, and the main copy is under that site's twin root (R3). Open binds a new site only at a folder inside the twin root, and nowhere else. An existing site that already holds the main copy is used as it is.

**R14. Lookup cost.** The list of gone worktree sites is built at most once per request, with one existence check per worktree site. Only paths under a gone site's root are translated. A measured check on a made-up state folder shaped like Ken's (about 700 reviews) shows a page load costs about the same as before.

**R15. The docs say how it works now.** `docs/ongoing/STABLE_ADDRESSES.md`, `docs/ongoing/LIBRARY.md`, `docs/CONTRACTS.md` (the list's `moved` field and kinds), `docs/CLI.md` (`lahe review`) and `docs/diagrams/merge_on_load.md`. The stable-addresses brief and architecture are history and stay as they are.

## 3. Approach

### The design call

**Compute the move when it is asked about, from the registry. Record the main path at the trusted moments.** The registry already holds the trusted pair (worktree root and main checkout), checked against git when the site was bound. One function (R4) turns a gone worktree path into its main-checkout copy. Six places use it: `fileForPageIn` (R5, which fixes "Active 0, Done 0"), `holderOfFile`, `pickReview`, `ownReviewOf`, the Origin check, and `serveGone`.

At the two moments a person or a CLI-proven command acts (`lahe review` in the owning session, Library Open or hand-off), the main path is recorded on the review. From then on the review matches the main copy directly and the move function is no longer needed for it.

The Library side: `catalog_reader.placeRow` builds a static plan on the main copy, `catalog_sites` vouches for it only under R13, and `catalog_actions` binds it and records the path.

### Alternatives rejected

- **Copy the review's records into a new review.** Two reviews of one document, with ids the agent has never seen. It breaks "one review per file" and the agent's record of what it answered.
- **Point the old site at the main checkout.** The main copy often has its own site already (Ken's does), so this makes two names for one file. It also changes the root a name serves, which the stable-addresses security review ruled out (SR9).
- **Give the old address a rail on the main copy.** That puts a review token into a file nobody bound, which the stable-addresses architecture forbids. The redirect gives the same result.
- **Record a document identity (repository plus relative path) on each review.** It would make the match exact and cheap. But every existing review, Ken's included, lacks it, so the move would still need computing for them. Recording the main path at the trusted moments gets the same speed for each review after its first move.
- **Write a "moved" event when the worktree goes.** Nothing notices the moment a worktree is removed, and another session's review is not this command's to write to.
- **Fix only `lahe library serve` for worktree rows.** That keeps a special path for these rows. A moved row as an ordinary static row reuses Open, the takeover and the hand-off, with no change to the skill or the contract text.
- **Show a main copy that looks older than the comments read-only** (architecture finding A6). Git sets a file's time when it checks the file out, so an old time also marks a document the branch never changed, which is identical and safe. The risk is real: if the branch was not merged, the main copy is the older text. Replay already handles it: a card whose words are not on the page shows that it cannot find them. A test with a changed main copy proves this.

### Trust

- **Which file may be bound.** The old address never binds or injects (R11). The main copy gets a rail only from a site that `lahe review` bound (the CLI secret) or that Library Open bound under R13.
- **Page text reaches the plan.** A Library row's path comes from `meta.target_path` or `source_path`, which a page holding the token can set. R13 confines what that can do: the path must be under a site the helper itself served, and the copy under that site's twin. Open never binds outside the twin.
- **The main checkout is proven twice.** At bind, from the worktree's `.git` file and the main checkout's back-link (`linksBack`). At use, by R2: the saved real path still matches, the `.git` folder is there, and the folder is in the home folder and outside the state folder. A crafted pair of folders that passes the back-link check fails at least one of these, or is a folder Ken owns and could serve anyway.
- **Containment is one rule.** R3, the stricter of the two the reviews named, with the state folder as an input.
- **The contents are not compared.** Git proves the repository and the path, not the text. The main copy is usually the merged version and may differ. Replay anchors each card, and a card that cannot find its words shows it.
- **Tokens.** No new token and no new credential. The page gets the old review's own token. The Origin check accepts the main copy's site for that review only by R6.
- **Immutable owner.** No review changes session. Another session's review is opened, never moved (R7). Continuing it needs `lahe session takeover`, which Ken asks for.

### Out of scope

- Reviews from before stable addresses, whose worktree site the registry never saw (old `127.0.0.1:<port>` page servers). Their rows keep today's `worktree` and via-agent behavior.
- Folder reviews of a whole worktree folder (tier 2). `servedRootsOf` drops a gone root, so a folder review does not follow its folder. A single file reviewed inside it does.
- Unsent drafts typed at the old address. They live in that address's browser storage, and `records.read` never carries drafts.
- A worktree that still exists. Its file and the main copy are two documents until the worktree is removed.

## 4. Tasks and verification

Two slices in one branch. Slice 1 is what Ken asked for. Slice 2 is the Library. If slice 1 ever lands alone, its old-address note must not send Ken to Library Open, which is still read-only until slice 2.

**Slice 1: the review follows the document**

1. `sites.js`: at bind, save the main checkout's real path and the worktree's admin folder (R1, R2).
2. `page_routes.js`: the move function (R1 to R4), used by `mainCheckoutCopy` and `fileForPageIn` (R5).
3. `page_routes.js`: use it in `holderOfFile`, `pickReview`, `ownReviewOf` and `reviewAnswersOnSite`, with the R8 rule shared by the first two (R6, R8). The helper passes its registry to the Origin check.
4. `review.js`: pass `--review <old id>` for a holder found through a move. `reviews.recordPaths`: replace a gone first source (R7).
5. `review_format.js` and `projection.js`: map a gone source hint to the main copy, with the map computed by the helper (R10).
6. `serveGone`: the redirect and the new note (R11).
7. `scripts/measure_moved_lookup.js`: the measured check (R14).
8. Docs: `STABLE_ADDRESSES.md`, `CLI.md`, `merge_on_load.md` (R15).

**Slice 2: the Library**

9. `catalog_sites.js`: `worktreeSiteFor` and a moved plan through the move function, vouched only under R13.
10. `catalog_reader.js`: a moved row is static, openable, `moved: true`, keyed on the main copy; prefer an existing source (R10, R12).
11. `catalog_actions.js`: bind and record before Open, Pick this up and Launch; run the ownership check on the main copy (R12, R13).
12. `view_model.js`: the "Moved" note. `summary.js`: count a moved row's replies (R12).
13. Docs: `LIBRARY.md`, `CONTRACTS.md` (R15).

Every fixture builds a fake main checkout with `.git/worktrees/feature/gitdir`, a worktree whose `.git` file points back, and then removes the worktree the way git does: it moves the worktree folder and the admin folder aside (renamed, never deleted).

| Behavior | Failure case | Test that proves it |
| --- | --- | --- |
| R1, R3: the move function returns the main copy for a gone worktree file | worktree on disk; worktree moved (admin folder names an existing file); main copy missing; a file outside the site root but inside the worktree; each returns null | `test/unit/review_follows_document.test.js` (new) |
| R2, R3: containment | a copy reached through a symlink that leaves the twin root; a twin root that is a symlink out of the main checkout; a saved main checkout whose path is now a symlink; `.git` not a folder; a main checkout outside home or inside the state folder; each returns null | same file |
| R1: a site bound before this change (no saved admin folder) still finds its admin folder | | same file |
| R5: an item made at the old address names the main copy (`fileForPage`) | a site whose worktree exists is unchanged | same file |
| R5: the agent edits the main copy and replies handled to an old edit card; the handled check gives a real verdict | not "cannot tell" | same file |
| R6, R7: `holderOfFile(<main copy>)` names the old review; `lahe review <main copy> --session <owner>` continues it, records the main path and replaces the gone first source; no new review folder | a retired old review is not named; from another session it prints the owner and makes nothing; `--new` is refused | same file, running the CLI against a temp state folder |
| R7: closed owner | `lahe review` names the takeover; the rail's liveness shows no agent | same file |
| R6: the Origin check accepts the main copy's site for the moved review | an unrelated site is refused | same file |
| R8: Ken's state. A newer review on the main copy with no comments, and the old review with comments re-attached by hand with `--review`: the old review wins in `holderOfFile` and `pickReview`, and re-stamping the newer one does not flip it | a newer review that holds comments keeps the page; the old one's cards show read-only | same file |
| R9: `records.read` at the main address returns the old records, open and handled, and the script tag's spellings name the old address | drafts never return | same file |
| R10: `review.json` names the main copy as the source for the old cards' page group | | same file |
| R11: a top-level load of the old address is a 302 to the main copy's address, built from the registry | no redirect without both Fetch Metadata headers, or when the main copy's page picks another review (then the note names that review); the note holds no shell command even when the path holds `$(` or a backtick | same file |
| R11: no site holds the main copy: read-only with the note, no script tag | | `stable_addresses_sites.spec.js` V20, updated for the new note |
| End to end, from the worktree: comment and mark one done, remove the worktree, run `lahe review <main copy>` in the same session; the rail shows Active 1 and Done 1, both cards on their words | | `test/browser/review_follows_document.spec.js` (new), light and dark screenshots |
| End to end, from the old address: load it, follow the redirect, the landing page shows Active 1 and Done 1 | | same spec |
| End to end, Ken's state: a newer empty review plus the old review re-attached with `--review`; the rail shows the old cards | | same spec |
| A6: the main copy's text changed under one card | that card shows it cannot find its words; the others anchor | same spec |
| R12: a moved row is static, openable, `moved: true`, at the main copy; Open binds inside the twin and records the main path; a launch hand-off has no path; two reviews in one session fold into one row | a row whose main copy fails R3 stays `worktree`; a forged `target_path` outside any registry site is not vouched | `test/unit/catalog_reader.test.js`, `test/unit/catalog_routes.test.js` |
| R12: a moved row's unread reply still waits in the menu bar summary | | `test/unit/menubar_summary.test.js`, the worktree case updated |
| R14: at most one existence check per worktree site per request; translation only under gone roots | | `review_follows_document.test.js` counts the checks; `scripts/measure_moved_lookup.js` times page loads spaced 2 seconds apart on a made-up folder of 700 reviews, with and without the move code, and the numbers go on the progress page |
| No leaked processes | | `ps -axo command \| grep -c "[l]ahe.js serve"` before and after, reported |

## 5. Acceptance criteria

- Ken opens his progress page at the main copy's address. He sees all his earlier cards, open and done, and he can comment and reply as before. His real state needs no extra step.
- His old link to the worktree address lands on the main copy's page with the rail.
- From the Library, the document shows once, marked as moved. Open opens the main copy with the rail. Pick this up and Launch a new agent hand the review over as they do for any document.
- No review changed session without a takeover, and no address served a review token for a file nobody bound.
- `npm run gate:unit` passes, the new browser spec and V20 pass, and the helper count after the tests equals the count before.

## Review findings

Two design reviews, security and architecture. All findings are folded in above.

**Accepted**

- S1, R13: the row's path is page text; a moved plan is vouched only under a registry site's own root, and Open binds only inside the twin.
- S2, A11, R3: one stricter containment rule, the twin root, with the state folder as an input.
- S3, R2: save the main checkout's real path at bind and check it again at use, plus the `.git` folder, home and state folder checks.
- S4, A12, R1: "gone" follows git's admin folder, not only the missing path.
- S5, R12: the ownership check runs on the main copy and plan root.
- S6, R11: the note names Library actions only, no shell command.
- S7, R11: redirect only when the main copy's page picks the moved review; the Location comes from the registry.
- A1, R8, Q2: the blocker. A review with comments beats a newer one without, so Ken's state works and stamps cannot flip it. Q2's default changed to match.
- A2, R5: the move lives in `fileForPageIn`, one seam for records, the handled check and the reload check.
- A3, R7, R10, R12: a gone first source is replaced; readers prefer an existing source; `review.json` names the main copy; the Library keys the row on the main copy and records the path at Open and hand-off. The review.json fix maps the hint in the projection instead of appending a `page.visited` event, because a page group's own hint outranks the review-wide one.
- A4, R14: built once per request, translation only under gone roots, a counted test and a measured script.
- A5, R7: the closed-owner path is described and tested.
- A7: the missing rows are in the table.
- A8, R6: `ownReviewOf` uses the same rule.
- A9: folder reviews of a whole worktree folder are out of scope, stated.
- A10: the slice 1 note does not send Ken to Open; `summary.js` counts moved rows again, with the test updated.
- A13: the identity alternative is listed, and the main path is recorded at the trusted moments.

**Rejected, in part**

- A6: no read-only guard by file time, because git's checkout times mark unchanged documents as old too. The risk is stated, and a test proves a changed main copy shows the cards that cannot find their words.
- A4's method: the lesson asks for a copy of the real state folder and 10-minute idle windows. The tests may not touch the real state folder, and this lookup runs on page loads, not on a poll. So the measured check uses a made-up folder of the same shape and page loads spaced 2 seconds apart, and states that limit beside its numbers.
