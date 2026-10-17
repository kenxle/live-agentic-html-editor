# Spec: a file's comments move with it

## Summary

When a reviewed file moves to a new folder or a new name, its comments should come with it. Today they stay behind at the old address, and the page at the new address shows an empty rail. After this change, the new page shows every earlier card, open and done, by default. Starting fresh is still possible with one flag.

It ships in two pieces:

- **Piece 1, the fix for what happened today.** A review that already followed its file to the new path shows the old comments there. Nothing has to be re-run: your brief's comments come back as soon as this lands.
- **Piece 2, the agent is told.** The agent that moves a file serves the new path on the same review, with the `--review` flag `lahe review` already has. Lahe does not try to detect a move on its own. Starting fresh is the agent leaving that flag off.

**Open:** nothing. Both questions are settled; see "Decisions" at the bottom.

## 1. Problem, user and context

Ken reviews documents as an agent writes them. Agents tidy as they go, and a tidy-up often moves a file. On 2026-10-17 a research brief moved from `personal/projects/life_game/reports/20261017.01_life_as_a_game/` to `personal/docs/reports/20261017.01_life_as_a_game/` (commit 839e7bfe). Ken's words:

> i just had a research report brief move folders and i lost my prior comment thread

> if a file is moved, i want it's comments to at least have the option of being moved with it. probably move them by default

What happened, read from the helper's state folder:

- The agent did the right thing. It ran `lahe review` on the new path in its own session, and the same review (`r43b25f5bf45b`) now records both paths. It also left a symlink at the old folder pointing to the new one.
- The review holds 10 comments: 8 done and 2 not handled. None of them are lost. Each is filed under the page it was made on: the old site's address and the old path.
- The page at the new address asks the helper "which comments were made on this file?" For each old comment, the helper turns its old address back into a file (`fileForPageIn` in `src/service/page_routes.js`). The old path now runs through the symlink to a file outside the old site's folder, so the answer is "no file". With a plain `mv` and no symlink, the answer would be the old path, which no longer exists. Either way, the answer is not the new file, so the rail leaves those comments out.
- The old address answers 404, because the symlink leads outside the site's folder, and the helper refuses to follow it there.

The worktree version of this problem was fixed on 2026-10-15 (`docs/features/20261015.02_review_follows_document/`). That fix knows a worktree's main checkout from git. A plain move has no such pairing, so it needs its own rule.

## 2. Requirements

### Piece 1: a review that followed its file

**R1. Comments on a gone file show on its new file.** When a review records two pages, the earlier one is gone and the later one is on disk, the comments made on the earlier one count as made on the later one. "Gone" means no file is at that path, or the path's real location is no longer inside the folder its site serves (the symlink case).

**R2. Which later file.** A gone page pairs with a later recorded page of the same review when either:

- the gone path, followed through symlinks, is the later file; or
- the two have the same file name.

When more than one later page qualifies, the one recorded last wins. When none does, the comments stay where they are, as today.

**R3. One answer everywhere.** The new pairing goes through the one place that says which file a comment was made on (`fileOfItem`). So the page's rail, the old-address spellings on its script tag, `records.read`, the handled check, the reload check and the source named in `review.json` all agree.

**R4. Nothing to migrate.** The pairing is worked out when it is asked, from the paths the review already records. Ken's brief needs no command and no edit to its records.

**R5. The old address.** A page load at the old address of a paired file goes to the new address, the way a gone worktree's old address does now. A gone file with no pair keeps today's "file is gone" page.

### Piece 2: the agent is told

**R6. The agent carries the review.** The skill and the review contract gain one short rule: after you move or rename a reviewed file, run `lahe review <new path> --session <id> --review <review-id>`, and hand over the new link. The comments follow by default. Start a new review instead only when your human asks for a fresh start. Only the session that owns the review can do this; the command refuses any other, as it does today. The rule lands in every copy (the skill, `src/shared/review_format.js`, the copy in `test/unit/review_format.test.js`, `docs/CONTRACTS.md`, and a rebuilt bundle).

**R7. Nothing new to detect.** Lahe adds no search for moves nobody announced. A file moved without its agent knowing keeps its comments under the old review, as today, and that review stays in the Library.

### Both

**R10. The docs say how it works now.** A section in `docs/ongoing/STABLE_ADDRESSES.md` next to "A review follows its document out of a worktree", the move rule beside `--review` in `docs/CLI.md`, and the move in `docs/diagrams/merge_on_load.md`.

## 3. Approach

**Work out the pair when asked, from paths the review already records.** That is how the worktree fix works, and it covers Ken's brief with no migration. A new "moved" event was considered and rejected: nothing notices the moment a file moves, and the brief's review would still need the computed pair.

**Trust.** A review's recorded pages can be added by a page holding that review's token (`review.write`), so a recorded path is not proof by itself. The pairing only decides which of this review's own comments show on which of this review's own pages. A page that could add a path could already make that file a page of the review. So piece 1 adds no new power. Piece 2 adds no code path at all: the agent uses a flag that already exists.

**Cost.** Piece 1 adds at most one `stat` and one `realpath` per recorded page, only for a comment whose file is gone, and the answer is held for one request.

## 4. Tasks

Both pieces ship in one pull request. Piece 2 is a contract rule, so it adds no code.

| # | Task | Files |
|---|---|---|
| 1 | The pair rule (gone, same name or symlink, last recorded wins) and its use in `fileOfItem` | `src/service/page_routes.js` |
| 2 | The old address redirects to a paired file's new address | `src/service/page_routes.js` |
| 3 | Piece 2: the contract rule, in every copy | the skill, `src/shared/review_format.js`, its test, `docs/CONTRACTS.md` |
| 4 | Docs | the three named in the docs requirement |

## 5. Verification

| Behavior | Proof | Fails when |
|---|---|---|
| A plain move: comments on the gone file show at the new address, open and done | unit: `test/unit/comments_follow_move.test.js` (new) builds two sites, a review with records on site A, moves the file to site B and records it; `pageRecords` and `spellingsFor` on site B return them | the rail at B is empty |
| The symlink case (Ken's brief) | same file: the old folder becomes a symlink to the new one | `fileOfItem` answers null |
| A gone file with a different name and no symlink does not pair | same file | its comments show on an unrelated page |
| Two later files with the same name: the last recorded wins | same file | the older one wins |
| A file still on disk never pairs | same file | a live page loses its comments |
| The old address redirects to the new one | same file | 404 or the "gone" page |
| End to end: comment on a page, mark one done, move it, run `lahe review` on the new path in the same session; the rail shows Active 1 and Done 1, each on its words | browser: `test/browser/comments_follow_move.spec.js` (new), light and dark screenshots | either count is 0 |
| The contract line is in every copy | the existing seams test in `test/unit/review_format.test.js` | a copy drifts |

Ken's brief is the live check: after piece 1 lands and the helper restarts, its new address shows Active 2 and Done 8.

No analytics. No flag: the change is a fix for comments that look lost.

Gate: `npm run gate:unit` while building; `npm run gate` once on the integrated change before the pull request.

## Decisions

- **How Lahe knows a file moved (2026-10-17).** The agent tells it, with `lahe review <new path> --review <id>`. Lahe does not detect a move on its own. Ken: "just let the agent do it. it doesn't need to be complicated." The automatic search (same name, half the quoted words) and a `--fresh` flag were dropped.
- **Only the owning session moves a review (2026-10-17).** Ken: "only let the current owning session do the move. this should be simple." `lahe review <new path> --review <id>` already refuses a review from another session, and that stays. An agent in another session that moves the file gets that refusal, and the comments wait for the owner or for a takeover Ken asks for.
