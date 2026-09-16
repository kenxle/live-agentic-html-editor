# The rail should follow the reviewer through a folder of pages

Board row: `LAHE-static-site-folder` in `docs/BULLETIN.md`. Written 2026-09-16 after an agent reviewing a set of wireframe pages found the rail only on the page it had enrolled, and worked around it by enrolling every page one at a time. Ken called that fragile. This is the decision page: what is happening, two ways to fix it, and a recommendation. Nothing here is built.

## What happens today

- A review remembers the exact file paths it was pointed at (`target_paths` in the review's meta.json). The session's static server puts the rail into a response only when the requested file is one of those paths. Any other file under the same folder is served plain.
- `lahe review <folder>` does not mean "review these pages". A folder target falls into the app-in-dev row, which is built for a running app: it registers the app's origin and prints one script line for you to paste into the app's shared template (a Rails or Next layout), the one file every page is rendered through, so one paste reaches every page. A set of wireframes is separate HTML files with no shared template. There is no single place to paste the line, so that row leaves you pasting it into every file by hand, or doing nothing.
- One review can already span pages. Items carry the page they were made on, the rail shows each page only its own items, and `review.json` lists them all. So the multi-page half of the problem is solved; only the "which pages get the rail" half is missing.

## Why per-page enrolment is the wrong answer

- A page nobody enrolled has no rail, and the reviewer only finds out by clicking through to it.
- A page added to the folder after enrolment is missed.
- It is a loop the agent has to remember to run. Today's run enrolled 82 pages as 82 separate reviews, and a similar run on Sep 9 made 139. Each one is a folder on disk with its own log, and 166 of the 384 reviews on this machine never received a comment.

## Option A: a folder is a target

`lahe review <folder>` where the folder holds HTML files creates one review whose target is the folder. The static server, when it matches a request, treats a recorded folder as "every `.html` file under it", and puts the rail in. Pages join the review as the reviewer visits them, through the `page.visited` event that already exists.

- Changes: the target-path match in `static_servers.js` learns to match by root as well as by exact path; `lahe review` and `lahe add` stop routing a folder of HTML to the dev-server row; the review meta records a folder target; `AGENTS.md`, the skill table and `docs/CLI.md` get a new row.
- What stays the same: the review store, the item record, the rail, the layer, the helper's routes.
- Risk to think through: a folder that also holds pages the reviewer should not be commenting on (a vendored library's demo page, an old export). The match is "under the root", so those get a rail too. Acceptable for wireframes and generated sites; say so in the docs, and keep `--source` for build output the way it works now.
- Risk: a folder of Markdown, or a mix. Out of scope. A folder counts as a static site only when it holds at least one `.html` and the reviewer did not pass `--origin`.

## Option B: auto-enrol on first visit

Keep per-page reviews, but when the static server serves an HTML file under a session's root that no review has recorded, it enrols the page into the newest review on that server before responding.

- Changes: the static server gains a write path into review meta. Today it is read-only against the store, on purpose: it is a separate process and disk is the only thing it shares with the helper.
- Risk: two processes writing meta.json; a race between the helper recording paths and the server enrolling. It also keeps the one-review-per-page shape that produced 384 reviews.

## Option C: change the wireframing skill instead

Ken's suggestion while reading: the wireframes come from the magic-mirror skill, so the skill could generate them with a shared piece every page includes, and the existing app-in-dev row would then work with one paste.

- Changes: the skill's page template, not LAHE.
- What it solves: wireframes this skill produces, going forward.
- What it does not solve: any other folder of pages (an exported site, a generated report with subpages, someone else's wireframes), and every wireframe set already on disk. Plain HTML has no include mechanism, so "a shared piece" means either a tiny script every page loads that pulls the line in, or a build step, and both are more machinery than pointing LAHE at the folder.
- Fits alongside A: a skill that emits a clean folder of pages is exactly what Option A serves well. It does not replace A.

## Recommendation

Option A, and Option C is welcome on top of it for wireframes specifically. A is the smaller change, it keeps the static server read-only, and it collapses a wireframe set into one review the way a reviewer already thinks about it. It also needs no new discipline from the agent: point at the folder, hand over the link, done.

## Before building

- Confirm with Ken that "every HTML page under the folder gets the rail" is the rule he wants, including the vendored-demo-page case.
- Decide what the rail's page list looks like for pages that were visited but never commented on. Today `review.json` groups items by page; a visited page with no items may not appear at all, and the reviewer may want to see which pages they have walked.
- Write the tests first: a folder of three linked pages, enrol the folder once, load each page through the server, the rail is present on all three; comment on page two, the item carries page two's path; a page added to the folder after enrolment also gets the rail.
- This touches the serving table, so the skill and `AGENTS.md` change together, and the contract text does not (it is about replies, not serving).
