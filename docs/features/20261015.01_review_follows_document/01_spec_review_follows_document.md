# Spec: a review follows its document out of a worktree

## Summary

When a worktree is removed, the documents reviewed in it still exist in the main checkout at the same path. Today their review stays behind: serving the main copy starts a new, empty review. After this change, serving the main copy continues the old review, and every earlier card (open and done) shows on the new page. The old address sends the browser to the new one. The Library opens the main copy with its rail.

**Ken's calls** (each has a default, so building is not blocked):

- **Q1, a security trade-off.** Should Library Open bind the main copy's folder with no agent involved? Default: yes. See "Trust" below.
- **Q2.** When the main copy already has a newer review of its own, which review wins the page? Default: the newest, as today. The other review's cards show read-only. See R8.

## 1. Problem, user and context

Ken reviews a feature's progress page while the feature is built in a git worktree. His comments live in that review. When the feature lands, the worktree is removed, and the same file now lives in the main checkout. His words on a card:

> why can't we copy the review over from the worktree? why do we have to start a new one? for the same doc, i prefer to have access to my earlier comments and not lose them just because we moved out of the worktree and onto main.

What happens today:

- **The old address** (`docs.features.<folder>.lahe.localhost`) shows the main copy read-only, with a "This file's worktree is gone" note and no rail.
- **`lahe review <main copy>`** makes a new review at a new address (`live-agentic-html-editor.docs.features.<folder>.lahe.localhost`). None of the old comments are there.
- **Re-attaching by hand** with `--review <old id>` puts the old review's script tag on the page, but the rail shows "Active 0, Done 0". The old cards are missing because the helper cannot tell that a record made at the worktree address is about the main copy. `fileOfItem` resolves the worktree address to the worktree path, which is gone, so `records.read` and the page's spellings leave those records out.
- **The Library's Hand to agent does not work on these rows.** A row whose worktree site the registry saw is kind `worktree` with no `candidate`. Launch is refused (`PROTO_NO_LAUNCH`), and Pick this up ends in `lahe library serve` refusing ("no main-repo copy passes the checks"). An older row the registry never saw is served with `lahe review <copy>` in the agent's own session, which makes a new review. Either way the old comments do not come along.

The root cause is one missing fact: nothing in Lahe says "this file in a gone worktree is now that file in the main checkout". Every check compares paths, and the two paths differ.

## 2. Requirements

**R1. Same document.** A file is the same document as a file in a gone worktree when all of these hold:
- a site in the registry recorded that worktree's root and its main checkout (the helper records both when it binds a site, from git's own back-link);
- the worktree's root is no longer on disk;
- the main checkout has a regular file at the same path relative to the checkout, and its real path stays inside the main checkout and outside Lahe's state folder.

**R2. One rule, one place.** A single function in `page_routes.js` answers "what main-checkout file is this gone worktree file now?". Every check below uses it. The read-only fallback (`mainCheckoutCopy`) and the Library's `worktreeSiteFor` use it too, so they cannot disagree.

**R3. `lahe review` continues the old review.** `lahe review <main copy>` finds the old review as the file's review (`holderOfFile`), as if the review had recorded the main path. It makes no second review.
- In the review's own session, it continues that review and records the main path on it (it passes `--review <old id>` to `add`). From then on the main path is the review's own.
- In another session's review, it does what it does for any file with another session's review: it opens it, says whose it is, and moves nothing. The immutable-owner rule stands. Continuing it needs a takeover, which the human asks for.
- `--new` on such a file is refused with "already has a review", as for any file with a review.

**R4. The rail picks the old review on the main copy.** On the main copy's page, the old review answers (`pickReview`), and the helper accepts that review's requests from the main copy's address (the Origin check, `reviewAnswersOnSite`). This holds even before anyone runs `lahe review`, as long as some site holds the main copy.

**R5. The earlier cards show.** On the main copy's page, the rail shows every committed record the old review made on the worktree file, open and done. They come over through `records.read` and the page's spellings, the same path old-port comments already use (`docs/diagrams/merge_on_load.md`). Drafts never come over.

**R6. The old address sends you to the new one.** A top-level page load of the old address goes to the main copy's own address (a 302), when a site already holds the main copy. This is the same rule a link address uses today for a file with its own review.

**R7. The old address stays read-only otherwise.** With no site holding the main copy, or on a load that is not a top-level navigation, the old address shows the main copy read-only, with no script tag, as today. Its note changes: it says the comments come along when the copy is served, and how (the Library's Open, or `lahe review <path>`).

**R8. A newer review on the main copy wins, as today.** If the main copy also has a review of its own, the usual rule picks between the two: the newest wins. The other review's cards show read-only on the rail, named by its title and agent ("Old splits show read-only"). Retiring one review hands the page to the other.

**R9. The Library treats a moved document as an ordinary document at its new path.** A row whose worktree is gone and whose main copy meets R1 becomes kind `static`, openable, at the main copy. The row says it moved: "Moved from a worktree that is gone. Your comments came with it."
- **Open** binds the main copy's address and opens it with the rail, the way Open binds any static row (subject to Q1).
- **Pick this up** and **Launch a new agent** work as for any static row: the agent takes the review's session over. No path is printed into a hand-off message.
- A row whose main copy fails R1 keeps today's behavior: kind `worktree`, read-only Open or `missing`.

**R10. The docs say how it works now.** `docs/ongoing/STABLE_ADDRESSES.md`, `docs/ongoing/LIBRARY.md`, `docs/CONTRACTS.md` (the list's kinds) and `docs/CLI.md` (`lahe review`) describe the move. The stable-addresses brief's R13 and architecture are history and stay as they are.

## 3. Approach

### The design call

**Compute the move when it is asked about. Write nothing to move a review.** The registry already holds the trusted pair (worktree root and main checkout). One function turns a gone worktree path into its main-checkout copy (R2). Five places use it:

- `holderOfFile` tier 1: a review that recorded a gone worktree file holds its main copy.
- `pickReview` rule 1 and `reviewAnswersOnSite`: the same, so the rail answers and its requests are accepted. Both try the direct match first and call the move function only when it fails, so ordinary pages pay nothing.
- `fileOfItem`: a record made at the old worktree address names the main copy. This alone fixes "Active 0, Done 0": `spellingsFor` then lists the old address on the script tag, and `pageRecords` returns those records.
- `serveGone`: the redirect of R6, using `ownAddressOf` on the main copy.

`lahe review` in the owning session also passes `--review <old id>`, so `add` records the main path on the review. After that the review matches the main copy directly, and the move function is no longer needed for it.

The Library side is two small changes: `catalog_reader.placeRow` builds a static plan on the main copy, and `catalog_sites.vouched` accepts a plan that the move function produced.

### Alternatives rejected

- **Copy the review's records into a new review.** Two reviews of one document, with ids the agent has never seen. It breaks "one review per file" and the agent's history of what it answered.
- **Point the old site at the main checkout.** The old address would keep working, with the same browser storage. But the main copy often has its own site already (Ken's does), so this would make two names for one file, against "same file, same address". It also changes the root a name may serve, which the stable-addresses security review ruled out (SR9: "names are never reused for another root").
- **Give the old address a rail on the main copy.** That puts a review token into a file nobody bound, which the stable-addresses architecture forbids ("The worktree fallback is read-only. It never injects a token into a file nobody bound."). The redirect gives the same result without that.
- **Write a "moved" event into the review when the worktree goes.** Nothing notices the moment a worktree is removed, and another session's review is not this command's to write to. Computing the move on demand needs no writer and no migration.
- **Fix only `lahe library serve` for worktree rows.** That keeps a special path for these rows. Making a moved row an ordinary static row reuses Open, the takeover and the hand-off unchanged, with no change to the skill or the contract text.

### Trust

- **Which file may be bound.** The old address never binds or injects (R7). The main copy gets the rail only from a site someone bound: `lahe review` (the CLI secret) or Library Open.
- **Q1: Library Open binds a folder nothing served before.** Today Open names a site only for a folder that something a page cannot write has already served. A moved document's main folder has not been served. This spec trusts it anyway, because the helper derives it from the registry alone: the worktree's site was served, and git's back-link proved that worktree belongs to this main checkout. No page-supplied path is involved, and the real-path checks of R1 apply. If Ken says no, Open on a moved row shows the main copy read-only, and the rail comes only from `lahe review` or Hand to agent.
- **How the main copy is proven to be the same document.** The repository comes from git's own records, checked both ways when the site was bound (`sites.worktreeOf`, `linksBack`). The path is the same relative path, by construction. The contents are not checked: the main copy is usually the merged version and may differ. Cards whose text changed are anchored by replay, as they are after any edit, and a card that cannot find its words shows that it cannot.
- **Tokens.** No new token and no new credential. The page gets the old review's existing token, exactly as any page of that review does. The Origin check accepts the main copy's site for that review only by the rule of R4.
- **Page text.** A review's recorded paths are page text (a page holding the token can write them). The move function only translates a recorded path inside a gone worktree into the same path in that worktree's main checkout. A page could already record a main-checkout path directly, so this adds no new reach.
- **Immutable owner.** No review changes session. Another session's review is opened, never moved (R3). Continuing it needs `lahe session takeover`, which the human asks for, as today.

### Out of scope

- Reviews from before stable addresses, whose worktree site the registry never saw (old `127.0.0.1:<port>` page servers). Their rows keep today's `worktree` and via-agent behavior.
- Unsent drafts typed at the old address. They live in that address's browser storage, and `records.read` never carries drafts.
- A worktree that still exists. Its file and the main copy are two documents until the worktree is removed.

## 4. Tasks and verification

Two slices. Slice 1 is what Ken asked for and can land alone. Slice 2 is the Library.

**Slice 1: the review follows the document**

1. Add the move function to `page_routes.js` (R1, R2), and make `mainCheckoutCopy` call it.
2. Use it in `holderOfFile`, `pickReview`, `reviewAnswersOnSite` (the helper passes its registry) and `fileOfItem` (R3 to R5).
3. In `review.js`, pass `--review <old id>` when the holder was found through a move (R3).
4. In `serveGone`, redirect a top-level load to the main copy's own address, and rewrite `movedNote` (R6, R7).
5. Update `STABLE_ADDRESSES.md`, `CLI.md` and `merge_on_load.md` (R10).

**Slice 2: the Library**

6. `catalog_sites`: `worktreeSiteFor` returns the main copy through the move function, and `vouched` accepts a moved plan (R9, Q1).
7. `catalog_reader.placeRow`: a moved row is `static` and openable, at the main copy, with a `moved` flag. The view model shows the "Moved" note (R9).
8. Update `LIBRARY.md` and `CONTRACTS.md` (R10).

The test fixture for every row is the one `stable_addresses_sites.spec.js` V20 already builds: a fake main checkout with `.git/worktrees/feature/gitdir`, a worktree whose `.git` file points back, and the worktree renamed away (never deleted).

| Behavior | Failure case | Test that proves it |
| --- | --- | --- |
| R1: the move function returns the main copy for a gone worktree file | worktree still on disk, no back-link recorded, main copy missing, main copy a symlink out of the checkout, copy inside the state folder: each returns null | `test/unit/review_follows_document.test.js` (new) |
| R3: `holderOfFile(<main copy>)` names the old review | a retired old review is not named; a review in a worktree that still exists is not named | same file |
| R3: `lahe review <main copy> --session <owner>` continues the old review and records the main path; no new review folder | from another session it prints the owner and makes nothing; `--new` is refused | same file, running the CLI against a temp state folder |
| R4: the Origin check accepts the main copy's site for the moved review | an unrelated site is still refused | same file |
| R5: `records.read` at the main address returns the old records, open and handled, and the script tag's spellings name the old address | drafts never return; another review's records are not in `records` | same file, beside the cases in `each_page_comments.test.js` |
| R6: a top-level load of the old address is a 302 to the main copy's address | without both Fetch Metadata headers, no redirect | same file |
| R7: with no site holding the main copy, the old address is read-only with the new note and no script tag | | `stable_addresses_sites.spec.js` V20, kept passing with the new note text |
| R8: a newer direct review wins; the old review's cards show read-only | | `review_follows_document.test.js` |
| End to end: comment and mark one done on a worktree page, remove the worktree, run `lahe review <main copy>` in the same session; the rail shows Active 1 and Done 1 with both cards on their words | | `test/browser/review_follows_document.spec.js` (new), with light and dark screenshots on the progress page |
| R9: a moved row is static and openable at the main copy; Open returns the main copy's address and stamps the review; a launch hand-off is a takeover with no path in it | a row whose main copy fails R1 stays `worktree`, as today | `test/unit/catalog_reader.test.js`, `test/unit/catalog_routes.test.js` |
| No leaked processes | | `ps -axo command \| grep -c "[l]ahe.js serve"` before and after, reported |

## 5. Acceptance criteria

- Ken opens a progress page whose worktree is gone, after an agent runs `lahe review <main copy>` in the review's own session. He sees all his earlier cards, open and done, on the main copy's page, and he can comment and reply as before.
- His old link to the worktree address lands on the main copy's page with the rail.
- From the Library, Open on that document opens the main copy with the rail (if Q1 is yes). Pick this up and Launch a new agent hand the review over as they do for any document.
- No review changed session without a takeover, and no address served a review token for a file nobody bound.
- `npm run gate:unit` passes, the two named specs pass, and the helper count after the tests equals the count before.
