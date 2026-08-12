# Architecture reviews

Both reviewers read the brief, the PM review, the three research files on the tool being replaced, and
the two existing implementations this design claims to inherit from.

---

## review-architect Review (Round 1)

### Blockers

**A target as the unit of a review breaks the one-batch story.**
Free roam across eight routes produces eight reviews and eight pairs of files. R45 (feedback
accumulates across everything visited and sends as one batch naming which page each item belongs to),
R49 (one structured batch grouped by page), R6 (one queue), R51 (a known documented location), and the
second user story all break. The agent has to discover N files instead of reading one. This is also why
Q2 looked unanswerable: the question asks where the file for a route goes, when the real answer is that
a route does not get its own file.
*Fix:* make a review the unit. One review spans many targets, items carry a target, one `review.md`
plus one `review.json` per review at one location. Target identity stays as the per-page key inside it.

**Replay has no confidence floor and no fail-closed rule, and the identity ladder is weakest in exactly
the case replay exists to serve.**
After an agent rewrites the source, the structural path has shifted, the sibling ordinal has shifted,
and the original text is the thing that just changed. Three of the four probes are degraded and the
fourth (an author-supplied name) is present on almost nothing Ken reviews. A miss is survivable. A
mis-bind is not: replay stamps paragraph four's text onto paragraph five, and the before/after pair
shipped to the agent is now incoherent. The document treats re-finding as a solved property inherited
from the comment module; it is not.
*Fix:* state it as a law. Replay only writes on a high-confidence bind, and one region reference binds
to at most one node per pass, greedily in document order. Anything unbound is not written and appears
in the rail as unable to be placed, text intact. Add the missing corollary: identity is minted once and
re-resolved on every repaint, because a repaint destroys any attribute or WeakMap you stored it in.
"Travels with the region" is not true across a repaint and a builder will implement the wrong thing.

**Treating an app re-render and a source rewrite identically stamps stale text over real application
state.**
Two failures. First, on a live app the incoming version is real data, not a competing edit: filter the
roster, come back, and your edit to row three (Sarah) is replayed onto row three (Marcus), with the
reviewer's text winning on screen. The reviewer is now looking at a lie about their own app, in the
target Ken cares most about, and using the app for real fights replay directly. Second, replay that
rewrites a region's contents destroys the caret and the selection. Steady Thread has a Turbo frame that
polls every two seconds; replay would yank the cursor out of the block being typed in, twice a second.
That is a worse version of the symptom this document exists to kill.
*Fix:* split the two causes. A source repaint replays and marks collisions as designed. An app repaint
replays only where the region's current DOM still matches what replay last wrote; otherwise the edit
detaches, keeps its text, and says on its card that the page moved on. Make replay idempotent by
comparison: a region whose DOM already equals the record is skipped, and a region containing the caret
or the selection is never rewritten. That one rule buys idempotence and cursor safety together.

**The record shape is text-only, so it cannot represent a deletion, a move, a formatting-only change,
or an image, and undo is not mentioned anywhere.**
R26 (blocks deleted and reordered, deletion reported as a deletion), R30 (bolding a word is an edit
even though the plain text is unchanged), R24 (bold, italic, links, lists), and R25 (images) have no
home. Worse, R23 (undo, redo) and R27 (every edit undone on its own, which exists because the old
tool's only escape costs an hour of work) have no design at all, and replay makes undo genuinely hard:
after replay rewrites a region, the browser's native undo stack for it is gone.
*Fix:* give the record a kind, carry cleaned markup alongside plain text, and carry landing anchors for
a move. Then say plainly how undo works: per-item undo reverts the record and lets replay redraw, which
is the only version that composes with replay. Native browser undo is a bonus, not the mechanism.

**Verification is unimplementable because the ack does not carry file paths.**
The ack is defined as item ids applied or declined; verification then checks the text "in the file the
agent said it changed", which the ack does not carry. Verification is the only defense the design has
against the failure Ken's own commit in the old repo tried to fix with a prompt. Answering the question
directly: no, the service cannot verify anything, because it does not know what file to open.
*Fix:* the ack carries, per applied item, the file paths touched. Two further corrections or
verification causes its own outage: match on normalized text, because on a markdown source or an ERB
template the reviewer's `after` is a rendering of the source and will legitimately never appear
verbatim; and a miss warns loudly rather than auto-reopening the item, because auto-reopening turns a
false positive into an infinite re-ship loop. A deletion needs the inverse check.

**Refusing to write the artifact supplies nothing that tells the agent where the source is.**
Yes, there is a gap, and it is the common case. An agent handed a review of `02_architecture.html` will
edit `02_architecture.html`, pass the verification check cleanly, ack it applied, the item clears from
the rail, and the next pandoc build erases it. The reviewer watched the burn-down and believes the fix
landed. That is worse than no fix, which is exactly what R47 says. Separately, the document's one xref
cites "R44, a typed fix must reach whatever the next build reads". R44 is free roam; R47 is the
typed-fix requirement. The single place this design connects itself to the brief points at the wrong
requirement.
*Fix:* every target carries a source hint in the JSON and a sentence in the markdown. Setup asks once
per project. The agent instructions say to edit the generator's input and name what was edited.
Verification then checks that file and the loop closes.

### Important

**Attached mode's real costs are not admitted.** The layer runs on the app's origin and the service on
loopback, so every sync is cross-origin: the service needs CORS and the app's CSP `connect-src` must
permit it. Rails' generated CSP initializer and any Next.js middleware CSP block it, and a CSP block
looks identical to the service being down, which is the one failure the document says is safe. Browser
storage is the app's origin's storage, so the app's own scripts can read and clear it, which makes R65
unachievable in attached mode; `localhost:3000` and `127.0.0.1:3000` are separate buckets, so target
identity holds server-side and not browser-side. A client-side router gives the layer no event unless it
patches history and framework navigation, so the shim relocates rather than disappears. A Turbo morph
removes the overlay root, because the root is not in the server's HTML; the Steady Thread layer survives
morphs largely because Rails re-renders the partial, and injecting by script does not inherit that. And
if the snippet loads the layer from the service, no service means no layer, contradicting the failure
table's first row.
*Fix:* keep attached mode, it is the right call, and add a costs paragraph naming all of it. Scope R65
to served mode. State the overlay-root contract with a de-registration rule. Make the sync client
distinguish policy refusal from service-down.

**Nobody owns the refresh.** R56 says the page updates itself when the agent lands a change; the
document says only "the page refreshes" in the passive voice. This is the exact mechanism that produced
symptom one in the tool being replaced. It also interacts with verification: between the agent's write
and its ack the item is still outstanding, so replay stamps the reviewer's wording back over an edit
that was in fact applied and reports a collision that is not one.
*Fix:* name the mechanism per mode, and state the ordering rule that acks are processed before replay.

**Nothing protects an open compose box from the rail being re-rendered.** The research names this as the
number one in-page revert mechanism in the old tool: the rail rebuilds every card on every repaint and a
partially reworded comment is destroyed, because a removed node never blurs. R18 requires rewording to be
safe from anything else happening at the same time, and replay makes repaints more frequent.
*Fix:* one law: the rail updates in place and a card holding focus is never re-created. Add a browser
test that types half a comment, triggers a repaint, and asserts it survives.

**Two durable stores with no event identity, no idempotence rule, and no stated authority.** Tracing it:
reviewer types, browser writes, sync fails, reviewer reloads, browser replays from storage and re-sends,
and the service appends those events again. Whether that double-counts depends on whether events are
snapshots or deltas and whether they carry ids, and the document says neither. The reverse is worse: the
agent acks while the browser is closed, and on reopen the browser still holds the item as outstanding and
re-offers it, breaking apply-once.
*Fix:* events carry a client-minted id and are idempotent by id; an item event is a full snapshot, never
a delta; the browser is authoritative for item content until delivery and the service is authoritative
for lifecycle, with the layer reconciling on every reconnect and lifecycle winning.

**R9 has no owner and R20 is absent entirely.** R9 (failures are loud and persist) answers a named defect
in the research, where every failure is a three-second toast and then nothing, and no component owns error
state. R20 (a note tied to nothing is first-class feedback) is the requirement that exists because "type a
note, press Send, button is dead forever" was one of Ken's three symptoms, and the architecture never
establishes the note as an item, so the bug can be rebuilt while satisfying everything the architecture
says.
*Fix:* give the rail a failures list that persists until dismissed. Add one line making the note an item.

**Two reuse claims do not survive opening the files.** The built-doc module's `locate()` is four exact
substring probes over the concatenated text, with no whitespace-collapsed fallback and no repeat
disambiguation, so `indexOf` takes the first hit and a short or missing prefix binds to the wrong
occurrence: anchoring is new work, not a carry-over. Its storage key is the file's basename, so two
`index.html` files in different folders share one bucket and merge their comments. And the Steady Thread
layer re-registers document-level `mousedown` and `mouseup` on every morph with no removal, so handlers
accumulate for the life of the page, and its draft is a single global key rather than a queue. Do not
inherit either shape.

**A docked rail cannot honor the no-restyle rule.** The built-doc module sets `body.ffc-open {
margin-right: 372px; }`, which is exactly what R34 forbids, and human-review only avoids it with an
iframe. In served mode this will be discovered during the build, by which point the layout is decided by
accident.
*Fix:* decide now. The rail is a fixed overlay in an isolated root, it never shifts the host, and it
collapses. Same for both modes, which is what the mode-parity claim requires.

### Minor

**Python is not reliably present on a clean Mac**, where `/usr/bin/python3` is a stub that prompts for
Xcode Command Line Tools. That is not the two-line README the design is trading for. Meanwhile the
audience runs Claude Code, Codex, or Cursor, so Node is more likely to be present, which the Alternatives
entry appears to concede in its first sentence and then reject anyway. The rejection reads reversed.
*Fix:* verify the claim on a fresh machine and keep Python, or say the real reason plainly and have setup
check for the runtime and print the exact remedy instead of failing at first use.

### Requirements with no home in the document

R18, R20, R23, R24, R25, R26, R27, R30, R33, R56, R61, R62. R47 is claimed but not supplied. R65 is
claimed but false in attached mode. Also undefined: what `open` does for a route target, given there is
no proxy.

### Over-designed for one reviewer and a few students

- Cut compaction and projection-rebuilt-on-start as named machinery. A session is a few hundred events.
- Cut the agent-presence display. Presence is already never a gate, and showing it is how it became a
  gate last time.
- Cut the bookmarklet from v1. A second delivery path with its own CSP failure mode for a case neither
  Ken nor a student has on day one. Cutting it also repairs the browser-extension rejection, which
  currently leans on it.
- Collapse the six commands. `status` is `next` with a zero timeout; four covers everything.

### Questions

1. Browsers should not still be open. The editing surface is the entire risk and its cost swings with the
   answer. Recommend Chromium only for v1.
2. The test strategy demands browser tests and the runtime decision forbids a package manager. State the
   rule: runtime has no dependencies, dev tooling may.
3. Does the built-doc embedded module stay? The architecture should state that v1 does not replace it,
   otherwise the first student to open a spec doc from Finder with no service running gets nothing.

---

## review-security Review (Round 1)

### Blockers

**The loopback service has no authentication, and attached mode makes it reachable from every origin the
reviewer's browser visits.**
Binding to loopback does not help, because the attacker is a page running inside the reviewer's own
browser. The host header check only defeats DNS rebinding; a page that fetches `http://127.0.0.1:<port>`
directly sends a passing host header. From there: a cross-origin POST with a simple content type is a
CORS-simple request, so no preflight fires, the request reaches the handler, and the service acts on it.
CORS hides the response, not the effect. Any page can inject forged comments and edits that land in the
file an agent reads and acts on, which is a drive-by write into an agent's instruction stream. And for
the layer to read any response in attached mode, the service must send an allow-origin header; if that is
a wildcard or a reflection, every page on the internet can read the reviewer's full feedback set, the
quoted passages, the list of every file and route reviewed, and local file contents through the asset
route. The tool being replaced had five controls here; this design keeps the weakest two.
*Fix:* three layers, all of them. A per-run token, header-only, constant-time compared, in an owner-only
file. A server-side origin allowlist recorded at attach time, no wildcard and no reflection, applied to
preflight too, since a page cannot forge its origin and a token in a dev layout is readable by anything in
the app's origin. And a required JSON content type plus a custom header on every mutating route, so a
simple request cannot reach a handler at all.

**Text from the reviewed document travels verbatim into a file an agent reads and acts on, with nothing
saying it is untrusted.**
The full path: a document is generated by an LLM or renders content its author did not write, both
routine here. The reviewer comments on a passage or edits a block, and the layer captures the quote,
surrounding context, and the block's original text. Those land in the markdown, which the document says
exists for an agent with no tooling, meaning it is read raw straight into context. The agent then applies
items with repository write access. The `before` field is the worst carrier for three compounding
reasons: verbatim by design, unbounded because neither file is truncated, and **the reviewer never reads
it**, since it is the original text and not their words. Verification does not cover this: an injected
instruction that makes the agent also edit a second file or call a tool passes it with a clean bill. This
repository's own `CLAUDE.md` already carries the rule for proposed lessons, that quoted material is data
and never instructions, and it is not carried into this design.
*Fix:* classify every field as reviewer-authored (instruction) or document-derived (data). Fence the data
fields structurally with a per-file random delimiter and escape any content line that would close it;
blockquote-prefixing each line is the right shape but does not stop a quoted line from reading like a
directive. Put a standing header on every generated markdown file. Say the JSON is authoritative and the
markdown is the human fallback, because structure survives injection in a way prose does not. And bound
`before`, since the no-truncation rule is right for `after` and wrong for text the reviewer did not write.

**The write path for the agent-facing files is derived from a target name and a project the reviewer
names, and neither is constrained.**
Four holes in one sentence. Route target identity normalizes host spelling, trailing slash, and fragment,
and says nothing about path segments, percent-decoding, or `..`, so a filename derived from a decoded
route path is a traversal primitive. In attached mode the page supplies the target, so combined with the
authentication finding the write path is attacker-controlled. If the project path arrives in a request
body, the browser is naming an absolute write destination, which is arbitrary file write from any origin
that can reach the service. And the destination file may itself be a pre-planted symlink pointing at an
agent's configuration file; the design carries this lesson for the log and not for these two files. A
write into `~/.claude/settings.json` or a repository's `CLAUDE.md` is not file corruption, it is agent
reconfiguration, which is full compromise of everything the agent can reach.
*Fix:* never derive a path component from untrusted text; hash the canonical target and use a restricted,
length-capped slug. Assert the destination is inside the review root after resolution and refuse a
symlink. Write through an exclusively created temp name and rename. And make the review root server-side
configuration set at setup or service start, never accepted from a request body, which also settles Q2.

**"The snippet itself carries the guard" is not implementable.** A client-side snippet cannot know the
server's environment. Steady Thread's guard is three server-side Ruby layers and the tool controls none of
them. The most a snippet can check at runtime is the hostname, which is wrong for a dev server on a LAN
IP, an ngrok tunnel (which Ken uses for Twilio inbound testing), or a staging hostname, and it guards
against running rather than against shipping. If the snippet ships to production, the page carries a
script tag pointing at loopback, and for every production visitor who happens to run the tool that script
executes in the production origin in their logged-in session. Chrome treats loopback as potentially
trustworthy, so mixed-content blocking does not fire on an HTTPS page.
*Fix:* the guard goes outside the script tag, in the host template's own conditional, and setup emits the
framework-correct guarded snippet. Ship the Steady Thread three-layer pattern as the documented shape. A
client-side loopback check is a second line, not the guard.

**Dropping the frame removes the only isolation boundary, and the argument for dropping it does not apply
to files.** The claim that the reviewed page cannot reach the layer or stored feedback has no mechanism
behind it. In the tool being replaced the mechanism was concrete and tested: file and markdown reviews ran
in a frame with an opaque origin, on an alternate loopback hostname, with postMessage pinned in both
directions. Injecting into the reviewed document itself makes the file's own scripts same-document with
the layer, able to read and rewrite its state, read the storage queue holding all unsent feedback, call
the service with whatever credentials the layer holds, read sibling files through the asset route, and
exfiltrate all of it. The reviewed HTML file is not a trusted input; that is the premise of the feature.
The thing worth noticing is that the entire argument for dropping the frame is about running apps, and not
one of those points applies to a local file on disk.
*Fix:* split the decision. Attached mode: no frame, and say plainly that isolation is not achievable in
the app's own origin, as an accepted tradeoff rather than an unbacked claim. Served mode: keep the frame,
opaque origin, alternate loopback hostname, pinned postMessage. Also note that in attached mode the
layer's storage lives in the app's origin, so anything that XSSes the app reads the reviewer's unsent
feedback.

### Important

**Cut the bookmarklet.** On a page that is not the reviewer's it becomes script in a hostile origin; the
page can hook fetch before it runs and see every request. If it carries the token it hands full
authenticated access to the service. The page's crafted text becomes a quote or a `before` and reaches the
agent through the injection path above. And it drives straight through the local-only requirement, which
no server-side check can enforce, because the reviewer's click is the target selection. It covers the
smallest case and carries the largest blast radius, and the document already argues the extension is the
real answer for that case.
*If it stays:* no token in the bookmarklet, the layer refuses to initialize off an allowlisted origin, and
the service mints a grant only after the reviewer confirms in the tool's own window. Any design where the
page can self-authorize is not a design.

**The log's location, permissions, and retention are unstated**, and it accumulates quoted document
content indefinitely on a machine the tool does not own. This is the finding most likely to burn a
student, because it needs no attacker: if the state directory defaults inside the clone, a student's
`git add -A` publishes their entire review history to a public repository. A world-readable log on a
shared lab machine or a managed work Mac leaks every document the reviewer has read. Retention is answered
with compaction, which is a size answer to a privacy question; the tool being replaced at least pruned at
thirty days. And the agent-facing files sit beside the reviewed file, inside the user's repository,
carrying quoted content and candid feedback, so they get committed by accident.
*Fix:* state outside the checkout, directory and file permissions owner-only, a shipped ignore entry, a
setup offer to ignore the review files in the reviewed project, a default retention window, and a purge
command.

**A forged ack silently erases the burn-down.** The design defends against a stale ack, which is the
failure the old tool actually hit, and not against a forged one. With no token, any page can name item
identifiers and mark them applied; applied items clear their highlights and move to Completed, so the
reviewer's screen burns down to empty with nothing looking wrong. That is worse than an error, because the
whole premise is that what is on screen is what is still outstanding.
*Fix:* covered by authentication, plus tying an ack to a delivery identifier the service issued.

**Setup writes the files that program the agent**, which is the highest-privilege thing this tool does,
higher than writing feedback, because it changes what the agent will do with everything else forever. The
tool being replaced overwrites them unconditionally and without prompting, which is the scar R61 exists
for, and the architecture lists setup as one of six commands and never says how R61 is met. This matters
twice over, because the injection defenses have to live in exactly these files.
*Fix:* write a marked block between sentinels and replace only what is between them on re-run. If the
sentinels are missing but the file mentions the tool, report and touch nothing. The written instructions
must carry the injection rules.

**Local-only has no enforcement point in attached mode.** The check is enforceable when the tool fetches
the target, which is how the old tool did it. In attached mode the tool fetches nothing; the browser is on
whatever page it is on and the layer reports the URL it finds itself at, so the service can only validate
a string it was handed and a page can hand it any string. The design states the requirement as satisfied;
in the mode that is the headline, it is a claim about a string.
*Fix:* state what is actually true: the service refuses non-local targets it serves, the layer refuses to
initialize on a non-loopback origin, and the service refuses requests whose origin is not on the attach
allowlist. Those three together are a real boundary.

### Minor

**Verification reads a path the acking party supplies**, which for a forged ack becomes a blind content
oracle: ask whether a string appears in a private key file and read the answer off the item's status. Low
severity on its own and only reachable because of the authentication finding, but the fix is one line:
constrain the path to the target's project root and report anything outside as a verification failure.

**A fixed default port is a meaningful weakening.** A page attacking the service does not need to scan if
the port is a documented constant, and whoever binds it first becomes a script source for any page
carrying the attached-mode snippet, including a production page carrying it by accident.
*Fix:* ephemeral by default, recorded with the token in an owner-only file, pinning available and
documented as a weakening.

**Markdown sanitization and paste restriction are described by effect, not mechanism**, and the mechanism
is the part that failed before: the old tool's first approach was a regex script-strip, replaced with a
renderer inert by construction. Which of the two this design intends is the whole question, and it is
sharper because the renderer is vendored. The scheme rejection has a specific shape worth inheriting:
control characters can smuggle a scheme past a naive prefix check.
*Fix:* name the mechanism, and say whether sanitization is the vendored renderer's job or ours, because
"the library handles it" is a claim that must be true of the specific library.

### Must be fixed before the first line is written

Authentication; the injection framing of the agent-facing files; path derivation and the server-side
review root; the served-mode isolation decision; state location and permissions. Each changes the shape of
the code or is a default that is painful to migrate after students have installed it. The production
snippet finding is a blocker on the document rather than the code.

### Fine as follow-ups

The forged ack closes automatically with authentication. Setup's sentinel writing, as long as the
injection rules it carries are drafted now. The verification path constraint. The ephemeral port. Naming
the renderer's sanitization posture.


---

## Deep architecture review, high-capability pass (Round 2)

Run after the architect and security rounds were integrated, on the question of whether the design's
load-bearing idea survives contact with a real page. Verdict: replay is sound as a durability idea and
was unsound as written in three places, all in the live-app path.

### The walk that failed

The reviewer types into a paragraph inside Steady Thread's two-second polling Turbo frame. Per keystroke
the DOM holds the new text, the record updates, storage is written. Then the morph fires:

1. The morph compares server HTML to the DOM, decides the DOM is wrong, and writes the original text
   back. The fix visibly vanishes.
2. The morph destroys the text node holding the caret. The selection collapses. **The caret is dead
   before replay runs.**
3. Replay runs. Law 2 forbade rewriting the region holding the caret; there is no caret there anymore,
   so the write is permitted.
4. The app-repaint rule said replay only where the DOM matches what replay last wrote. Replay never
   wrote this region, the reviewer typed it and the morph reverted it, so the DOM matches nothing.
   **The edit detaches.**

Result: text reverted, edit bumped to the rail, caret lost. That is AC3's exact scenario, and it is
symptom one of the tool being replaced with better bookkeeping.

### Must fix before building

**The comparator is wrong.** Compare against the record, three ways, normalized: DOM equals `after`,
skip; equals `before`, the app re-rendered the same content, re-apply; equals neither, the content
changed, surface and do not write. Checked against the roster case (row three now renders Marcus,
matching neither) it detaches, correctly. Checked against the poll (frame re-rendered `before`) it
re-applies, correctly. One rule, both cases.

**The repaint classifier is unimplementable and, once the comparator is content-based, unnecessary.**
Hotwire-spark delivers an agent's source rewrite as an in-page morph indistinguishable from the app
re-rendering itself, so any load-versus-mutation heuristic mislabels the primary target. Demote the
cause to card copy or delete it.

**Nothing restores the caret, and no law owns the problem.** Law 2 defends the caret against replay; the
thing that kills it is the repaint, which replay does not control. Needs a region-relative selection
snapshot restored after a rewrite, and for Turbo an active veto via `turbo:before-morph-element` so the
edited region is never repainted at all. Without the veto, even perfect restore gives a flicker and an
interrupted word every two seconds, which is not "never disturbed".

**Cross-region gestures corrupt intent silently.** Selecting across a paragraph boundary and typing
merges two blocks. One record holding the merged text means replay rewrites the first and leaves the
second standing, so the content appears twice on screen and the agent is told to duplicate it in source.
Decompose into one record per touched region with an atomic group id.

**Undo contradicts Law 2 at the moment of use.** The reviewer almost always undoes the item they are
standing in, so the caret shield forbids the redraw, nothing visible happens, and the text snaps back
later when the caret wanders off. Exempt user-initiated replay and place the caret deliberately.

**Confidence is a fiction.** There is no ground truth to calibrate against, and the dangerous errors are
high-confidence ambiguous rather than low-confidence: two identical list items that swapped places match
exactly with symmetric context and bind confidently to each other's node. Replace the scalar with a
uniqueness predicate. A tie fails closed. Structure corroborates and never places.

**No `rev` field, so an ack can swallow a rewording.** Reviewer sends an item, rewords it, closes the
laptop; the agent acks it applied; on reopen "lifecycle wins" discards the rewording. That breaks R2 by
specification, and it contradicts the online behavior of the same race, which the design gets right.
Deliveries and acks name `(item, rev)`.

**Two tabs clobber the shared browser bucket.** Same origin, same target, one key, no storage-event
handling and no lock specified. R12 has a server story and no browser story.

**Token rotation contradicts the sync-drain promise.** Regenerating on every service start leaves an open
page holding a dead token, so sync never drains and the failure is neither of the two states the client
knows how to report.

**The built-doc module and the new layer would both ship in every new brief.** "Decisions resolved" keeps
the embedded comment module for v1; the plan's wiring task injects the new layer into the same builds.
Both intercept selection, both draw a rail, and the old one binds its hotkey in capture phase.

**The served-mode credential is readable by the served page.** A hostile or mangled script in a served
document holds token plus allowlisted origin, so it can forge items and acks. All served docs also share
one origin and therefore one storage bucket, so any served doc can read every other review's unsent
feedback, which the opaque-origin frame used to prevent.

### The cheaper third option on isolation

Scope the credential per target rather than isolating the page: an HttpOnly, SameSite-strict cookie
minted per serve, with the service enforcing that a credential for target A touches only target A. Ambient
authority within a document is unavoidable without a frame, but exfiltration and cross-review access both
close. Also note that D12's fixed-overlay decision deleted the docked-rail cost the frame was priced
against, so the frame is cheaper than the earlier accounting says; worth recording for the day someone
else's HTML comes into scope.

### The top-level alternative, adopted

Protect the region being edited instead of repairing it afterwards. While a region is actively edited the
layer owns it, marked `data-turbo-permanent` and vetoed in `turbo:before-morph-element`; the app's
repaints flow around it; on blur the edit commits and protection drops. The caret problem disappears
structurally, the IME problem disappears, and the caret law becomes a container check. Replay keeps its
whole role for committed records and stops having to work while someone is typing, which is where every
failing walk broke. It costs a commit seam on blur and it degrades on frameworks that fight a foreign
wrapper, which lands almost entirely on a target v1 does not have.

### Follow-ups, boarded rather than built

IME deferral and the spellcheck line (both taken into D4 immediately). One shared normalizer named in the
contracts task. Verification tiered honestly for route targets, authoritative for built docs and advisory
for routes. An honest definition of agent presence derived from when an agent last read, rather than a
liveness bit. Ack-ordering honesty: in attached mode the source write arrives as a morph seconds before
the ack, so a provisional collision may show and then clear. Export scope: with the service down, copy
covers the current origin's slice rather than a multi-origin review. A `mousedown`-era write-epoch rule so
replay's own mutations do not retrigger the observer. The formatting implementation choice, `execCommand`
versus manual range surgery, written down rather than left to two builders.
