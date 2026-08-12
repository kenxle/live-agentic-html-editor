# human-review: agent-facing and server-facing feature spec

Extracted read-only from the `petergyang/human-review` clone at
`/Users/kennethstclair/.claude/tools/human-review/` (package version 0.6.0, wire protocol 7,
Node >= 20, single runtime dependency `marked`).

This describes **what the tool does**, not how it is built. Nothing here is a recommendation to
copy their structure.

---

## 1. CLI surface

The binary is `human-review`. Agents are told to invoke it as either `human-review` (when it is on
PATH) or `npx -y human-review` (fallback). All five forms below are the complete command surface;
there is no `reset`, no `stop`, no `list`, no `version` subcommand beyond the flag.

### 1.1 `human-review <target>` — open a review

Syntax: `human-review <path-to-file | http://localhost:PORT/path>`

Behavior:

1. Canonicalizes the target (file path -> realpath; URL -> normalized loopback URL with the
   fragment stripped).
2. For a file target, checks existence first. Missing file prints `File not found: <abs path>` to
   stderr and exits **1**.
3. Finds or starts a background review server: reads a saved server record, and adopts it only if
   its recorded protocol number matches this CLI's and a health probe answers within 1.2s.
   Otherwise it spawns a new detached server and polls for up to 6 seconds (60 x 100ms) for a
   matching record. Failure raises `Could not start the local human-review server.` and exits 1.
4. Registers the target as a reviewable page and creates a browser session.
5. Opens the OS default browser at the session URL (`open` / `cmd /c start` / `xdg-open`). A
   missing opener is swallowed; the printed URL is the fallback.
6. Returns immediately. It does **not** block.

Prints on success (stdout):

```
Reviewing <basename or full URL>
http://127.0.0.1:<port>/s/<sessionId>

Waiting for feedback? Run:
  human-review poll <shell-quoted target>
```

Exit **0**. On a server-side open failure (e.g. the localhost page does not answer) it prints the
server's error message to stderr and exits **1**.

### 1.2 `human-review poll <target> [--ack] [--timeout <secs>]` — block for feedback

This is the agent's blocking wait. Syntax notes:

- The first non-flag argument is the target. `--timeout 600` and `--timeout=600` both parse.
- A malformed or non-positive `--timeout` throws `--timeout wants a number of seconds, e.g.
  --timeout 300` and exits 1 (deliberate: a silent `NaN` would hang forever).
- **With no `--timeout` the command waits forever.** The server never closes the connection on its
  own; it emits a single space every 15 seconds as a keep-alive.

Behavior:

- Writes a one-line status to **stderr**: `Waiting for feedback on <label> — comment in the
  browser, then hit Send.`
- Long-polls the server, keyed to the target. Up to 3 attempts; a dropped connection prints
  `Lost the connection (<msg>); retrying.` to stderr and retries.
- **`--ack` is only sent on the first attempt of the loop.** A retry after a connection drop does
  not re-send it.
- Prints exactly one pretty-printed JSON object (2-space indent) plus a newline to **stdout**, then
  exits **0**. stdout writes are awaited before exit so large payloads are not truncated.
- Three terminal payload shapes: `status: "feedback"` (see §3), `status: "timeout"`,
  `status: "closed"`.
- After 3 failed attempts it prints `Gave up waiting for feedback.` to stderr and exits **1** with
  **no JSON on stdout**.
- SIGINT prints `Stopped waiting. Your feedback is safe — run the same command again to pick it
  up.` and exits **130**.

Timeout payload:

```json
{
  "status": "timeout",
  "waited_seconds": 600,
  "next_step": "No feedback yet. Run the same poll command again to keep waiting, or `human-review status <target>` to check without blocking."
}
```

(`waited_seconds` echoes the requested timeout, not the real elapsed wait.)

Closed payload (emitted when the human clicks End review):

```json
{
  "status": "closed",
  "next_step": "The user ended this review session. Stop polling — do not run the poll command again. Any unsent feedback is kept and will ship the next time this target is reviewed."
}
```

### 1.3 `human-review status <target>` — instant, non-blocking probe

Asks the running server; if no server is alive it reads the persisted state file directly, so
waiting feedback is still reported. Always exits 0.

```json
{
  "status": "feedback-waiting",
  "feedback_waiting": true,
  "agent_listening": false,
  "server_running": true,
  "unsent": { "comments": 2, "edits": 5 }
}
```

`unsent` counts comments/edits the human has made but not yet pressed Send on. Served by the live
server it sums across every page reachable from the entry target; served from the state file it
counts only the entry page.

### 1.4 `human-review setup [--global | -g]` — install agent instructions

See §6. Prints one line per file written, then a summary of the invocation string. Exit 0.

### 1.5 `human-review --help | -h | help | (no args)` and `--version | -v`

Prints the help block / version. Exit 0. Any unrecognized first argument is treated as a target to
open, so `human-review pol foo.html` fails with `File not found: <cwd>/pol`.

### 1.6 Environment knobs

- `HUMAN_REVIEW_STATE_DIR` — relocates all durable state (default `~/.human-review`).
- `HUMAN_REVIEW_PORT` — pins the server port (default: ephemeral). A busy pinned port makes the
  server exit 1.
- `HUMAN_REVIEW_IDLE_MS` — idle shutdown window (default 45 minutes).

---

## 2. Target types

Only two kinds exist: a **local file** and a **loopback URL**. Remote URLs are refused outright:
any `http(s)://` target whose hostname is not `localhost`, `127.0.0.1`, or `[::1]` throws
`human-review URL support is limited to localhost, 127.0.0.1, and [::1].` URLs carrying
credentials are refused.

### 2.1 Local HTML file

- Identity is the sha256 of the realpath, truncated to 16 hex chars. Symlinks resolve to their
  target, so two paths to one file are one page.
- Served verbatim from a review route with one `<script>` tag appended before the last `</body>`
  (or `</html>`, or at the end). No other byte is changed, so the saved file renders identically
  standalone.
- **Relative assets work.** Sibling files (images, CSS, JS, fonts) are served from a per-page asset
  route resolved against the file's own directory. Containment is enforced both lexically and after
  symlink resolution; anything that escapes returns 403. Unknown extensions fall back to
  `application/octet-stream`; every response carries `no-store` and `nosniff`.
- The open command does not validate the extension. A `.txt` or `.json` file will be opened and
  served as HTML.

### 2.2 Local Markdown file (`.md`, `.markdown`)

- Rendered to HTML on every request (GFM on) into a self-contained styled page. **The source file is
  never written by the tool.** All direct typing becomes feedback only.
- Raw HTML inside the Markdown is escaped and shown as text (never activated). Link hrefs are
  restricted to `http`, `https`, `mailto`; image srcs to `http`, `https`, and base64
  `data:image/(avif|gif|jpe?g|png|webp)`. Anything else is dropped and the link/image degrades to
  plain text.
- Quotes and edit text the agent receives reference the **rendered** text, not the Markdown source.

### 2.3 Localhost URL

- The review server fetches the page itself server-side: manual redirect following up to 5 hops,
  30-second timeout, content-type must contain `html`/`xhtml`, body capped at 24MB. Failures at
  open time surface as a CLI error; failures later render as a 502 page inside the review frame with
  the underlying message.
- The fetched HTML is rewritten before display: `src`/`href`/`poster`/`data` attributes on
  `script`, `link`, `img`, `source`, `video`, `audio`, `iframe`, `embed`, `object` are made
  absolute against the resolved URL, so **all assets load from the real dev server**, not from
  human-review. `data:`, `blob:`, `javascript:`, and `#` values are left alone.
- A `history.replaceState` shim is injected into `<head>` so the app believes it is on its real
  route (client-side routers keep working).
- Per-page asset requests for a URL target return 404 with "Localhost assets load from the reviewed
  development server."
- The fragment is stripped when canonicalizing, so `http://localhost:3000/x#y` is the same target as
  `http://localhost:3000/x`. **Trailing slash and hostname spelling are NOT normalized**:
  `/wiki` vs `/wiki/`, and `localhost:3000` vs `127.0.0.1:3000`, are four different targets.
- Direct edits are captured as feedback. The tool never writes to the app.

### 2.4 Navigation inside a review

- **A plain click on any link, button, `[role=button]`, or `<summary>` inside the reviewed page is
  cancelled.** Clicks belong to editing. `<summary>` is exempted so `<details>` still toggles.
- **Cmd/Ctrl-click** is the navigation gesture:
  - `http(s)://` or `mailto:` -> opened in a real new browser tab, outside the review.
  - `#fragment` -> if the fragment is already current, smooth-scrolls to the element; otherwise sets
    the real hash (so CSS `:target` "single-file page" routing works).
  - anything else -> flushes every pending edit and save first, then navigates within the review.
- File-to-file navigation requires the destination to (a) resolve inside the **same directory** as
  the current file and (b) end in `.html`, `.htm`, `.xhtml`, `.md`, or `.markdown`. Query and hash
  are stripped. Anything else returns `not a local html or markdown page`. A link to `../other/x.html`
  is rejected.
- URL-to-URL navigation resolves the href against the current URL, re-validates it as loopback, and
  fetches it to confirm it loads.
- Every page navigated to joins the session's visited set and ships in the same batch. A rail panel
  lists other visited pages that carry feedback, with counts, and jumping to one flushes pending
  edits first.
- Form submits inside the reviewed page are cancelled unless Cmd/Ctrl is held.

---

## 3. Feedback payload contract

One poll returns one batch, covering every page the human visited in that browser window.

```json
{
  "status": "feedback",
  "pages": [
    {
      "kind": "file",
      "file": "/abs/path/to/page.html",
      "comments": [
        {
          "id": "c_3f1a9c22b7d0",
          "kind": "selection",
          "quote": "the exact text they selected",
          "anchor": { "prefix": "...32 chars before...", "quote": "...", "suffix": "...32 chars after...", "selector": "body > div:nth-of-type(2) > p" },
          "feedback": "what they want changed"
        }
      ],
      "edits": [
        {
          "label": "Problem body",
          "kind": "edited",
          "before": "the original wording",
          "after": "their exact new wording",
          "after_html": "their exact new wording with <strong>formatting</strong>"
        }
      ]
    }
  ],
  "overall_note": "free text not tied to any page",
  "sent_at": "2026-08-12T18:04:11.221Z",
  "next_step": "Apply this feedback. Each entry in `pages` names the reviewed file or localhost URL. ..."
}
```

Field-by-field:

- **`kind` on a page** is `"file"` or `"url"`. For a URL page, `file` holds the localhost URL and a
  duplicate `url` field is also present. For a file page there is no `url` key at all.
- **`comments[].kind`** is `"selection"` (a text range) or `"element"` (a whole block clicked on).
  For an element comment, `quote` is the block's **label**, not its body text, and `anchor` is
  `{ selector, label }` with no prefix/suffix.
- **`anchor`** for a selection is a W3C-TextQuoteSelector-style triple: 32 characters of context on
  each side plus the quote, plus a body-anchored fully-indexed CSS path. Re-finding a quote after
  the document changed falls back to whitespace-collapsed matching.
- **`comments[].id`** is `c_` + 12 hex chars. `createdAt` exists internally but is stripped from the
  payload.
- **`edits[].kind`** is one of `"edited"`, `"deleted"`, `"moved"`.
  - `deleted` carries `before` (the removed text) and `after: ""`.
  - `moved` additionally carries `moved_after` and `moved_before`: the first ~90 characters of the
    blocks now surrounding it. Empty `moved_after` means it is now first in its container.
- **`before_html` / `after_html`** appear only when they differ from the plain-text `before` /
  `after`, i.e. when formatting (bold, italic, link, image size) changed and not just words.
- **All four text fields are truncated to 4000 characters** before storage. Longer blocks arrive
  silently clipped.
- **`label`** is a human name for the edited block: an authored `data-block` / `data-container`
  attribute if present, else a heading-derived name like `Pricing · p 3`, else the block's own first
  40 characters.
- **Ordering:** pages follow the order the human first visited them; comments follow creation order;
  edits follow first-touch order (re-editing a block updates in place, it does not move).
- **Delimiting:** the whole batch is a single JSON object, pretty-printed with 2-space indent and a
  trailing newline, then the process exits. There is no streaming, no NDJSON, no envelope.
- **Deduping:** edits are keyed on `label` + `kind`. Retyping the same block updates that one row's
  `after` / `after_html` rather than appending. `before` is written **once, at row creation, and
  never backfilled** — if it was undefined then, it stays undefined forever.

The `next_step` string is generated per batch and is conditional: it gains a Markdown clause when
any page is Markdown, and a localhost clause when any page is a URL. Its standing instructions are
that `after` is verbatim human wording that must never be reverted, that `after_html` means
formatting changed and should be translated into the source's own syntax, and that the agent should
re-poll with `--ack` when finished.

---

## 4. Session lifecycle

**Start.** Opening a target creates a page record plus a browser session (`s_` + 12 hex). The
session remembers the entry page, the currently-shown page, and the set of pages visited. The
browser connects a server-sent-events stream for live updates.

**Multiple targets.** Everything the human reaches by navigating inside one window belongs to one
session and ships in one batch. **The agent always polls the entry target**, whatever page is on
screen; the review UI shows the poll command for the entry target, not the current page.

**Agent state,** broadcast live to the browser as one of four values:
- `idle` — nothing pending, nobody polling.
- `listening` — an agent is blocked in a poll.
- `working` — a batch was handed to a polling agent and not yet acknowledged.
- `stranded` — a batch was sent but no agent ever took it.

**Send.** The human clicks Send (or Cmd/Ctrl+Enter anywhere, including inside the iframe). The
server re-collects the full live comment and edit set for every visited page, freezes it as a
pending batch, persists it, and hands it to any waiting poller. A second Send re-collects
everything fresh, so nothing already queued is lost by sending twice.

**Polling twice.** The pending batch is returned immediately to any poll until it is acknowledged.
Two agents polling the same target both receive the same batch. Polling again without `--ack`
returns the identical batch again.

**`--ack`.** Acknowledges the *last delivered* batch: deletes the pending batch, drops exactly the
comment ids it carried, drops edits older than the send timestamp (edits made or retyped at or
after the send survive so they ship next time), tells the browser to refresh its rail, and — for
URL targets, which have no file to watch — tells the browser to re-fetch the route. An ack for a
batch that was never delivered is refused, so an ack that arrives after the human sent something
new cannot destroy the new batch.

**Un-acked feedback** stays pending indefinitely (subject to the 30-day prune) and is re-delivered
on every subsequent poll of that target.

**Timeout.** Purely client-side. The CLI destroys its request and prints the timeout payload; the
server drops the poller when the socket closes. Nothing is lost.

**End review.** A confirm dialog (naming the unsent item count), then: the SDK flushes pending
keystrokes, the session is deleted, every browser window on that session gets an "ended" event and
freezes behind an overlay, and — only if no other window shares the entry target — every waiting
poller is released with the `status: "closed"` payload telling the agent to stop polling. Unsent
feedback is kept for the next review of that target.

**Handoff to a waiting agent.** When feedback is sent with nobody listening, the browser shows a
copyable prompt built server-side:

> Run `human-review poll "<target>" --timeout 600`, apply the feedback it returns, then keep polling
> with --ack until I end the review.

**Idle shutdown.** A sweep runs each minute. Sessions with no live browser connection for 30 minutes
are forgotten. File watches with no referencing session are dropped. With no connected browser and
no listening poller, the server exits after 45 minutes idle.

---

## 5. Persistence, state, and concurrency

**On disk,** in `~/.human-review/` (created mode 0700):

- `state.json` — every page and every un-acked batch:
  `{ pages: { <key>: { key, kind, file|url, pristine, comments[], edits[], updatedAt } },
     batches: { <entryKey>: { batch, cleanup, updatedAt } } }`
  Written in full, pretty-printed, on **every** mutation (each comment, each coalesced edit flush,
  each send). `pristine` holds a complete copy of the file's HTML, so the file grows with the size
  and count of reviewed documents. Writes go to a randomly-named exclusive temp sibling and are
  renamed into place.
- `server.json` — `{ port, pid, token, protocol: 7 }`, chmod 0600.

**Survives a restart:** pages, comments, unsent edits, `pristine` snapshots, and pending batches.

**In memory only:** browser sessions, the visited-page sets, agent poll connections, file watches,
the hash of what the tool last wrote to each file, and — importantly — the **`delivered` flag on a
pending batch**. After a restart every pending batch reloads as undelivered.

**Pruning.** On load, any page whose file no longer exists is dropped along with its batch; anything
untouched for 30 days is dropped. Pruning runs again over the merged result on every write.

**Concurrency rules:**

- Writes to `state.json` merge over whatever is on disk, per top-level key, last-writer-wins at the
  page level. There is no lock and no re-read of another process's changes into memory.
- Saving an edited HTML file is guarded by a content hash: the browser must name the version its
  edit was based on. A mismatch returns 409 and the save is abandoned (not retried, not merged).
- Two browser tabs on the same target are two sessions sharing one store. Both see each other's
  comments; only one can win a save.
- Two agents may poll one target; both get the batch, the first `--ack` clears it.

**Change detection.** Each reviewed file is polled for changes every 400ms. A change the tool did
not itself write updates the stored pristine snapshot, **clears that page's queued edit rows**, and
forces the browser frame to reload.

---

## 6. Setup / install behavior

`human-review setup` (project scope, run in the current directory):

1. Probes `which human-review` (`where` on Windows) to decide what command string to teach agents.
   A resolved path inside npm's transient `_npx` cache is discounted, because it disappears when the
   npx invocation ends; the fallback string is `npx -y human-review`.
2. Writes `<cwd>/.claude/skills/human-review/SKILL.md`, creating directories as needed, with every
   occurrence of `npx -y human-review` replaced by the resolved command. **Overwrites unconditionally
   and without prompting.**
3. Creates or appends to `<cwd>/AGENTS.md`: if the file already contains the string "human-review"
   it is left alone and reported as such; otherwise a Codex-oriented instruction block is appended
   (or the file is created with it).
4. Prints what it wrote, the invocation string agents were told to use, and — when it fell back to
   npx — a warning that npx only works once the package is published.

`human-review setup --global` (or `-g`) writes the same SKILL.md to three places and touches no
AGENTS.md:

- `~/.claude/skills/human-review/SKILL.md`
- `~/.codex/skills/human-review/SKILL.md`
- `~/.agents/skills/human-review/SKILL.md`

Nothing else on the machine is modified. No daemon is installed, no login item, no PATH change; the
review server is started on demand and exits on idle.

---

## 7. Safety and policy behavior

- **Loopback only.** The server binds 127.0.0.1 and rejects any request whose `Host` header is not
  `127.0.0.1:<port>` or `localhost:<port>`, which defeats DNS rebinding.
- **Per-run token.** A random 16-byte secret, regenerated each server start, is required on every
  API route via a header (never a query string, to keep it out of logs) and compared in constant
  time. Static assets, the health probe, the session shell page, and the artifact route itself do
  **not** require it.
- **Origin split.** The review shell runs on one loopback hostname and the reviewed document is
  framed from the other, so they are different origins and the reviewed page cannot read the shell
  or its token. All communication crosses by postMessage with explicit origin checks in both
  directions; the SDK ignores any message not from the parent at the exact expected origin.
- **Frame sandbox.** Base policy is `allow-scripts allow-forms allow-modals allow-popups
  allow-downloads`. A **localhost URL target additionally gets `allow-same-origin`** so its routing
  and JavaScript work; file and Markdown reviews stay in an opaque origin so they cannot read
  sibling files through the artifact route.
- **Path containment.** Sibling asset requests are confined to the reviewed file's directory, both
  lexically and after symlink resolution; escapes are 403.
- **Markdown sanitization.** Inline HTML in Markdown is escaped to text. Link and image URLs are
  scheme-allowlisted (control characters are stripped before the scheme is read).
- **Typed links are normalized.** Bare domains gain `https://`; anything with an executable or
  unknown scheme is rejected outright.
- **Drag-and-drop of desktop files into the review is blocked** (it would navigate the frame or
  paste `file://` markup).
- **Pasted images** are the one write outside the reviewed file: they are saved into an `assets/`
  folder next to it, with a collision-avoiding generated name, and only for four allowlisted image
  types.
- **Body size caps:** 24MB for any request body, 24MB for a fetched localhost page.
- Feedback text itself is **not** sanitized or escaped on the way to the agent beyond the 4000-char
  truncation; it is rendered in the rail via textContent, not HTML.

---

## Sharp edges

Grouped by the three symptoms actually reported: edits reverting, Send breaking, general
flakiness. Each one is a mechanism, not a suspicion.

### A. Mechanisms that revert the human's typed text

**A1. Any external write to the file deletes every queued edit row for that page.** The 400ms file
poller reacts to a change it did not write by overwriting the stored pristine snapshot **and setting
that page's edit list to empty**, then force-reloading the review frame. This fires for the agent
applying feedback, but equally for prettier, a git checkout, a formatter-on-save in another editor,
or a build step. Edits the human made to an unrelated section, which had not yet been sent, are
destroyed with only a toast ("Agent rewrote N blocks you had edited"). This is the single largest
revert mechanism.

**A2. The forced reload throws away in-progress typing.** Text sits in the iframe DOM for up to
700ms (save debounce) and edit rows for up to 500ms (edit-flush debounce) before either reaches the
server. Any reload inside that window loses those keystrokes outright. Reloads are triggered by the
file watcher (A1) and by acknowledging a batch on a URL target — i.e. exactly when the agent is
busy and the human is most likely still typing.

**A3. The save baseline is advanced before the save is confirmed.** The in-page serializer records
"this is what I last shipped" at the moment it posts, not when the server confirms. If the post then
fails, the identical document will be reported as clean on the next attempt and never re-posted. It
self-heals only because further typing produces a new serialization — and only if the save path is
still alive, which A4 breaks.

**A4. One 409 permanently kills saving for that tab.** A save whose base hash no longer matches the
file returns 409; the browser abandons it, discards its base hash, and marks itself idle. A fresh
base hash is only ever obtained when the review frame reloads. If the write that caused the 409 came
from human-review itself (the second tab, another session), the watcher suppresses the reload as
"our own write" — so **no reload event ever arrives, the base hash never returns, and every
subsequent save fails silently for the rest of the session.** The status line settles on "Couldn't
save — retrying…" while nothing is retrying.

**A5. Two servers can fight over the same state file.** A new CLI spawns a new server whenever the
recorded protocol number differs or the health probe fails, but the old server is not stopped — it
keeps its own full in-memory snapshot of state, its own file watchers, and its own 45-minute idle
timer. Its watcher fires on the new server's writes, clears edits in *its* snapshot, and merges that
snapshot over the shared state file. The live server's queued edits vanish from disk with nothing
logged.

**A6. Every autosave rewrites the whole file from the browser's re-serialized DOM.** The saved file
is whatever Chrome's parser produced, not the source the agent wrote: indentation is normalized,
invalid nesting is restructured, implied elements are materialized, entities are re-encoded. On a
file the agent also edits, this makes clean diffs impossible and makes "the agent's version" and
"the browser's version" structurally different documents even when the words match.

**A7. A stale frame can write over the agent's newer file.** The watcher polls file stats at 400ms.
Two writes inside one interval, or a stat-granularity collision, mean no reload is emitted; the
frame then still holds the pre-agent DOM and its next autosave writes that DOM back over the agent's
work. The base-hash check is the only guard, and it fails open into A4.

**A8. Edit text is silently truncated at 4000 characters.** A long block (a whole authored
`data-block` container counts as one block) reaches the agent with its tail cut off, presented as
"their exact new wording, carry it across verbatim". The agent then faithfully truncates the human's
own paragraph.

**A9. `before` is captured once and never backfilled.** If the first edit row for a block was
created without a `before` value (any path where the pre-edit text was not captured), it stays
undefined for the life of the row. The agent receives an `after` with no anchor to key on and is
pushed toward exactly the whole-section rewrite the tool's own instructions forbid.

**A10. Edit rows collide on their label.** Rows are keyed by label plus kind. Labels are derived
from the nearest preceding heading, the tag name, and a sibling ordinal computed **within the
element's own parent** — and pinned per page-load, so they are recomputed after every reload. Two
distinct paragraphs in different containers under the same heading can produce the same label; the
second one's text silently overwrites the first one's row and that edit never reaches the agent.

**A11. Re-opening a target resurrects old feedback.** Opening a file again refreshes the pristine
snapshot but keeps the existing comments and edits (up to 30 days old). Combined with A12, batches
that were never acknowledged re-ship their contents on the next review of that document.

**A12. An un-acked batch's cleanup list is silently dropped when a new batch replaces it.** Sending
again overwrites the pending batch record for that target, including the bookkeeping that says which
comments the previous batch already delivered. Those comments are never cleared from the store and
re-ship in every future batch until the human deletes them by hand.

### B. Mechanisms that make Send stop working

**B1. A stranded batch disables Send permanently, and it survives restarts.** Send is disabled
whenever the agent state is `stranded` — a batch exists that no agent has taken. Adding more
comments does not clear it; only an agent actually polling does. The `delivered` flag is memory-only
while the batch itself is persisted, so **after a server restart every pending batch reloads as
undelivered**: open the same document a week later and the Send button is dead ("Sent — agent is not
listening") before the human has done anything. There is no CLI or UI affordance to clear a stuck
batch; the only escape is deleting the state file by hand.

**B2. The `sent` latch.** After a successful Send the button disables ("Sent — waiting for agent")
until a comment is added, a comment is edited, an edit row arrives, or the agent acknowledges.
Typing an overall note re-renders but does **not** clear the latch — so a note-only re-send is
impossible, and the human is told "This batch was already sent".

**B3. New feedback added after a stranded Send never reaches the agent.** The pending batch is a
frozen snapshot. Comments and edits made afterwards live in the store but are not in that snapshot,
and the only way to build a new snapshot is to press Send — which B1 has disabled. The agent's next
poll receives the old batch and nothing else.

**B4. A dead session makes every button 404 with no visible warning.** Sessions are memory-only and
are forgotten 30 minutes after the last live browser connection (laptop sleep, backgrounded tab), or
immediately on server restart / idle shutdown. The event stream's error handler is a deliberate
no-op, so the page keeps looking healthy. Send, jump-to-page, navigate, and End review then all fail
with "unknown session" as a transient toast, and reloading the tab gives "This review session has
ended."

**B5. `--ack` is only sent on the first attempt of the CLI's retry loop.** If that attempt drops the
connection, the retry polls without acknowledging, so the already-applied batch is returned again as
if it were new feedback and the agent re-applies it.

**B6. A poll without `--timeout` blocks forever.** The server never ends a poll response on its own.
An agent that omits the flag hangs until the human sends or ends the review.

**B7. Target-string drift strands feedback silently.** Poll routing is keyed to an exact
canonicalized target. `http://localhost:3000/wiki` and `http://localhost:3000/wiki/` — and
`localhost` vs `127.0.0.1` — are four different keys. An agent polling one while the human reviews
another waits forever and the human sees a permanently stranded Send.

### C. General reliability landmines

**C1. Reviewed applications are half-inert.** Inside the review frame every plain click on a link,
button, or `[role=button]` is cancelled, and every form submit is cancelled unless Cmd/Ctrl is held.
On a localhost app review this reads as "the site is broken": nothing submits, nothing navigates,
nothing responds. If the reported "submission stops working" refers to the reviewed app rather than
the Send button, this is the mechanism.

**C2. `contenteditable` is forced onto `<body>` and re-applied by a mutation observer** whenever the
framework removes it. On a hydrating app (React, Turbo) this is a continuous fight with the
framework over a body attribute, and it makes the app's own inputs and editors behave oddly.

**C3. Self-rendering detection is a one-way latch fired by any early DOM drift.** Before the first
human edit, *any* serialization difference — a lazy image, a font swap, an analytics script, an
animation setting a style attribute, a chart library — permanently switches the page to
feedback-only mode for the session. Autosave is silently off from then on, contradicting the
documented promise that HTML edits save automatically. The human's typing then exists only in the
DOM and the edit rows, and any reload (A1, A2) loses the DOM copy.

**C4. The entire state file is rewritten on every mutation.** Each comment, each 500ms edit flush,
each send rewrites a pretty-printed JSON document that contains a full HTML copy of every page
reviewed in the last 30 days. Sustained typing on a large deck means megabytes rewritten twice a
second.

**C5. "Revert all" is available on feedback-only pages.** The revert path only refuses URL targets.
On a Markdown review it writes the pristine snapshot back over the `.md` file and clears the queued
edit rows — destroying feedback the agent never saw, on a page the tool otherwise promises never to
write.

**C6. Sending only covers pages this window visited.** Two tabs on one document are two sessions
with two visited sets over one store. Comments left in one tab may not be included in the other
tab's batch, and the second tab's Send overwrites the first tab's pending batch (see A12).

**C7. A localhost app under review shares an origin with the review server.** URL targets are framed
with `allow-same-origin` on the same loopback host and port as human-review's own API, so the
reviewed application's JavaScript is same-origin with the review server. It cannot forge API writes
without the per-run token, but it can read the unauthenticated artifact route and would gain the
token outright if it ever learned a session id.

**C8. Failure modes are reported as toasts.** Save failures, unknown-session errors, and clipboard
failures appear as 3.2-second toasts and then vanish. There is no persistent error state and no log
the human or the agent can inspect afterwards.
