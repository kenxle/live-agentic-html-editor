# Security review: each page carries its own comments (option c)

Reviewed: [each_page_its_own_comments.md](../architecture/each_page_its_own_comments.md), against `src/service/page_routes.js` (`pickReview`, `reviewAnswersOnSite`, `recordsForPage`, `fileForPage`), the `records.read` route in `src/service/routes.js`, `siteOriginAllowed` in `src/service/index.js`, and `docs/CONTRACTS.md`.

**Summary.** Option (c) can be built safely, but not as the note describes it. The boundary the note names ("only reviews that already answer here", using the Origin check's rule) is not the rule in the code, and the two readings give very different exposure. The note's claim that a page gains nothing it could not already do is false for linked documents. Fix the eligibility rule, route cross-review edits on the helper's own records, keep new comments out of other reviews, and the rest is small.

Findings, worst first.

---

## 1. The boundary in the note is not the boundary in the code

- **severity** blocker
- **kind** defect
- **where** note, "Security of reading across reviews", second bullet; `src/service/page_routes.js:325` `reviewAnswersOnSite`
- **what** The note says a review counts when it "recorded F, backs F's folder, or linked to F". The code's `reviewAnswersOnSite` is per site, not per file: it asks whether a review recorded any file inside the site's root, backs the site's root, or linked to any file on the site.
- **why** An implementer has to pick one, and both are wrong in a different way.
  - Read per file ("recorded F"), a review B qualifies on every site that serves F, including a site that only mounts F. Mounts come from links in a Markdown page: any file under the home folder with no dot segment can be mounted (`mountableDir` in `src/service/markdown_links.js`). Attack: a Markdown file in folder S links to `~/Documents/project/plan.md`. `plan.md` has its own review B, in another agent session, with comments. Any script on any page of site S reads its own tag's token A and calls `records.read` with `page_path=/.lahe-source/<hash>/plan.md`. It gets B's comments, and under the edit rule it can reword or delete them. Review B never answered on S, so S's origin never held B's power before.
  - Read per site (the code as it is), the "only this file" filter does the real work, and the "only reviews that answer here" check adds nothing a reader would expect.
- **fix** Write the rule down as two conditions, both required, and make the helper compute them from its own records:
  1. The review passes `reviewAnswersOnSite(site, review)` for the requesting origin's site, exactly as the Origin check does today.
  2. The review holds a non-draft record on the file the page path resolves to.

  The linked-document case (comment left via a link, then the file opened on its own) needs one more allowance on the file's own site: a review R counts there when some site's `linked_files[F]` lists R. That table is written only by `site.bind`, which needs the CLI secret, so a page cannot add itself to it. Do not let "recorded F" qualify a review on a site that only mounts F; the redirect (finding 7) is how those comments are reached. Then correct the note's sentence "nothing a page can do here goes beyond what it could already do" to the true scope (finding 9).

## 2. "Only this file" is chosen by the page, so the real unit is the site

- **severity** important
- **kind** risk
- **where** note, "Only this file"; `recordsForPage` and `fileForPage` in `src/service/page_routes.js`
- **what** The file is resolved from the request's Origin (set by the browser) and `page_path` (set by the page). Any script on site S can name any page path S serves, including every mount.
- **why** The note reads as if a page sees only its own comments. In practice a script on one page of a folder can read and edit cross-review comments on every other page of that folder and every mounted document. That is acceptable only if it is said plainly and the eligibility rule in finding 1 holds.
- **fix** State the boundary as "the files this site serves", not "this file". Keep `fileForPage` as the only resolver, so a page path can never name a file outside the site's root or mounts. Do not describe the page path check as a control in the doc or in tests; the eligibility rule is the control.

## 3. Cross-review edits must be routed on the helper's records, not on ids or the client's claim

- **severity** important
- **kind** risk
- **where** note, "Your edits to that card", option 1 and the outbox line
- **what** Item ids are minted by the browser (`record.randomId`). The note has the outbox carry the target review and says the helper "checks it", without saying what the check is.
- **why** Two failures.
  - A page that read B's records knows B's item ids. It can create an item in A with the same id, then send edits. If the helper looks the item up by id alone across eligible reviews, which review it lands in depends on lookup order.
  - If the helper trusts the review named in the outbox entry beyond confirming it, a page can name any review it likes.
- **fix**
  - Route an edit on the pair (claimed review, item id). Accept it only when the claimed review is eligible for this page under finding 1, and that review already holds a non-draft item with that id on a file this site serves.
  - Refuse an edit when the id exists in more than one eligible review. Refuse a new item whose id already exists in any eligible review.
  - Only edits to existing items (reword, delete, reopen, reply-to-card) are ever filed outside the token's own review. Say so in the note.
  - Unit test: an A item that copies a B item's id is refused, and an edit naming a review that does not answer on the site is refused.

## 4. New comments must not be filed into another review

- **severity** important
- **kind** risk
- **where** note, "Filing is fixed per file"
- **what** "A new comment goes to the file's own review when it has one" means a page holding token A can create items in review B whenever the two differ.
- **why** On a file's own site, `pickReview` rule 1 already gives the page B's token, so this case only arises on a mounted page that was not redirected: a frame, a `.lahe` address with no Fetch Metadata, or a fetch. Those are the cases most open to a script the reviewer did not write. It hands that script a write channel into another agent's queue, through the field the agent treats as the reviewer's own words (finding 6).
- **fix** File every new comment under the token's own review, always. Enforce "one review per file" at serving time instead: when a mounted page's file has its own review and the request is not redirected, serve it read-only with no rail and a line saying where to comment. The browser test then becomes "the mounted frame shows no rail", not "the comment lands in B".

## 5. Old addresses must be matched per review, not pooled

- **severity** important
- **kind** risk
- **where** note, "V31's records route should be per file"; `recordsForPage` passes one review's `oldSpellings` to `record.samePage`
- **what** Today the old-origin aliases are computed from the one review's own `source_path` and targets. Generalized to every review, the obvious shortcut is to compute aliases once for the page and test every review's records against them.
- **why** Old origins are `127.0.0.1:<port>`, and ports were reused across page servers. Review B may have served `x/index.html` at port 5000 one week, and review A a different `index.html` at the same port later. Pooled aliases would match B's comments on one file to another file's page. That is a cross-file leak, not just a wrong card.
- **fix** For each eligible review, compute its own aliases from its own recorded paths and match only its own records with them. Add a unit test: two reviews whose old origins share a port and a path, on different files, each return only their own records.

## 6. Agents need to see where a cross-filed edit came from

- **severity** important
- **kind** risk
- **where** note, "Replies and edits on a card filed in another review"; `docs/CONTRACTS.md` drain fencing (D12)
- **what** Under (c), a reword sent by a page holding token A changes the `note` or `change` of a B item. B's agent reads `note` and `change` bare, as the reviewer's instruction. Nothing in the drain says the edit came from a different review's page, or from which origin.
- **why** Prompt injection into agent B's trusted field from a page B never served. Fencing today rests on one assumption: the trusted fields were typed into a rail whose token is B's. That no longer holds.
- **fix**
  - Record on every cross-filed event the review whose token sent it and the origin it came from. The helper fills these in from the request, never from the body.
  - Put them in the drain item's `page` object, which the contract already calls data.
  - Add one sentence to the contract: an edit filed through another review's page is still the reviewer's words, and `page.via_review` and `page.via_origin` say where it came from.
  - Per CLAUDE.md, that change goes into the skill, the contract in `src/shared/review_format.js`, the restated copy in `test/unit/review_format.test.js`, `docs/CONTRACTS.md`, and the dist rebuild.
  - Also state that B's records reach page S's rail through the same rendering and replay paths as the page's own: text fields set as text, HTML fields through the same sanitizer. A test that renders a B record holding markup on page S guards it.

## 7. Pages can be framed by any website, and the redirect's frame rule depends on headers `.lahe` lacks

- **severity** important
- **kind** defect (the framing part predates this note)
- **where** note, "A linked document that has its own review"; `headers()` in `src/service/page_routes.js:851`; architecture SR5
- **what** Injected pages send `Cross-Origin-Resource-Policy` but no `frame-ancestors` and no `X-Frame-Options`. The architecture security review asked for that header; it is not in the code. The note's "a frame is never redirected" also needs `Sec-Fetch-Dest`, which browsers do not send to `http://*.lahe`.
- **why**
  - Any website can frame a reviewed page, rail and token included, and use clickjacking to make the reviewer post, delete or reopen. CORP does not stop framing. Under (c) that page can now act on several reviews' cards, not one.
  - On `.lahe`, a frame with no Fetch Metadata falls back to `Accept: text/html`, which frames also send, so frames get redirected there.
  - SR5 was accepted on the basis of "no redirects". This note adds one, so that disposition needs to be reopened.
- **fix**
  - Send `Content-Security-Policy: frame-ancestors 'self'` on every injected page. `'self'` keeps the layer's same-origin frames option working; `'none'` would break it.
  - Redirect only when `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate` are both present. With no Fetch Metadata, do not redirect; serve the page under finding 4's read-only rule.
  - Reopen SR5 in the architecture's Security Review table, with this as the new rationale.

## 8. Build the redirect target from the registry only

- **severity** minor
- **kind** risk
- **where** note, the redirect bullet
- **what** The note does not say how the target address is built.
- **why** A target built from the request's Host header, a query parameter, or the raw path would be an open redirect, or could point at a name the helper never registered.
- **fix** Build the target from three things the helper holds: the registry's name for the file's own site, the printed port, and the real file's path relative to that site's root, re-encoded segment by segment. Redirect only when that site exists in the registry and the real file is inside its root. Never create a site or a name on this path (GET never writes, SR7). Send `Cache-Control: no-store` with it, since the target changes when a review is created. Unit test: a Host header naming another site, and a page path with encoded slashes, both give no redirect.

## 9. The residual risk is wider than the note says

- **severity** minor
- **kind** risk
- **where** note, "The residual risk"
- **what** The note says anything that can load page F can see comments on F from every review. That is right, but it leaves out three facts Ken needs to make the call.
- **why**
  - "Every review" includes reviews in other agent sessions, possibly about other projects.
  - "Anything that can load page F" includes other user accounts on the same computer, already accepted as a residual under D11 (SR4). They can now read all reviews' comments on a page, not one review's.
  - The same set can also change and delete those comments, not just read them.
- **fix** Rewrite the paragraph with those three facts in plain words. Put the decision to Ken with the boundary from finding 1 stated, not the one in the current text.

---

## What holds up

These are confirmations, not praise. They are the parts the fixes above rely on.

- The Origin check plus the per-review token stays the only credential, and no second token reaches the page.
- `fileForPage` resolves a page path with the same rules the server serves with, so a page path cannot name a file outside the site's root or mounts.
- `linked_files` and mounts are written only by `site.bind`, which needs the CLI secret and refuses any request carrying an Origin.
- Drafts are filtered on the helper side.
