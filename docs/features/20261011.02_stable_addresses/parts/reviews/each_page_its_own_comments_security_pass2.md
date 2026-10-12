# Security review, second pass: each page carries its own comments

Reviewed: the revised [each_page_its_own_comments.md](../architecture/each_page_its_own_comments.md), against the [first pass](each_page_its_own_comments_security.md), `src/service/page_routes.js` (`pickReview`, `reviewAnswersOnSite`, `recordsForPage`, `fileForPage`, `serveMarkdown`, `headers`), `src/service/sites.js` `addLinked`, `src/service/reviews.js` `endReview`, `src/cli/commands/add.js` (reuse and `refuseForeign`), the `records.read` route in `src/service/routes.js`, `docs/diagrams/session_ownership.md`, and `skills/lahe/SKILL.md` rule 18.

**Verdict.** The read-only design closes the worst holes from the first pass: nothing is written across reviews, so the edit-routing and prompt-injection findings no longer arise. No blocker remains. Three important gaps are new, and all three are in Part 1, not in the page:

- `lahe review` hands any agent a ready takeover command for another agent's live session.
- "Has a review" counts link tables, and the helper writes link tables on every page view, so a Markdown page that links to a file claims it.
- `lahe review retire` has no owner check, and the archive event it relies on stops nothing today.

Fix those three and the design is sound.

---

## First-pass findings

| # | First-pass finding | Now | Reason |
| --- | --- | --- | --- |
| 1 | The eligibility rule in the note did not match the code | Resolved, with one wrong premise | Part 3 now states both conditions: the review answers on the site, and it holds a committed record on the file. The extra allowance rests on "only `site.bind` writes the link table", which is false (finding 2 below). Condition 2 still bounds the allowance, so the read rule holds, but the sentence must change. |
| 2 | The real boundary is the site, not the page | Resolved | Part 3 says so in plain words, and `fileForPage` stays the only resolver. |
| 3 | Cross-review edits routed on ids the browser chose | No longer applies | Nothing is written across reviews. It stays closed only if the rail keeps another review's cards out of its own store and outbox (finding 4 below). |
| 4 | New comments filed into another review | Resolved | Frames, fetches and `.lahe` loads of a link address get the page read-only with no rail. New comments are never filed under another review. |
| 5 | Old addresses pooled across reviews | Resolved | Part 2 computes each review's addresses from its own records and matches only its own records. A test covers a shared port and path. |
| 6 | Agents could not see where a cross-filed edit came from | No longer applies | No cross-review writes, so no provenance fields are needed. The safe-rendering requirement and its test are kept. |
| 7 | Framing, and the redirect relying on headers `.lahe` lacks | Resolved | `frame-ancestors 'self'` is already in `headers()` (`page_routes.js:857`) with a unit test (`test/unit/hidden_files_served.test.js:140`). The redirect needs both Fetch Metadata headers. SR5 is reopened in the note, but the architecture's Security Review table (`02_architecture_stable_addresses_reviews.md:318`) still carries the old rationale (finding 6 below). |
| 8 | Redirect target built from the request | Resolved | The target comes from the registry only, sends `no-store`, and never creates a site. Tests cover a forged Host and encoded slashes. |
| 9 | The residual risk was understated | Resolved | The paragraph names other sessions and projects, other local accounts, and says Part 3 is read-only. |

---

## New findings, worst first

## 1. `lahe review` offers any agent a takeover of another agent's live session

- **severity** important
- **kind** risk
- **where** note, Part 1, "The file has a review in another session that is open"; `docs/diagrams/session_ownership.md` (handoff); `skills/lahe/SKILL.md` rule 18
- **what** When a file's review belongs to another open session, `lahe review` prints `lahe session takeover <id>` to the agent that ran it. Nothing checks that the human asked for a handoff.
- **why**
  - The ownership doc says takeover happens when a human explicitly asks. The Library path enforces that: the page asks first, naming the agent that is listening and the other reviews that move. The CLI path in this note has no such step. The only guard is SKILL rule 18, which is prose, and an agent that was just told "here is how to take it over" is likely to run it.
  - A takeover of a live session advances its fence, so the other agent's monitor exits with code 6 mid-work.
  - The taking agent then gets the whole session: every review in it, possibly about other projects, with their unanswered comments in its catch-up. That is another agent's work queue, and the reviewer's instructions in it, delivered to an agent working somewhere else.
  - Until takeover, the reviewer's new comments on this page go to the other session's agent, which may be working in another repo or worktree. The reviewer thinks they are talking to the agent in front of them.
- **fix**
  - When the owning session has a live monitor, `lahe review` does not print a takeover command. It prints the address, says which agent and session own the review, and tells the agent to ask the human before doing anything else.
  - Make `lahe session takeover` of a session with a live monitor go through the same confirmation the Library uses (a queued request the human confirms on the page), or refuse it from the CLI unless the session is closed or its monitor is gone.
  - For a closed session, printing the takeover command is fine: nobody is cut off.
  - Fold the new wording into the skill, the contract and its copies, as the note already plans for Part 1.
  - Tests: `lahe review` of a file owned by a session with a live monitor prints no takeover command; a CLI takeover of that session is refused or queued.

## 2. "Has a review" lets a link claim a file, and page views write the link table

- **severity** important
- **kind** defect
- **where** note, Part 1, "Has a review" and "A linked document with no review of its own"; Part 3, the allowance sentence; `serveMarkdown` in `src/service/page_routes.js:992`; `recordLinkedFor` at `page_routes.js:597`; `addLinked` in `src/service/sites.js:470`
- **what** Part 1 counts "a review that linked to it" as having the file. The link table is not written only by `site.bind`: every GET of a Markdown page that has a review calls `sites.addLinked` with the links its render found, and rebuild does too.
- **why**
  - Viewing any Markdown page under review that links to file F, directly or through a chain of mounted pages, adds that review to `linked_files[F]`. No comment is needed. From then on, any agent's `lahe review F` opens that linking review in its session, and `--new` is refused.
  - So an index or README that links to every document in a repo claims every one of them for the index's review and its session. A Markdown file whose content the user did not write (a cloned repo, a downloaded doc) can do the same on purpose, for any file under the home folder (`mountableDir`).
  - The same holds for "a folder review whose folder holds it". I found no limit on how broad a folder review can be, so a folder review of a wide folder claims every file under it.
  - Combined with finding 1, a claimed file steers later agents toward taking over the claiming session.
  - Part 3's allowance repeats the first pass's premise that only `site.bind` writes this table. That premise is wrong. Condition 2 (the review holds a committed record on F) still bounds what a page can read, so the read rule stays safe, but the stated reason is not the real one.
- **fix**
  - In Part 1, a linking review has the file only when it holds a committed record on F. A link alone never claims a file. With no such record, `lahe review F` makes a new review as today.
  - Decide and state how broad a folder review can be before it claims files for Part 1, or count a backing folder review only when it holds a committed record on F or recorded F itself.
  - In Part 3, replace "Only `site.bind` writes that table, and it needs the CLI secret" with the true control: the table is written from file content on page views, and condition 2 is what limits the allowance.
  - Tests: viewing a Markdown page that links to F, with no comment made, leaves `lahe review F` free to make a new review; a linking review with a committed record on F is opened.

## 3. `lahe review retire` has no owner check, and "stops answering" has no mechanism

- **severity** important
- **kind** defect
- **where** note, Part 1, "Retiring a review"; `endReview` in `src/service/reviews.js:1520`; `readReviews` and `pickReview` in `src/service/page_routes.js:233` and `:280`; `reviewAnswersOnSite` at `:325`
- **what** The note says retire "writes the archive event ... and the review stops answering on any page". Today the archive event (`review.archived`, written by End review) changes nothing the page server reads: `readReviews` does not check it, so `pickReview` still picks the review and `reviewAnswersOnSite` still accepts its origins. The note also does not say who may retire which review.
- **why**
  - Without an owner check, retire is the escape route the `--new` refusal points at. An agent told "this file's review belongs to session X; to start over, retire it" will retire another agent's live review. That ends the other agent's work on the file without the human or that agent agreeing, which is the move the ownership rule forbids.
  - Without a named enforcement point, a retired review's token keeps working from any tab still open on it, the page may keep injecting its rail, and Part 1 may still count it as "having" the file, so retire would not free the file at all.
- **fix**
  - Retire refuses a review owned by another session, with the same rule as `refuseForeign` in `add.js`. To retire someone else's review, take the session over first, under finding 1's rule.
  - Name the four places "retired" is checked: `pickReview` skips it; `reviewAnswersOnSite` returns false, so its origins fail the Origin check; the event route refuses new events under its token; and Part 1's "has a review" skips it.
  - Say whether a retired review's comments still show as Part 3 read-only cards. If they should, Part 3's eligibility needs its own rule for retired reviews, since condition 1 will fail for them.
  - Say whether End review on the rail is the same as retire, since both write the same event.
  - Tests: retire of another session's review is refused; after retire, a post under the old token is refused, the page shows the new review's rail, and `lahe review` makes a new review.

## 4. Read-only cards must stay out of the rail's own store and outbox

- **severity** minor
- **kind** risk
- **where** note, Part 3, "The page never writes into another review"; Tests, "No event is ever accepted under one review's token for another review's item"
- **what** The note keeps writes out by design, but does not say how the rail holds another review's cards. Item ids are minted by the browser, so a script on the page can make an item in its own review with the same id as another review's card.
- **why**
  - If foreign cards enter the store keyed by id alone, a same-id item shadows the foreign card or the other way round, and an edit control can appear on a card the reviewer believes belongs to another review.
  - The test as worded has no mechanism behind it: the helper cannot tell "another review's item" from an event under token A, because an id under A is just A's item. It would pass whatever the rail does.
- **fix**
  - The helper tags every record from another review with that review's id, set from its own data, never from the request.
  - The rail keeps those cards in a separate read-only list keyed by review and id, with no edit controls, never in the store the outbox reads.
  - Restate the test as two: an event under A's token for an id that only B holds writes to A's log and leaves B's log byte-for-byte unchanged; and a rail holding a foreign card and an own item with the same id shows both, with edit controls only on its own.

## 5. What the read-only cards tell a page

- **severity** minor
- **kind** risk
- **where** note, Part 3, "each with a line naming the review and session it is filed in, and how to work on it there"; "Security: what a page can now do"
- **what** The card's line gives any script on the page another review's id, its session id, and the agent's name, plus a takeover command.
- **why** None of these is a credential: takeover and review commands need the CLI. But it tells a page which other sessions and agents hold comments on its files, and puts a ready command in front of a reviewer who may paste it to their agent, which runs into finding 1.
- **fix** Show the review's title and the agent's name, and say "ask your agent to pick this up from the Library" rather than printing a command. Add one line to the residual-risk paragraph that the page learns which other reviews and agents hold comments on its files.

## 6. Small gaps to close in the text

- **severity** minor
- **kind** defect
- **where** note, Part 1 "Has a review"; Part 2 redirect bullets; architecture Security Review table
- **what and fix**
  - "The newest one counts, by the rule the helper already uses" is not the rule. `pickReview` is tiered: a review that recorded the file, then a folder review, then a linking review, newest within each tier. State the tiers, and with finding 2 applied, drop the linking tier from Part 1.
  - The redirect fires only when the file's own site exists. Say what happens when the file has its own review but no bound site: it should be the read-only page with no rail, so it fails closed.
  - Update SR5's row in `02_architecture_stable_addresses_reviews.md:318` with the new rationale, so the architecture and the note agree.
