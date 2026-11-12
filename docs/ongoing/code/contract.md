---
read-when: Changing a file in src/contract/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/contract/`: the contract between the server and the browser

This folder holds the contract between the server and the browser: shapes, constant tables, and the parsers that turn untrusted input into those shapes. It imports nothing, and both the server and the bundle load it.

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## `markers.ts`: what Lahe added to a page

Nothing the tool adds to a page may end up in the reviewer's feedback. That is only enforceable with exactly one spelling of "this node is ours", so it is spelled here, and the normalizer's `cleanMarkup` strips by these names.

The one attribute that says a node is the tool's is `data-lahe`, and its value is the node's role:

- `chrome` is tool furniture: a chip, a handle, the rail. Capture drops it with its whole subtree.
- `wrap` is a wrapper the tool put around reviewed content. Capture unwraps it: the tag goes and the children stay. Nothing writes it today, since highlights moved to the CSS Custom Highlight API, but old markup may still carry it, so the role is still read.

Every attribute starting with `data-lahe` is stripped on capture, matched without regard to case because HTML attribute names have none. Every class token starting with `lahe-` is stripped, matched with case because class tokens have it. The five attributes the tool writes are typed `data-lahe...`, so one that would survive capture does not compile.

`lahe-surface-root` is the id of the one element the library puts in the page: a chrome-marked `div` holding a closed shadow root, inside which everything the library draws lives (the rail, comment boxes, the pick outline). Highlight's surface code creates it. Anything under it is tool DOM by construction.

The attributes, and why each exists:

- `data-lahe-protected` is set on a region while the reviewer edits it. Turbo reads `data-turbo-permanent` natively, but that alone does not say who put it there, so the veto handler and replay check the tool's own attribute.
- `data-review-region` is an author's, not the tool's: a page author may put it on their markup to give a region a stable label. The tool never writes it and never strips it.
- `data-lahe-id` is identity Lahe assigns rather than infers. It is written onto the live element the moment the reviewer touches it. Everything else in the anchor engine recognizes an element again from what it looks like; this is the one signal true by construction. It is stripped from `before_html` and `after_html` like every tool attribute, because it is not the reviewer's content. It reaches an agent as its own field instead, which is what the agent needs to write it into the source. The skill tells agents to keep it, so its value is part of what agents see.
- `data-lahe-file-title`, always with the value `file-name`, marks the hero title a Markdown render takes from the file name when the file has no `#` heading. The title is not in the file, so it is page chrome: the block reader skips it, a run starts after it, and no agent is asked to write it. Only the server's Markdown render sets it.
- The `<meta name="lahe-render-note">` is on a rendered Markdown page that pandoc did not render and whose source has a fenced div, so its `:::` blocks show as text. The rail shows its own fixed line when it finds it. Only the server's Markdown render writes it.
- `data-lahe-edit-host` is set by the layer on the editing host (the nearest ancestor holding the anchor and its run) while a writing session is open, and removed at commit. One highlight rule hides that element's focus ring by matching this attribute and nothing of the page's own.

The node questions take a structural `MarkedNode`, because this folder has no DOM types. A DOM `Element`, `Text` and `ParentNode` all fit it with no cast, and so do the fake nodes the unit tests build. A text node is the one with no `getAttribute`.

Known edges, unchanged: `isInsideOverlay` started at a text node is false even inside the overlay, because the walk stops at the first node that is not an element. An element inside the closed shadow root walks up to the shadow root and stops there; events from inside it are retargeted to the host element, whose id matches, so event targets still answer true.

## `failures.ts`: what can fail, and what the reviewer is told

Failures are loud and they persist, and that is only checkable with one vocabulary for what failed. Each code's sentence is written once here, so two places cannot word one failure two ways.

Each code carries:

- `severity`: blocking, warning or info;
- `persistent`: whether it stays in the rail's failures list until the reviewer dismisses it, or is a passing message;
- `surface`: where it shows, the failures list, a card, or the CLI;
- `message` and `remedy`: what the reviewer reads, and what to do (or `null` when there is nothing to do);
- `standing` and `offer`, below.

The code list is the source of the `FailureCode` type, and the table is checked against it, so a code with no row, or a row with no code, fails to compile.

Codes worth knowing the reason for:

- `CSP_REFUSED` and `HELPER_UNREACHABLE` are two codes on purpose. They look the same to a `fetch` and need opposite fixes: one is "start the helper", the other is "this page's own policy refuses the connection".
- `SECOND_WINDOW_REFUSED`: two windows sharing one draft bucket means the last keystroke wins and the other window's work disappears without a word. Refusing costs the reviewer nothing, and the takeover is one button.
- `ANCHOR_LOST` is kept for records written before the uniqueness verdicts got their own codes. A failed safe match is not proof that content was deleted, so even this old wording stays neutral.
- `REPLAY_NEITHER_MATCHES`: neither the before nor the after matches the page (two people, or a rebuild, changed the region), and writing either would clobber a change nobody asked to lose.
- The four `RUN_*` refusals are the server's answers to a run event. The server refuses rather than cleans, so a forged or runaway record shows up instead of being quietly repaired. `normalize.cleanBlock` returns `RUN_BLOCK_REFUSED` itself.
- `REPLAY_RUN_WRONG_TAG` and `REPLAY_RUN_PLACED_ELSEWHERE` are card notes whose `{first words}` and `{type}` the layer fills in. The second is for the reviewer only and never reaches `review.json`.
- `HELPER_CONTRACT_OLDER`: the layer read the server's health and it reports an older service contract, so nothing is posted to it.
- `CHOICE_REFUSED`: the layer never sends a choice record the server would refuse, so this code appears only for a forgery. `CHOICE_GROUP_INERT` is a group the agent wrote wrong; it is drawn as plain content, and its detail names each group and why, ready to hand to the agent.
- `REPLY_LINE_MALFORMED`: the server skips a bad reply line and never dies. Exiting on one agent's typo would take the reviewer's session with it, a worse failure than the one it reports.
- The `PROTO_*` refusals are each logged by the server naming the check that failed, which is what makes "outside cannot get in" observable. The ordered list of checks and each code's HTTP status are in `protocol`.
- The Library's refusals are shown with their remedy line, so each says what the reviewer can do next.
- `COPY_FAILED` and `EXPORT_FAILED`: Copy and Export are always meant to work, so the code is for when they did not. A control that looked like it worked and did not is the failure this tool exists to remove, and the reviewer would find out only when they paste.

**Old spellings.** Six aliases resolve to their canonical code and keep their own spelling in the failure they return, so a rail chip and its dismissal still match. No source code types them now; they stay because browser storage and old records may still hold them. For the same reason `chipAction` and `isCopyable` take any string, because the rail asks them about chip codes it read back from storage, which may be an old spelling or a code that no longer exists. They answer `null` and `false` for anything that is not a failure name, and the chip still renders from its stored words. `describe` and `failure` take a `FailureName`, so only a JavaScript caller can reach the throw for an unknown name.

**Standing codes** describe a state rather than an occurrence. Raising one again means "still true", so its chip must not grow a x N counter. A reviewer whose window was refused across four Turbo navigations read "x4" as four other windows, and an unreachable server's "x7" counted the page's own retries. `CHOICE_GROUP_INERT` is re-raised on every arming pass while a broken group is on the page.

**What a chip may offer** lives in the code's own row, so adding a code is the same edit as deciding its controls. These choices used to live in the rail, three files away, and a new failure could quietly get neither.

- An *action*: the reviewer fixes it right there, with a button. The click goes through the rail's `runAction`, so boot still owns what the button does. Only `SECOND_WINDOW_REFUSED` has one ("Review here").
- *Copy*: the failure is fixed somewhere the reviewer is not, and the chip's detail is a sentence to hand to their agent as is. The codes whose remedy is agent work have it: the reply line an agent wrote, the add step that mints a token, the origin and CSP setup, and a broken choice group.
- Never both. A copy button once displaced the one button that actually fixed the failure; the offer is one value of three kinds, so a code cannot be both.

**Anchor badges.** Two places clear the badges an unbound anchor leaves on a card: replay, when the anchor binds again, and the Done tab, when a reply folds as handled. They share `ANCHOR_FAILURE_CODES`, so a badge cannot outlive its state because one copy of a list gained a code. `ANCHOR_LOST` is in it so a card drawn by an older build still clears.

**A full browser storage while typing.** The store writes synchronously on every keystroke and throws when storage is full, with the failure attached to the error. Left alone, that throw comes straight out of the input handler, so a full storage stops the block or comment box taking keystrokes and shows nothing. `tolerateStorageQuota` reports a quota failure and swallows it, so the reviewer keeps typing and the rail says what could not be saved. Every other error is rethrown, because a silently dropped bug in the write path is the failure this tool exists to remove. The report is guarded only against the same failure, because the rail remembers its chips in the same storage that just refused the write. The report may be left out or be `null`: the comment and edit surfaces pass `null` when nothing is listening. `isStorageQuota` checks only the code, trusting the rest because only `failure()` builds these objects.

## `style-rules.ts`: style ids, colours and names

An id arrives from outside Lahe's own code in five places (install, a served path, Markdown frontmatter, a note, the list the rail fetches), and all five check it with this one rule. A value that fails is no style at all. The checks narrow to branded types, so code past the check can ask for a checked id.

- `international` is the house style: always there, never installed.
- A palette value reaches an inline style only after the hex check.
- A style name is written into the note to the agent, so it allows only letters, digits, spaces, hyphens, apostrophes and ampersands, and cannot carry an instruction's punctuation.
- Only the first six palette colours are shown.

The source must spell any bidi control character as an escape; `styles.test.js` reads the file to check.

## `json-object.ts`: narrowing parsed JSON

The parsers in this folder take `unknown` and read fields only after `isJsonObject` has said the value is a plain object. An array is not one, even though `typeof` says `"object"`.

## `safe-id.ts`: ids that become path components

Review ids, agent names, session ids and Library request ids all end up in a file path or a command line, so they share one rule. The first character is a letter or digit, which rules out `.` and `..`, hidden files, and an id that looks like a flag. Sixty-four characters is enough for every id Lahe mints. `replies-<agent>.jsonl` uses the same character class, built from this pattern so the two cannot drift.

## `service-contract.ts`: the contract number

`API_VERSION` names the URL scheme and can stay `v1` while the helper's behavior moves on. The helper is long-running and shared: it keeps its modules in memory while it serves a freshly rebuilt browser bundle from disk, so a new rail can end up talking to yesterday's helper. `SERVICE_CONTRACT` is an integer bumped whenever a helper that old cannot safely back a newly built CLI or layer. The CLI and the layer read it from `/health`: an older helper is restarted; a newer one means this clone is behind, and it must not bounce a newer shared helper backward. A helper that reports no number is older.

This is not the source-stamp check (`source_stamp.js`), which restarts a helper whose loaded files changed on disk. The contract number is what catches a different clone, or a helper started before a protocol change.

**When you bump it,** add a row below in the same commit. `test/unit/contract/service-contract.test.ts` fails if the current number has no row.

| Contract | What a helper below it lacks |
| --- | --- |
| 9 | `reply.at`, so it cannot back the timestamped rail. |
| 10 | Wake-feed lines and `agent_liveness`, so a tail-armed agent would sleep through work and the rail could not tell whether an agent is watching. |
| 11 | `user_needs_to_see_reply` in the reply fold, so a flagged reply would lose its flag and never badge the reviewer. |
| 12 | Rendering on request: its static servers hand back raw Markdown from a source mount, so a document's links to other local documents download or 404. |
| 13 | A window-session table on disk: it keeps it in memory, so replacing the helper throws every open page out of its review, and it leaves no `windows.json` for a CLI command to ask whether anybody is reviewing. |
| 14 | The block allowlist and the size ceiling on free-writing run records, and `new_blocks` in the projection, so an agent would never see the reviewer's new text. |
| 15 | The Library routes (`/catalog` and its API), the replay of `origin.removed`, the reopened-session sweep and `catalog_seen_at`, so `lahe library` would print a URL that 404s, and a restarted static server's stale origins would come back. |
| 16 | Serving pages itself: no pages port, no site registry and no `site.bind`, so `lahe review` could not give a page its stable address. |
| 17 | `review.retire`; it also takes events for a retired review, answers `records.read` for one review only, and binds a file into its own folder site even inside a reviewed folder, so one file could get two addresses. |

## `helper-address.ts`: where the helper listens

Port 7817 is fixed by default and changed only with `--port`. A page has the port baked into its script tag and no way to learn a new one, so an ephemeral port would break reconnecting the first time the helper restarted.

The helper binds loopback only, and the Host check allows only `127.0.0.1`, `localhost` and `[::1]`, at any port. That check is what stops DNS rebinding: a hostile name that resolves to 127.0.0.1 still arrives with its own name in Host. The check ignores the port on purpose; the listener already decides which port answers. The old list also named a bare `::1`, which could never match: stripping a trailing `:<digits>` turns it into `:`. A bare IPv6 address is not a valid Host anyway, so the new list leaves it out.

## `review-write.ts`: what `review.write` accepts

A review is guarded by two factors: its token and its origin allowlist. The token is on the script tag, so any script on an allowed page can read it. `review.write` takes origins in its body, so if it accepted any origin, a script on an allowed page could add its own and leave the token as the only factor. So the route accepts only what `lahe add` legitimately sends: `"null"` (a page opened from a file) and `http` or `https` on a loopback host, at most 16 per review. Sixteen covers the ordinary spread (two loopback names, a few ports, both schemes) and refuses a caller that keeps adding. `lahe add` writing the review to disk may register wider origins, because there a person typed `--origin` at a terminal.

The check matches what a browser sends in Origin, character for character. It is a regular expression and a port check, not `new URL`, because this folder has no DOM and no Node types. The tests list every case `URL` used to decide.

The same narrowing applies to two flags. `only_recorded_pages` and `notes` are accepted as `true` and never as `false`: narrowing is the reviewer's choice, and widening a review back out is what a leaked token would ask for.

## `site-addresses.ts`: sites and Host classification

A site is a folder, or one notes page, that the helper serves at `http://<name>.lahe.localhost:1483/<path>`. Only `site.bind` makes names, and only the CLI can call it. Every browser treats `.localhost` names as this computer and as secure with no setup, which is the reason `lahe status` prints.

`classifyHost` runs first in every request, on both listeners, and sorts the Host into the API (a loopback name), the Library (`library.lahe.localhost`), a page (`<name>.lahe.localhost`, one to four labels), or bad. Whether a page name is registered is the registry's question, asked afterwards. The port is checked before the Library's name: the Library answers at the pages port or with no port (the port-80 forward), never at another.

The short `.lahe` ending counts only once the helper has proved its own name server answers `.lahe` lookups on this computer (`addresses.js`), and never for the Library. Without that proof, a website that answers its own `.lahe` name could pass as a page. `siteNameFromOrigin` follows the same rule for an Origin header.

Every page response carries `Cross-Origin-Resource-Policy: same-origin` (`PAGES.CORP`), so another site cannot embed it.

## `headers.ts`: headers and the signed-request wire

- `x-lahe-client` has one job: to be a header a form or an image tag cannot set, so a CORS-simple request never reaches a handler. Review routes accept `layer` and `cli`. The Library page sends `catalog`, which review routes refuse on purpose: that page holds no review token.
- `x-lahe-token` is the per-review token. Anything running on the reviewed page can read it, which is why it is scoped to one review and never to the machine.
- `x-lahe-request-id` is echoed on every response, so a chip on the rail can be matched to a line in the helper log.
- The `sec-fetch-*` headers are set by the browser and never by a script. The Library's routes read them to tell their own page from a document on another loopback port.
- `x-lahe-cli-secret` is read from an owner-only file in the state folder and sent only by the CLI, so a page holding a review token still cannot name a file to serve.
- The menu bar app proves it can read that secret without sending it. The signed string is these lines joined by single newlines, with no trailing newline. A request: `lahe-proof-v1`, the method, the path with its query exactly as sent, the timestamp in Unix milliseconds, the nonce, and the hex SHA-256 of the body. The answer: `lahe-proof-reply-v1`, the request's nonce, the status code, and the hex SHA-256 of the response body. A timestamp more than 30 seconds from the helper's clock either way is refused. The nonce is 16 random bytes as lowercase hex, and the MAC is a lowercase hex HMAC-SHA256 keyed by the CLI secret. A program squatting on the port learns one used proof and nothing else.
- `summary.read` answers in version `SUMMARY_VERSION`. The app sends the version it was built for, and any other gets a signed 409.

## `flush.ts`: the draft flush policy

This decides how fast the log grows and how much of a sentence a crash can cost.

- Browser storage gets every keystroke, synchronously, with no debounce. A reload, a crash or a sleep costs nothing.
- The helper gets queued events within 750ms.
- An item whose queued events are all drafts goes to the helper at most once per 10 seconds. The browser already has every keystroke, so the helper's copy is a crash backup, and a few seconds of it is an acceptable loss. It is a deadline from the item's last draft post, not a timer that typing pushes back, and `flush` itself applies it, so the poll loop cannot get round it.
- A free-writing run record's drafts carry the whole run, so they wait 30 seconds. A commit is never held.
- Every event of a choice item waits until 3 seconds after the page's last press, so presses close together reach the helper in one post and wake the agent once, capped at 10 seconds from the first held press so steady clicking cannot hold work back.
- `blur`, `hide`, `ready`, `navigation` and `unload` flush at once, past the debounce and the draft floor. `hide` is the tab being hidden, often the last thing a page hears before the browser discards it. Hold's gate still applies.
- **The unload post uses `fetch` with `keepalive: true`, never `sendBeacon`.** `sendBeacon` cannot set the custom header or the JSON content type, so it would either drop the header or be refused during unload, when nothing is watching. Keepalive carries headers at the cost of a body limit of about 64KB across all in-flight keepalive requests. A body too large for it is already safe in browser storage and goes on the next load: the cap costs latency, never work.

`fitsKeepalive` counts UTF-8 bytes by code point, as `TextEncoder` would; this folder has neither `TextEncoder` nor `Buffer`. A lone surrogate counts 3 bytes, as the browser's encoder writes it as U+FFFD.
