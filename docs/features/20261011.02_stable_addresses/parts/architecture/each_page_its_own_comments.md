# Each page carries its own comments

**Status:** Ken approved this design, and it is built on `unit/sa-core`. Both security passes are folded in ([first](../reviews/each_page_its_own_comments_security.md), [second](../reviews/each_page_its_own_comments_security_pass2.md)). The text below says what the build does.

**The design, in one paragraph:** one review per file. `lahe review` of a file that already has a review opens that review, whichever agent session owns it, and never makes a second one. Within that review, every address the file has had is one page: its own address, the link address on another page's site, and its old `127.0.0.1` address. Comments already split across reviews on disk show on the page as read-only cards, naming the review's title and its agent. Nothing ever writes into another review from a page. This meets "every page carries its own comments" with much less risk than the cross-review design this note first proposed.

## The rule, as you will see it

- Whatever page you are on, the rail shows every comment made on that page, and none from any other page.
- It does not matter how you got there: typed address, a link from another document, the Library, an old bookmark.
- A comment you leave there shows up again the next time you open that page, from anywhere.
- Your agent gets every comment, and replies and edits land on the right card.

## Why comments split today

A comment is filed under one review, and the rail shows the comments of the one review that "answers" on the page. Comments split in four ways:

- **A second review of the same file.** `lahe add` reuses a review only within the same agent session. A new agent running `lahe review` on the same file makes a second review. This is the main source of split comments.
- **A linked document.** Opened through a link from page A, it shows A's review. Opened on its own, it shows its own review.
- **A folder page that later gets its own review.** The folder's review held its comments. After `lahe review folder/page.html`, the page's own review answers, and the earlier comments are gone from the rail.
- **The same file at two addresses.** A linked document at `/.lahe-source/<hash>/doc.md` on the linking page's site, and at its own address, is one file. Today those are two pages.

## Part 1: one review per file

### What `lahe review` does

- **The file has no review:** as today, a new review.
- **The file has a review in this agent's own session:** it opens that review, as today.
- **The file has a review in another session:**
  - It opens that review and prints the address, so the page opens with all its comments.
  - It says which session owns it, and the agent's name.
  - It makes nothing and moves nothing.
  - **When that session's agent is listening** (a live monitor, or a lahe command in the last few minutes), it prints no takeover command. It tells the agent to ask the human before doing anything else with the page: a handoff is the human's to ask for, and a takeover would cut the other agent off mid-work.
  - **When nobody is listening, or the session is closed,** it names `lahe session takeover <id>`, which the agent runs only when the human asks. Takeover reopens a closed session.
- **A review from before sessions:** it opens it and says to pick it up from the Library.
- **`lahe session takeover` from the command line is refused while the session's agent is listening.** The Library is where the human confirms that handoff, because it names the agent that is listening.

**"Has a review"** is tiered, newest within each tier, retired reviews never:

1. a review that recorded the file;
2. else a folder review whose folder holds the file, not `--only`, **that holds a committed comment on it**;
3. else a review a site's link table lists for the file, **that holds a committed comment on it**.

A link alone never claims a file. The link table is written from page content every time a Markdown page is viewed, so an index that links everything would otherwise claim everything. A broad folder review with nothing said about a file does not claim it either.

### Closed sessions: reopen, not adopt

There are two ways to handle a review whose session is closed:

- **Reopen the owning session (takeover), recommended.** The session ownership rule says a review keeps the session that made it, and no command moves it by accident (`docs/diagrams/session_ownership.md`). Takeover keeps that rule. The new agent gets the whole session: every review in it, and the catch-up commands. Nothing moves.
- **Adopt the review into the new session.** This breaks the ownership rule for ordinary reviews; today only a review from before sessions can be adopted. It also splits a session: its other reviews stay behind with nobody listening.

Recommendation: takeover. It needs no new rule, and handoff between agents already works this way.

### Retiring a review

- `--new` and `--new-session` are refused for a file that has a review. In your own session's review the message names the retire command; in another session's it says to ask your human.
- `lahe review retire <review-id> --session <id>` ends a review on purpose. **Only the owning session may retire it**; another session's review is refused, with the same rule `lahe add` uses.
- "Retired" is enforced in four places:
  1. the page's review pick skips it;
  2. the Origin check fails for it;
  3. events under its token are refused;
  4. Part 1's "has a review" skips it, so `lahe review` of the file makes a new one.
- A retired review's comments do not show as read-only cards (Part 3).
- Retiring writes the same archive event as End review on the rail, and keeps the whole log. End review is not a retire: an ended review still answers on its page.
- Retiring never deletes files. Removing a review's folder stays a manual act.

## Part 2: every address of a file is one page, within its review

Once a file has one review, the rail only has to find that review's comments under each address the file has had. This is V31 option A, widened from old ports to every address:

- **Its own address** (`<name>.lahe.localhost/<path>`).
- **A link address** on another page's site (`/.lahe-source/<hash>/doc.md`), when the comment was made through a link before the file had an address of its own.
- **Its old `127.0.0.1:<port>` address**, and for an old Markdown review its rendered file's path.

The helper computes these addresses **for this review only**, from its own records: its recorded paths, the old page-server records for its folders, and the link tables on its sites. It puts them on the page's script tag. `records.read` already returns this review's records that match them, and the rail takes in the ones it does not hold. Each review's old addresses are matched only against that review's own records, never pooled, because old ports were reused (security review, finding 5).

### A link to a file that has its own review

- **A top-level page load of a link address is redirected to the file's own address.** "Top level" means `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate` are both present.
- **No redirect without those headers.** That covers a frame, an image, a fetch, and any request to a `.lahe` address, which browsers send with no Fetch Metadata. Those get the page read-only, with no rail and a line saying where to comment (finding 4). New comments are never filed under another review.
- **A file with its own review but no address of its own** (its review has not been bound to a site) is served read-only at the link address, with no rail, even on a page load. It fails closed.
- **The redirect target comes from the registry only:** the file's own site name, the printed port, and the real file's path under that site's root, re-encoded. It is never taken from the Host header, a query, or the raw path. The helper redirects only when that site exists and the file is inside its root, and never creates a site on this path. The response carries `Cache-Control: no-store` (finding 8).
- **SR5 is reopened.** The architecture accepted "no Fetch Metadata on `.lahe`" because there were no redirects. Its new reason: the redirect needs both Fetch Metadata headers, and `.lahe` addresses, which have none, are never redirected.
- **Framing:** every page now sends `Content-Security-Policy: frame-ancestors 'self'`, so no other site can frame a reviewed page and its token. This was a gap in the current build, and it is fixed there (finding 7). `'self'` keeps a reveal.js speaker-notes window working, since it frames the same deck.

### A linked document with no review of its own

Its comments are filed in the linking review, as today, under the link address. If it later gets its own address through that same review, the link address is one of its addresses (above), so the comments follow. If someone runs `lahe review` on it after a comment was made there, Part 1 opens the linking review, since that review holds a committed comment on the file. With no comment yet, it gets its own review, and nothing is split.

### A folder page

`lahe review folder/page.html`, when a folder review already holds a comment on the page, opens the folder review (Part 1). The page keeps one review, so its comments never split. With no comment yet, the page gets its own review, and from then on the page's own review answers there.

## Part 3: comments already split on disk

Parts 1 and 2 stop new splits. Comments that are already in two reviews for one file still need to show. The smallest way:

- **The rail shows them as read-only cards,** in their own list under "Filed in another review". Each group names the review's title and its agent's name, and says to ask your agent to pick it up from the Library. No review id, no session id, no command: the page learns which other agents hold comments on its files, and nothing more.
- **The rail keeps them apart.** The helper tags each group with a key that means nothing outside the answer. The rail keeps those cards in their own list, keyed by group and item id, never in its store or outbox, with no input and no buttons. An own item with the same id is a different card.
- **The page never writes into another review.** No rewording, deleting or reopening another review's card from here, so no edit routing across reviews, and none of the prompt-injection risk the security review found in that (findings 3, 4 and 6 do not arise).
- **Which reviews count** (finding 1). A review's records show on page F of site S only when both hold:
  1. the review answers on site S by the rule the Origin check uses today (`reviewAnswersOnSite`), and
  2. it holds a committed record on the file F that the page path resolves to.
  - On F's own site, a review also counts when some site's link table lists it for F. The link table is written from page content on page views, so it is not a control on its own; condition 2 (a committed record on F) is what limits this.
  - A review never counts on a site that only mounts F through a link; the redirect is how those comments are reached.
- **The boundary is the site, not the page** (finding 2). Any script on a page of site S can name any path S serves. So the honest statement is: a page of site S can read the other eligible reviews' comments on the files S serves. `fileForPage` stays the only resolver, so a path never names a file outside the site's root or mounts.
- **Drafts never come over.** That is already true of `records.read`.
- **Showing another review's card** uses the same rendering as the page's own cards: text set as text, HTML through the same sanitizer. A unit test renders such a card holding markup.

If you would rather not show old splits at all, the fallback is one line on the rail: "3 earlier comments on this page are in review X." That is smaller, but the comments themselves do not show, so it does not fully meet the rule.

## How much of the first design is still needed

| Need | First design (cross-review read and write) | Built |
| --- | --- | --- |
| New comments split across reviews | read across, file per file | prevented by one review per file |
| Edits to a card in another review | routed across reviews | never needed for new work; old splits are read-only |
| A link address versus the file's own address | read across | one review's addresses, plus the redirect |
| A folder page later reviewed on its own | read across | opens the folder review once it holds a comment on the page |
| Old splits on disk | read and write across | read-only cards |
| Prompt-injection provenance in the drain (finding 6) | required | not needed: nothing is written across reviews |

## Security: what a page can now do

- **No new credential.** The page's token and Origin are still the only credentials, and no second token reaches the page.
- **Reading only, for old splits.** A page of site S can read committed comments on S's files from other reviews that answer on S (or, on a file's own site, are listed for it in a link table) and hold records on those files. It cannot change them.
- **The residual risk, in full** (finding 9):
  - "Other reviews" includes reviews in other agent sessions, possibly about other projects, as long as they hold comments on these files.
  - Anything that can load a page of site S can read them. That includes other user accounts on this computer, already accepted as a risk for always-on pages (SR4). They could already read one review's comments on a page; with Part 3 they can read every eligible review's comments on S's files.
  - The page also learns which other reviews (by title) and agents hold comments on its files.
  - They cannot change or delete another review's comments: Part 3 is read-only.
- **Framing:** every page sends `frame-ancestors 'self'`.

## Contract and agent-facing text

- Part 1 changes what `lahe review` prints and adds `lahe review retire`. The skill, the contract in `src/shared/review_format.js` and its two copies (`test/unit/review_format.test.js`, `docs/CONTRACTS.md`), `docs/CLI.md`, and the dist rebuild change together.
- The contract says a file has one review, that another session's review means asking the human, and that a CLI takeover of a listening session is refused.
- No change to how an agent reads an item: nothing is filed across reviews, so no provenance fields are needed.

## Tests that prove it

- **Part 1** (`test/unit/one_review_per_file.test.js`, `test/unit/review_retire.test.js`):
  - Another agent's `lahe review` of a file with a review opens it, names its session and the takeover, and makes no review and no session; `--new-session` is refused.
  - When that session's agent is listening, it says to ask the human and names no takeover, and a CLI takeover is refused.
  - `--new` on a file with your own review is refused and names retire; retire of another session's review is refused; after your retire, a new review is made and answers.
  - A folder review holds a page only once it has a comment on it.
  - A link alone never claims a file; a linking review with a comment on it does.
  - A retired review answers on no page, fails the Origin check, takes no events, and stays retired after a restart.
- **Part 2** (`test/unit/each_page_comments.test.js`):
  - A comment made through a link shows at the file's own address, in the same review (`data-lahe-spellings`).
  - The redirect fires for a top-level load, and not for a frame, a fetch, or a load with no Fetch Metadata; a file with no address of its own is read-only.
  - The redirect target comes from the registry: encoded slashes and a query change nothing.
  - Two reviews whose old ports and paths collide each get only their own records.
- **Part 3** (`test/unit/each_page_comments.test.js`):
  - Old split comments come back read-only, named by title and agent, with no review or session id, and no drafts.
  - A review that answers only through a link mount contributes nothing on the linking site; on the file's own site, a linking review with a comment counts.
  - A retired review's comments are not shown, and an event under one review's token for an id another review holds writes only to its own log.
- **Browser** (`test/browser/each_page_comments.spec.js`, `test/browser/linked_docs_rail.spec.js`):
  - Comment through a link, then open the file on its own: one card, and one after a reload.
  - The reverse order: one card, reached by the redirect.
  - A linked document with its own review opens that review's page, and a comment there lands in its own review.
  - An old split: the other review's comment shows read-only, as text, with no controls, and nothing is posted.
  - A read-only card and an own item with the same id are both shown, with controls only on the own one.
