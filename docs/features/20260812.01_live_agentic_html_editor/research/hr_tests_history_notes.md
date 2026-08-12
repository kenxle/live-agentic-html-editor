# human-review: behavioral requirements, bug scars, and reliability theory

Mined from `/Users/kennethstclair/.claude/tools/human-review/` — 18 test files, 45 commits (2026-07-27 to 2026-08-11), `.github/workflows/`, README, SKILL.md.

Framing: every test below is a requirement someone wrote down after something broke. Every bugfix commit is a scar. Behavior only; no module structure.

---

## 1. Behavioral requirements derived from the tests

### 1.1 Anchoring (attaching a comment to text that later moves)

- A comment stores the selected text plus a slice of the text before and after it, so it can be found again later. ("buildContext captures the quote with surrounding context")
- Context capture clamps at document edges rather than erroring on short documents. ("clamps at both ends")
- A comment still finds its text after the document is rewritten elsewhere. ("findQuote survives edits elsewhere in the document")
- When the same phrase appears several times, the surrounding context decides which occurrence the comment belongs to. ("disambiguates repeats using prefix and suffix")
- A comment whose text no longer exists reports as orphaned rather than silently attaching to the wrong place. ("returns null when the quote is gone")
- An empty or missing anchor never matches anything.
- Reflowed whitespace (a prettier/formatter run, reindentation) must not orphan a comment: matching is whitespace-tolerant, and the result is flagged as a non-exact match. ("survives whitespace reflow inside the quote")
- Whitespace-tolerant matching must still pick the right occurrence among repeats.
- Displayed quote text is whitespace-collapsed and truncated with an ellipsis for the rail.

### 1.2 Commenting

- A comment can target a selected phrase (`kind: selection`) or a whole block/image/section (`kind: element`); for an element comment the quote is the block's label, not its body.
- A comment survives a server restart — comments are stored, not held in memory. ("reopening a page keeps its comments")
- A comment can be reworded any time before it is sent, and the reworded text is what ships. ("a comment can be reworded before it is sent")
- Rewording a comment that doesn't exist returns not-found; rewording it to blank/whitespace is refused.
- Comments on one page never bleed into another page. ("pages are independent of one another")
- Comments made on a Markdown page ship with the `.md` path and instructions to apply them to the Markdown source.

### 1.3 Editing (the user typing into the page)

- Typed markers at the start of a line become lists: `-`, `*` → bulleted; `1.`, `12)` → numbered. Leading whitespace and non-breaking spaces don't block conversion.
- A marker mid-sentence, half-typed (`1`), or attached to text (`-x`, `2.5`) never converts. This is a "don't surprise the typist" requirement.
- A new list must remain visible on pages that reset list styling (Tailwind preflight): bullet and indent are pinned only when the page would otherwise hide them.
- A list the page styles deliberately (custom marker, margin-based indent) is left alone.
- Typed links normalize to something openable: bare domains get `https://`, `mailto:`/`tel:` pass through, surrounding whitespace is trimmed.
- In-page (`#pricing`), root-relative (`/docs/setup`), and relative (`./page.html`) references pass through untouched.
- A link on a page that renders anchors as plain prose gets an underline so it is visible; a link the page already styles is left alone.
- Edits are deduplicated by block label and kind: repeatedly typing in one block yields one edit row, not one per keystroke batch. ("edits dedupe on label and kind")
- Edits carry `before`/`after` plain text and, when formatting changed, `before_html`/`after_html`, so bold/italic/underline/links reach the agent.
- An edit can be `kind: "moved"`, carrying `moved_after`/`moved_before` landing-spot anchors, and those fields must survive the trip through the API. ("a moved edit keeps its landing-spot fields through the API")

### 1.4 Saving and file safety

- A save must name the version of the file it was based on; a save based on a stale version is refused with a conflict and writes nothing. ("a save based on a stale version of the file is refused")
- A successful save hands back the next precondition so the following save can be checked too.
- A queued save carrying a pre-rewrite version loses even if it arrives after the rewrite. ("the pre-rewrite hash no longer wins")
- Everything the review UI added to the live page is stripped before writing: overlay elements, injected styles, highlight wrappers, the contenteditable flag, and element-comment markers. ("serialization strips everything human-review added")
- A highlighted phrase is unwrapped in place, so surrounding markup (`<strong>`) survives intact.
- The doctype survives serialization.
- Edit mode must survive a framework stripping `contenteditable` during hydration.
- A static page must serialize byte-identically to its parsed on-disk copy — this equality is the test for "is this page safe to autosave".
- A page that mutates its own DOM (charts, client apps, late fetch renders) diverges from the disk copy and must be switched to feedback-only, never baked over its source.
- Markdown files are never written: a save against a Markdown page is refused and the source file is unchanged. ("saves are refused so the source file survives")
- Localhost pages are never written: a save is refused with an error naming the app source. ("Do not write this response into Next.js" → 400, error matches /app source/)
- Revert is offered only for real file pages that have a recorded original; localhost pages report `canRevert: false`.
- An agent rewriting the file becomes the new baseline and **clears the page's edit rows**. ("an agent rewrite becomes the new pristine and clears edits")

### 1.5 Page transformation and injection

- Exactly one review script is injected, immediately before `</body>`, and injecting twice never stacks tags.
- Injection is exactly reversible: stripping restores the original bytes; a saved file never keeps the injected tag.
- Fragments with no `<body>`, and pages with only `</html>`, still get the script.
- An inline script containing the literal string `"</body>"` must not fool injection — the tag lands after that string and before the real close. ("a script containing the literal '</body>' does not fool injection")
- For localhost pages: relative asset URLs (css/js/img) are rewritten absolute against the app origin, so the page renders correctly under the review origin.
- For localhost pages: in-page links keep their original relative form, so navigation still reads as app routes.
- For localhost pages: no `<base>` tag is used; instead the real route path is restored via history replacement before `<title>`, so route-aware apps behave.
- The route-restoring script is also stripped on the way out.

### 1.6 Navigation

- Clicking a real link wins over a framework button's `data-href`; both are supported; ordinary controls are ignored.
- A modified-click on a `#hash` link sets the location hash so CSS `:target` prototypes actually change pages.
- If the hash is already current, it scrolls instead of re-navigating.
- Encoded and decoded forms of the same hash are treated as the same target (`#caf%C3%A9` vs `#café`).
- Malformed percent escapes must not crash the click handler.
- A Markdown page can navigate to a sibling Markdown file by link, and the destination is served rendered and flagged as Markdown.
- One batch covers every page visited in a pass, grouped by file/URL, so walking a site and sending once loses nothing.
- Refreshing a page keeps session context and clears stale counts for other pages. ("page refreshes keep session context and clear stale cross-page counts")

### 1.7 Sending and the agent handoff

- A send makes the batch available to a waiting poller immediately; the poller exits with the batch. ("poll exits with the feedback batch when the user sends")
- `poll --timeout N` exits cleanly with `{"status":"timeout"}` and reports seconds waited — it never hangs forever.
- Malformed timeout values (`nope`, `abc`, `0`, missing) fail fast with a message naming the flag, rather than waiting forever.
- `status` answers instantly without blocking: `idle` before feedback, `feedback-waiting` after a send.
- A batch that was sent while nobody was listening is *stranded*, not lost, and is delivered to the next poller.
- A sent batch survives a full server restart and is still delivered. ("a restarted server still delivers the sent batch")
- An acknowledged batch stays acknowledged and is not resurrected by a later write. ("an acked batch is not resurrected by a later save")
- The poll command printed in the UI must be an invocation that will actually work later — resolved when the server starts, not at print time. ("a review keeps the CLI invocation resolved when its server starts")
- Ending the review releases any agent mid-poll with `{"status":"closed"}` and an instruction to stop polling, rather than leaving it to time out.
- Ending the review forgets the session but keeps unsent feedback for the next review.
- The batch's `next_step` text is context-aware: Markdown pages get "apply to the Markdown source", localhost pages get "find the matching project source".

### 1.8 Session and state

- A page's original content is recorded at open time as the revert target.
- Localhost targets are canonicalized: the fragment is dropped, `localhost` and `127.0.0.1` forms are distinct durable keys, and a URL page survives a restart with no backing file.
- Pages older than roughly a month are pruned on load; pages whose file has vanished are pruned.
- Clearing a sent batch removes exactly what it carried — comments by id, edits by timestamp — leaving everything else. ("clearSent removes only the delivered comments")
- Non-image paste types are rejected; pasted images land in an `assets/` folder next to the reviewed file with a name derived from the file, and a second paste never overwrites the first.

### 1.9 Markdown handling

- Only true Markdown extensions count (`.md`, `.markdown`, case-insensitive); `plan.md.html` is not Markdown.
- Markdown renders as a full GFM document including tables, with the filename as title.
- Rendered Markdown never leaks raw Markdown syntax into the page.
- A Markdown page is flagged as such in its state so the UI knows not to save it.

---

## 2. The bug history, grouped by theme

### 2.1 Feedback being destroyed or lost

| Commit | What broke, in user terms | What the fix guarantees |
|---|---|---|
| `2740913` "Don't let a second server wipe the first one's comments" | Two review servers running at once silently dropped each other's pages and comments — the whole in-memory state was written over the file. | Saves merge over what is on disk; a regression test that fails against the old behavior. |
| `19c3ec3` "Never destroy unseen feedback on ack" | An agent whose poll timed out re-ran `poll --ack`; that ack deleted a batch the user had sent while nobody was listening. The user's feedback vanished with no trace. | An ack applies only to a batch the agent actually received. Clearing drops exactly what the batch carried; anything added or retyped after Send survives into the next batch. |
| `27b0a31` "Stop saves from corrupting files" | A debounced autosave landed after the agent had rewritten the file and clobbered the agent's version — no reload signal, no warning. Also, element-comment markers leaked into saved files, and self-rendering pages (charts, client apps) were baked over their own source. | Saves carry the hash of the version they were based on and stale ones are refused. Self-rendering detection extends past page boot via DOM observation. Revert aborts pending saves and edit flushes. Save retries are bounded and pinned to the page they started on. |
| `63e94c3` "Flush pending edits before navigation" | Switching pages or following a link dropped the last moments of typing — whatever was still inside the debounce window. Formatting changes (bold, italic, links) never reached the agent at all. | Page switches flush the debounce windows first; edit rows carry cleaned HTML alongside plain text; returning to a dev-server page explains where the edits went instead of looking like data loss. |
| `9936957` "Click any block to comment on it" | Typed feedback was discarded when the comment card swapped to another block. | Typed feedback is committed, not discarded, on swap. |
| `fd224de` "Test the paths where feedback could be lost" | (No behavior change — a deliberate test sweep over every loss path found so far.) | Ack-after-timeout, post-send survival, stale-save conflicts, malformed timeouts, symlink containment, marker stripping, whitespace anchoring, script-safe injection. |
| `fa8fa41` "Add NEVER rewrite the whole document rule" (Ken's own commit) | Agents applied feedback by regenerating the file or section from context, silently reverting the user's browser edits and reinstating deleted sentences. | A prompt rule only: re-read before editing, key every change to the quote/before string, treat a deletion as feedback, never touch what wasn't raised. **No code enforces this.** |

### 2.2 Sends and submits failing

| Commit | What broke | What the fix guarantees |
|---|---|---|
| `058079c` "note-only sends" | Typing only an overall note left the Send button dead forever. The server accepted note-only batches; the button's enablement counted only comments and edits. | A non-empty note counts toward enablement, the button relabels, and it re-evaluates as you type. **Shipped with no test.** |
| `97a45dc` "never dead-end after Send" | After Send, when nothing was polling, the loop dead-ended silently — the user had no idea their feedback was going nowhere. | A "stranded" agent state distinct from "working", surfaced in the rail with the exact poll command handed over. |
| `81662a7` "Fix edit-html feedback handoff" | The handoff between browser and agent was broken outright. | First poll-handoff regression test. |
| `503b4d4` "hand stranded feedback to agent chats, not terminals" | The stranded remedy was a shell command, useless to anyone driving an agent from a chat UI. | A paste-ready prompt for Claude Code / Codex / Cursor. |
| `0b34420` "End review button" | A user finishing a review left an agent long-polling indefinitely with no way to stop it. | Explicit end: pending edits flush, the poller receives `closed`, other windows show an ended screen, unsent feedback is kept. |
| `8bb9ce4` "CLI robustness: drain stdout" | Large batches piped to an agent arrived **truncated** — the process exited before stdout handed off. | Poll output waits for the stdout handoff before exit. Also: `--timeout` rejects NaN/zero, a busy port exits with a clear message, a missing `xdg-open` is tolerated. |
| `8bb9ce4` (same) "gate server adoption on protocol" | An upgraded CLI adopted a still-running older server, which could not serve the newer editor pieces — the editor silently never loaded. | Protocol check applied on both the fast path and the post-spawn wait loop. |
| `c58f5b4` "discount npx's own PATH entry" | `npx -y human-review setup --global` wrote a bare `human-review` into the skill file because the probe saw npx's transient cache copy. That binary disappears when npx exits, so **every later agent run failed with "command not found"**. | Cache-path resolutions are ignored; falls back to `npx -y human-review`. A real global install still wins. |
| `8b67fab` "Rename skill.md to SKILL.md" | Agents didn't detect the skill at all — discovery keys on the exact uppercase filename. | Source filename matches what setup writes. |

### 2.3 Navigation dropping state or dead-ending

| Commit | What broke | What the fix guarantees |
|---|---|---|
| `058079c` "#hash-link navigation in single-file prototypes" | Single-file prototypes that fake pages with `.page:target` could not be navigated at all in review mode: the click handler scrolled to a `display:none` element and never changed the hash. | Modified-click sets the hash; scroll is only the fallback when the hash is already current. Covers encoded/decoded hashes and malformed escapes. |
| `5e91dee` "Route-aware localhost review" | Proxied localhost pages served under an artifact path, so route-dependent apps rendered wrong and editing died across framework navigation. | Pages serve under their real route paths; `contenteditable` survives framework navigation. |
| `04aa947` "nested-scroller jumps" | Jump-to-comment failed for targets inside an app's own inner scroll container. | Scroll-into-view rather than window scrolling. |
| `c3a6bf4` "Review many pages in one pass" | Walking a multi-page site meant sending (and losing context) per page. | One batch grouped by file; rail lists other pages with feedback. **Breaking payload change.** |
| `97a45dc` | The poll command changed after navigating, so the user copied a command naming the wrong file. | The poll command always names the entry file. |

### 2.4 Anchoring and labeling drift

| Commit | What broke | What the fix guarantees |
|---|---|---|
| `04aa947` "whitespace-tolerant anchors" | A formatter reflow orphaned every comment on the page. | Whitespace-collapsed fallback matching, flagged as inexact. |
| `04aa947` "safe SDK injection" | A page with an inline script containing the literal `"</body>"` got its script corrupted by injection. | Inject before the *last* `</body>`. |
| `a1151d7` "Pin edit labels" | Typing into a block with no heading produced one edit row per intermediate wording — the agent received a pile of contradictory partial edits. | Labels pinned on first computation: one row per block. |
| `a1151d7` "re-anchor element comments" | After an agent rewrite, Jump-to on an element comment stopped working. | The element marker is re-stamped on reload. |
| `9936957` "Sibling blocks get numbered labels" | Two paragraphs under one heading collapsed into a single edit row, so one of the user's edits was invisible. | Numbered sibling labels. |

### 2.5 Visibility / silent no-op bugs in the editor

| Commit | What broke | What the fix guarantees |
|---|---|---|
| `e18366a` / `503b4d4` | ⌘K links created on pages that reset anchor styling were **invisible** — the user thought the link failed. | An inline underline is added only when neither color nor decoration distinguishes the link. |
| `503b4d4` | New lists were invisible under CSS resets (Tailwind preflight), and Chrome nested the list inside a paragraph. | Bullet/indent pinned only when the page would hide them; list hoisted out of the paragraph. |
| `503b4d4` | Desktop file drops navigated the frame away from the review. | File drops no longer navigate. |
| `e18366a` | The relay dropped a block-move's landing-spot fields, so the agent could not tell where the block went. | Round-trip test on the moved-edit fields. |
| `0d0a829` | Image resizes were lost because only inner markup was captured, and a void element like `<img>` has none. | Whole-element serialization for edit rows. |
| `e18366a` | Scroll handling repositioned overlays on every scroll event (layout thrash). | Once per frame. |
| `97a45dc` | Hover chips clamped onto zero-box targets (collapsed tabs). | Chips hide instead. |

### 2.6 Test/CI harness scars (their own reliability tax)

- `7ebd85f`: Node 20 test discovery found nothing with a quoted glob; jsdom v30 needed Node 22; the CLI's keep-alive sockets hung Windows CI for 45 minutes.
- `5af23b6`: Windows test processes lingered on stray handles → force-exit added; server cleanup scoped so temp-dir removal doesn't race Windows file locks.
- `4ea192b`: nested subtests plus child processes tripped the runner's cancellation accounting on Windows; the tests were flattened to sequential top-level tests carrying module state between them.
- `8c5f7ef`: Windows CLI probes flashed console windows at the user.

**Read this pattern:** three separate commits to make a small test suite pass on Windows, and the fix was to weaken the test structure (flat tests sharing module-scope state, force-exit). The suite is fragile at the process boundary — exactly where the tool's real failures live.

---

## 3. Security and safety requirements the tests encode

### Origin and frame isolation (`frame-policy.test.js`, `security.test.js`, commit `25f4b5b`, `e68361a`)

- File reviews and Markdown reviews run in a frame with an **opaque origin** — no `allow-same-origin` — so the reviewed page cannot read sibling files through the artifact route. Messages from it are expected from origin `"null"` and posted back with `"*"`.
- Localhost app reviews **keep** `allow-same-origin` (the app needs its real origin to work), and both message directions are pinned to the artifact origin exactly.
- Messages arriving from any other origin, or any source other than the review frame, are rejected.
- The artifact frame lives on an alternate loopback hostname from the control UI, so the two are cross-origin by construction.

### Authentication (`security.test.js`)

- Every API call requires a per-run token; calls without it are rejected with 401.
- The token travels in a **header only, never a query string**, and is compared in constant time.
- The token is written to a server record file with owner-only permissions (0600) on non-Windows.
- A request with a foreign `Host` header is rejected with 403 everywhere, closing DNS rebinding.

### Filesystem containment (`state.test.js`, commit `66ceb2b`)

- Asset requests may not escape the reviewed file's directory: `../secret.txt` and `../../etc/passwd` resolve to nothing.
- A **symlink planted inside** the directory that points outside it resolves to nothing — containment is checked against the real resolved path, not the requested one. Legitimate siblings still resolve (to their real path).
- Malformed percent-encoding is a miss, not a crash.
- All atomic writes go through a uniquely and exclusively created temp name, so a pre-planted symlink cannot redirect a save, and failed renames clean up.

### Content sanitization (`markdown.test.js`, `editing.test.js`, commit `e68361a`)

- Raw HTML inside Markdown is rendered as **visible text, never active markup**: no `<script>`, `<iframe>`, or `<svg>` elements exist in the output DOM.
- No attribute starting with `on` ever becomes active.
- `javascript:` hrefs, `javascript:` srcs, and `data:text/html` srcs never survive — but the readable label of the bad link is preserved so the user still sees what was there.
- Legitimate relative, absolute, `mailto:`, and relative-image links pass through untouched.
- The earlier approach was a regex script-strip; it was replaced with a renderer that makes the HTML inert by construction.
- Typed links reject `javascript:`, `JavaScript:`, `java\tscript:` (control characters can't smuggle a scheme), `data:text/html`, `vbscript:`, and unknown schemes.

### Upload safety (`asset-paste.test.js`)

- Only raster image types are accepted (png/jpeg/gif/webp). **SVG is refused**, explicitly because it can carry script.
- A paste never overwrites an existing asset — names increment.

### Network boundary (`url-review.test.js`, commit `a1151d7`)

- Review targets are limited to localhost; a non-local URL is rejected with a message saying so.
- A localhost page that **redirects to an external host** is rejected rather than followed.
- The proxy fetch is bounded: 30-second timeout, 24MB body cap, matching the inbound request limit.

---

## 4. Concurrency requirements

**Two servers / two agents (`concurrent.test.js`, commit `2740913`)**
- Two review servers may run at once. Each keeps its own in-memory copy and writes by merging over what is on disk. Neither may drop the other's pages or comments. The regression test explicitly interleaves: server A opens and comments, server B opens and comments, server A comments again, and all three comments must be present in a fresh read.
- This is a last-write-merge, not a lock. It reconciles *pages* and *comments*, not conflicting edits to the same field.

**Overlapping polls (`feedback-safety.test.js`, commit `19c3ec3`)**
- An ack is only valid for a batch the acking agent actually received. A re-issued `poll --ack` after a timeout must **deliver** the stranded batch, not destroy it.
- After delivery, the batch stays in "feedback waiting" until a real ack arrives — delivery alone is not acknowledgment.
- Feedback created in the window between Send and ack belongs to the **next** batch and must survive the ack intact, formatting included. The test adds both a comment and an edit in that window and asserts both survive, then asserts the surviving edit's HTML ships in the following batch.
- Clearing a batch drops comments by id and edits by timestamp — precise removal, not truncation.

**Save races (`feedback-safety.test.js`, commit `27b0a31`)**
- Every save names the disk version it was based on. A save naming the wrong version is rejected with 409 and writes nothing.
- The named race: an agent rewrites the file while a debounced autosave is queued. The queued save still names the pre-rewrite version and must lose.
- A rejected save is abandoned, not retried — the agent's version arrives via a reload instead.

**Restart mid-session (`agent-loop.test.js`, `state.test.js`)**
- Killing the server mid-session and starting a new one must still deliver a batch that was sent before the kill.
- An unacked batch survives a restart; an acked batch is not resurrected by a later state write.
- Sessions with no live browser connection are forgotten after 30 minutes; the whole server exits after 45 minutes with no browser and no poller.

**Two tabs on the same session**
- Only one behavior is specified: ending the review in one window shows an ended screen in the others. Everything else about two tabs is unspecified and untested.

**Page refresh (`chrome-session.test.js`)**
- A refresh keeps the session identity in the request and must clear stale counts for other pages, so the rail doesn't show phantom feedback.

---

## 5. What is NOT tested

Capabilities the README and SKILL.md advertise, with no coverage:

**The entire browser UI.** There is no end-to-end or browser-driven test anywhere. jsdom is used only to assert string properties of serialized/rendered HTML. Nothing exercises a real page load, a real keystroke, a real click, or a real drag.

- **Send-button enablement** — the exact thing that broke in `058079c` (note-only sends dead forever). The fix shipped with zero tests, and the `sent`/`stranded` disabling logic has none either.
- **The event stream** (reload, agent-state, refresh, ended events). None of it is tested, including the reconnect behavior, which is a no-op comment in the source.
- **The file watcher → reload path.** Never tested. This is the path that replaces the user's live page with the agent's version.
- **Flush-before-navigation** (`63e94c3`, a data-loss fix). No test.
- **Autosave debounce behavior** (700ms save, 500ms edit flush). No test of what happens to keystrokes inside those windows when something else fires.
- **Revert.** No test beyond asserting URL pages can't revert.
- **Drag-to-move blocks, drag-to-resize images, drag-to-move images.** Only the resulting API row shape is round-tripped; the interaction and the resulting edit content are untested.
- **Clipboard paste → insert at caret.** Only the server-side asset write is tested.
- **⌘K link popup, list keyboard shortcuts, Tab/Shift+Tab indent.** Only the pure decision helpers are tested, not the editing they drive.
- **Comment highlight placement in a live DOM, and the orphaned-comment state.** Only string matching is tested.
- **Element comments end to end** — only the marker's *removal* on save is tested.
- **Multi-page walk with cmd-click** and the "other pages with feedback" rail. Untested despite being a headline feature.
- **Two browser tabs.** `concurrent.test.js` is two stores in one process, not two browsers.
- **Session expiry (30 min) and idle server shutdown (45 min).** No test of what the open browser tab does afterward.
- **Localhost apps that navigate themselves** (client-side routing, POSTs, form submits, auth redirects). One happy-path GET and one redirect rejection is the whole coverage.
- **The agent side of the loop.** Nothing tests that an agent applies feedback correctly, applies it once, or doesn't revert user edits — the `NEVER rewrite the whole document` rule is prose in a prompt with no enforcement, no marker, no diff check.
- **Truncation/size limits on the batch itself.** The stdout drain fix has no regression test.

---

## 6. Reliability verdict

### (a) Why typed text gets reverted

Five distinct mechanisms, most of them by design:

1. **The unflushed debounce window plus a server-pushed reload.** Typing is held for 700ms (save) and 500ms (edit row) before it leaves the page. When the agent writes the file, the watcher fires within 400ms and pushes a reload; the iframe is re-pointed at the artifact URL immediately. There is a flush handshake for *user-initiated* navigation (added in `63e94c3` precisely because typing was being dropped) but **no flush on the server-pushed reload path**. Any keystroke inside those windows when the agent saves is gone, with no trace and no toast.

2. **An agent write clears the page's edit rows outright.** This is a *tested requirement*: "an agent rewrite becomes the new pristine and clears edits". So when the agent saves the file, every edit row the user had accumulated for that page — including ones the agent never addressed — is discarded. The UI's only mitigation is a toast: "Agent rewrote N blocks you had edited". Those edits are then never sent to anyone. On a Markdown or localhost page, where the user's typing exists *only* as edit rows, this is total loss of that page's work.

3. **A conflicting save is abandoned, not merged.** When the user's autosave loses the version check (409), the source comment says it plainly: "this save is abandoned, not retried". The agent's version then arrives via reload and the user's on-screen text disappears. Combine with (2) and the same event both discards the save and discards the record of what was typed.

4. **Feedback-only pages revert visually on every reload by construction.** Markdown pages, localhost pages, and any page detected as self-rendering are never written to disk. Every reload — agent save, page switch, refresh — repaints from source, so the user's typing visibly vanishes. The tool acknowledges this with a toast ("this page renders from your dev server — N edits are queued") added *because it reads as data loss*. It reads as data loss because it is indistinguishable from data loss, and per (2) it can become data loss.

5. **The agent itself rewrites the document.** The strongest evidence here is Ken's own commit `fa8fa41`, the newest in the repo: an entire SKILL.md section titled "NEVER rewrite the whole document", stating "breaking it destroys the user's work" and "the file on disk is not the file in your context". Nothing in the tool detects or prevents a wholesale rewrite. The batch does not carry a content hash the agent must respect, edits are not applied as patches, and there is no post-apply check that the user's `after` strings are still present. It is a prompt rule against a model's strongest habit.

**Rebuild implication:** the user's typing must have a durable home that an agent write cannot clear. Never discard edit rows on an external write; flush before any reload including server-pushed ones; and verify after the agent applies that every `after` string is present in the file, failing loud when it isn't.

### (b) Why the submit button stops working

Three mechanisms, all in how the button's enabled state is derived:

1. **The button is disabled whenever no agent is currently long-polling.** The rail computes a "stranded" state when a batch is pending and no poller is registered, and stranded **disables Send** with the label "Sent — agent is not listening". So the button's liveness depends on an external process holding a blocking foreground poll — the single least reliable thing in the system. The moment the agent's turn ends, its poll dies, the state flips to stranded, and the button is dead. The user's remedy is a copy-paste prompt, not a working button.

2. **The button stays disabled after a send until a specific event un-sticks it.** `sent` is set true on Send and is only cleared by loading a page, adding a comment, an edit row arriving from the frame, rewording a comment, or a refresh event. Typing into the overall-note box re-renders but does **not** clear it. So: send a batch, then think of one more thing and type it as a note — the button is disabled and labeled "Sent — waiting for agent". This is the exact same class of bug as `058079c` (note-only sends), which shipped for weeks and was fixed with no test. The `sent`-sticking variant is still present.

3. **The session can expire out from under the open tab.** A session with no live event-stream client for 30 minutes is deleted, and the server exits entirely after 45 minutes with no browser and no poller. The event stream's error handler is an empty comment relying on the browser to reconnect. A backgrounded or slept tab that loses the stream past the threshold has its session forgotten; Send then fails with "unknown session" as a transient toast, and there is no client-side re-establish. There is no test for any of this.

**Rebuild implication:** the ability to submit must depend only on whether the user has unsent feedback. Whether an agent is listening is information to display, never a gate. Feedback should land in durable storage on submit regardless of listener presence, and the session should be re-establishable from the open page.

### (c) Why agents don't reliably pick up feedback

The handoff is a blocking foreground CLI long-poll, and every failure mode follows from that:

1. **Agents end their turns.** SKILL.md has to plead: "Keep this command in the foreground. Do not end your turn while it is waiting. If your shell returns a process or session handle, keep waiting on that handle." That is a prompt fighting the runtime's natural behavior. When it loses, the batch is stranded and the UI goes into its dead-button state.

2. **The target key must match exactly, or the poller registers against a different page.** The Markdown test contains the tell: "The server canonicalizes paths (symlinked tmpdirs on macOS), so match on realpath". On macOS, an agent polling a symlinked path (`/tmp/...`, or any path through a symlinked directory) registers under a key the send doesn't reach. The user sees "agent is not listening" while an agent *is* listening — to the wrong key. No test covers a mismatched-path poll.

3. **Delivery and acknowledgment are separate, and nothing enforces exactly-once.** A batch stays "waiting" until an explicit `--ack`. An agent that polls without `--ack`, applies the feedback, and polls again receives **the same batch again** and applies it twice. Conversely `19c3ec3` shows the opposite failure was live in production: an ack from a timed-out poll deleted a batch the agent never saw. Both directions are convention, not protocol.

4. **The invocation written into the skill file was wrong for anyone who installed via npx** (`c58f5b4`): a bare `human-review` resolved from npx's transient cache, so every later agent run failed with "command not found". A silent, total handoff failure whose only symptom is the agent never picking anything up.

5. **Version skew silently breaks the editor** (`8bb9ce4`): an upgraded CLI adopting an older running server could not serve the newer editor pieces. The protocol gate fixes adoption but there is no user-visible signal when a stale server is running.

6. **Large batches were silently truncated on the way to the agent** (`8bb9ce4`) until stdout drain was fixed. The agent received a partial batch and applied partial feedback — indistinguishable, to the user, from the agent ignoring them. No regression test.

**Rebuild implication:** don't make delivery depend on a process holding a blocking read. Persist the batch, let the agent pull it whenever it next runs, key it by a stable identifier the agent can't get wrong, and make acknowledgment a positive confirmation that names the batch it applied so exactly-once is enforced rather than assumed.

### The one-line summary

The tool's *storage* layer is careful and well-tested — anchoring, containment, precondition writes, batch survival. Its *liveness* layer — the debounce windows, the reload push, the button's dependence on a foreign process, the blocking-poll handoff — is almost entirely untested, and every symptom the user reports lives there.
