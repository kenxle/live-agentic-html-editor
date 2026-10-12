# Each page carries its own comments

**Decision needed:** which way to build it. I recommend the mix in "My recommendation": show a page's comments from every review that has any, and send each new comment to the page's own review. Nothing is built yet.

## The rule, as you will see it

- Whatever page you are on, the rail shows every comment made on that page, and none from any other page.
- It does not matter how you got there: typed address, a link from another document, the Library, an old bookmark.
- A comment you leave there shows up again the next time you open that page, from anywhere.
- Your agent still gets every comment, and replies and edits still land on the right card.

## Why this breaks today

A comment is filed under one review. The rail shows only the comments of the one review that "answers" on the page, and that can change:

- **A linked document.** Opened through a link from page A, it shows A's review. Opened on its own, it shows its own review. Comments left one way are missing the other way.
- **A folder page that later gets its own review.** Before, the folder's review answered and held its comments. After `lahe review folder/page.html`, the page's own review answers, and the earlier comments disappear from the rail.
- **The same file at two addresses.** A linked document under the linking page's address (`/.lahe-source/<hash>/doc.md`) and at its own address are one file. Today they behave as two pages.

So the problem is the reading side, not just which review a new comment goes into.

## The options

### (a) One review per file

The first time a page with no review of its own is opened, the helper makes one for it, in the same agent session as the review that would have answered, so the same agent gets it. A linked document opened through a mount is sent (a redirect) to its own address.

- Good: one place per file, forever after. Simple to explain.
- Bad: it does not bring back comments that are already split. A folder review becomes many reviews, one per page, which changes what an agent sees (several review folders where it expected one). Opening a page would create a review as a side effect, which nothing does today.

### (b) The rail reads the page across reviews

The rail asks the helper for every comment on this file, from every review that has any, and shows them all. A new comment goes to whichever review answers on the page.

- Good: fixes existing splits with no migration. No new reviews appear.
- Bad: if "which review answers" keeps shifting, new comments keep landing in different reviews. Each agent only sees its own share.

### (c) The mix (recommended)

- **Reading is (b):** the rail shows the file's comments from every review that has any.
- **Filing is fixed per file:** a new comment goes to the file's own review when it has one. Only when it has none does it go to the review that answers (the folder's, or the linking page's), as today. Once a file gets its own review, everything new goes there.
- **A linked document that has its own review**, opened by clicking a link, is redirected to its own address. Only for a top-level page load; a frame or an image request is never redirected. It is the same file, so it gets one address.
- No review is created behind your back.

## Replies and edits on a card filed in another review

On the page you are reading, a card may belong to review B while the page's script tag carries review A's token.

- **Replies:** the helper folds an agent's reply into the review it belongs to, as today.
  - The rail's reply poll asks for one review's replies (A's).
  - It would also return replies to this page's cards that are filed in other reviews, under the same file rule as the reading side.
- **Your edits to that card** (rewording, delete, reopen) have to reach review B. Two ways to do it:
  1. The helper takes the event under A's token and files it in B, but only for an item it already holds in B on this same file.
  2. The helper hands the page B's token along with B's comments.
- I recommend (1). The page never holds a second token, and the helper decides on its own records.
- In the browser, each card remembers which review it is filed under. Its outbox entries carry that review, and the helper checks it.

## Security of reading across reviews

Today a page can read and write only the review whose token is on its tag. With (c), a page at file F can also read, and change, comments on F that are filed in other reviews. That is limited three ways:

- **Only this file.** The helper resolves every record to the real file it was made on (its address, its old addresses, its mount path) and returns only records on F. Comments on other pages of those reviews never come back.
- **Only reviews that already answer here.** The rule the helper already uses for the Origin check (a review that recorded F, backs F's folder, or linked to F) decides which reviews count. A review about some other folder never qualifies.
- **The same checks.** The page's token, its Origin, and the site registry, as on every review route. No new credential: nothing a page can do here goes beyond what it could already do by being opened under one of those reviews.

The residual risk: anything that can load page F can now see comments on F from every review, where before it saw one review's. Those comments are about that page, so I think this is acceptable. It is your call.

## Reviews that already split a page

- **Nothing to move.** Reading across reviews shows the scattered comments together on the page right away.
- `review.json` stays per review, so each agent still answers the comments filed with it.
- New comments go to the file's own review from now on, so the scattering stops growing.

## V31's records route should be per file

The route I just built for old comments (`records.read`) answers for one review. Under (c) it becomes the reading side for every review that holds records on this page, with each record tagged with the review it is filed under. Same guards: no drafts, this file only, same checks. The old-address case (V31) becomes one case of it, and the per-review version is not needed on its own.

## My recommendation

Build (c). The tests that would prove it:

- **Unit, the helper's file read:**
  - Comments on one file filed in three reviews (its own, its folder's, a linking page's) all come back for that file.
  - A comment on another page of those reviews never comes back.
  - A review that does not answer on the file contributes nothing.
  - Drafts never come back.
- **Unit, filing:** a new comment on a file with its own review lands there, whichever page linked to it. A file with none lands in the answering review.
- **Unit, routing an edit:** an edit under A's token to a B item on the same file is filed in B. The same edit to a B item on another file is refused.
- **Unit, the redirect:** a mounted file with its own review is redirected on a page load, and not for a frame or an image.
- **Browser:**
  - Comment on a linked document via the link, then open it on its own: the comment is there.
  - The reverse order works too.
  - Comment on a folder page, then `lahe review` that page: the comment is still there.
  - Each case shows one card per comment after a reload, and posts nothing extra.
  - A reply to a card filed in another review shows on that card.
