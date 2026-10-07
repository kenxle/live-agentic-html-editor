# A Markdown file beside a reviewed page gets the rail

## Problem

The forge's built spec pages carry a nav bar whose Progress link points at `04_progress_<name>.md`, a sibling file in the same folder. Following it lands on a read-only render with no review rail. That happens even though the progress page is already being reviewed in the same session, with the rail on.

The cause is in `src/service/static_servers.js`. A page server answers a `.md` request in one of two ways:

- **Under a mount** (a document a reviewed page linked to elsewhere), `serveLinked` checks two things. First, does the file have its own review in this session? If so, it redirects there (`ownReviewUrl`). If not, it renders the file with the linking review's rail.
- **Under the server's own root**, the `.md` branch calls `renderMarkdown(candidate, req, res)` with no review at all. It is read-only, has no rail, and never redirects.

So a `.md` file sitting next to a reviewed page is the one case where the rail does not follow the link. `lahe review` even prints that "the rail follows links onto any page under that root".

## Requirements

1. **Its own review wins.** A `.md` under the server's root that has its own review in this session gets a 302 redirect to that review's page, the same rule and helper `serveLinked` uses (`ownReviewUrl`). That keeps one live version of the document. When that review's server is not running, `ownReviewUrl` returns null and requirement 2 applies.
2. **Otherwise it rides the folder's review.** When a review in this session backs this server's root (the same `findReviewForRequest` lookup the HTML branch uses, with `roots`), the `.md` renders with that review's rail (`renderMarkdown` with `{ match }`).
3. **Otherwise unchanged.** With no review behind the root, or a root review opened with `--only`, the render stays read-only as today.
4. **Nothing else moves.** Mounted documents, HTML pages, and assets behave exactly as before.

## Approach

No design call. It is one branch in `static_servers.js`, reusing `ownReviewUrl`, `findReviewForRequest` and `renderMarkdown`'s `match` option exactly as the neighbouring branches do. The forge builder's `.md` link stays as it is: with this fix, a `.md` link from any reviewed page works.

## Security note

The security review found no defect. It named one widening, which is intended: a root Markdown file that carries the rail is a hub like any reviewed page, so documents it links to (mounted from outside the root) carry the root review's rail too. A file nothing links to stays plain. This follows the rule that the rail follows whatever the reviewer can click to. A test pins it. The D11 residual in the architecture doc and `docs/ongoing/STATIC_SITE_FOLDER.md` now say HTML and Markdown.

## Tasks

1. Unit tests in `test/unit/linked_docs_rail.test.js` (or a sibling file in its style), written red first.
2. The branch change.
3. `npm run gate:unit`.

| Behavior | Proof | Fails today? |
|---|---|---|
| Root `.md` with its own live review: 302 to that page, no token in the response | unit | yes |
| Root `.md`, no own review, a review backs the root: 200 with the rail's script line for that review | unit | yes |
| Root `.md` with its own review whose server is stopped: falls to the root review's rail | unit | yes |
| Root `.md`, no review backs the root: read-only, no script line | unit | no |
| Root `.md`, the only root review is `--only`: read-only | unit | no |
| Another session's review is never used | unit | no |
| A root `.md` passes its rail to a document it links to outside the root | unit | yes |

## Acceptance

Every row passes and `npm run gate` passes on the merged head. The forge's Progress link opens the served progress page with the rail.
