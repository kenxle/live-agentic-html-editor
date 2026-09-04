# The diagrams plan, and what we decided not to draw

Reviewed with Ken in a LAHE session on 2026-09-04. Seventeen comments, every
one of them recorded inline below: what was approved, what was renamed, what was
cut and why. Kept because the CUTS are the useful part. Two proposals did not
survive the test Ken set, and the test itself is written down here so the next
person adding a diagram is held to it.

**The test:** if the thing has no branch, no ordering that matters, and no two
parties passing something back and forth, it is a table. Write the table.

This repo has no `docs/diagrams/` folder yet, which is the standard practice in
your other repos (`fools-delight`, `AI-Interfaces-Feb-2026`). This is the
proposed list: what to draw, in what order, and why a fresh agent needs each
one.

Comment on any row. Mark the ones you want built and I will draw those first.

**Status as of 2026-09-04: Tier 1 and Tier 2 are approved, all eight.** Tier 3
is still open for your call.

---

## The convention we would follow

Same as `fools-delight/docs/diagrams/`:

- One mermaid diagram per `.md` file, in a fenced ` ```mermaid ` block so
  GitHub and Obsidian render it inline.
- A `README.md` index table: file name, what it shows, which doc it is
  embedded in.
- Each diagram is also embedded in the doc it belongs to, and the two are kept
  in sync when behavior changes.
- **When a new diagram supersedes one in a history doc** (the brief, the
  architecture, the plan), the history doc's picture stays where it is and gets
  a one-line pointer above it naming the current file in `docs/diagrams/`.
  History is not rewritten, but a reader standing in front of a stale diagram
  should be told where the current one is.

## What already exists (do not redraw)

Some pictures are already in the repo. The plan is to move or reference these
rather than draw them twice.

| Where it lives now | How many | What it covers |
| --- | --- | --- |
| `docs/ongoing/SERVING_ARCHITECTURES.md` | 6 | How LAHE gets into a page, one per use case |
| `docs/ongoing/FINGERPRINTING.md` | 4 | The element fingerprint research and the queued-edits case |
| `02_architecture...md` | 4 | System summary, the offline-reword merge, and two others |

**Decided (Ken, 2026-09-04): yes.** Leave the serving and fingerprinting
diagrams where they are, and have the diagrams README point at them so the
index is still the one place you look. The architecture doc is history and is not rewritten, so its diagrams get
current copies in `docs/diagrams/` rather than moves.

---

## Tier 1: a fresh agent cannot work without these

These are the five that pay for themselves the first time somebody new opens
the repo.

### 1. `system_overview.md`

**APPROVED 2026-09-04**, with the architecture-doc pointer added below.

**Shows:** The four things that exist and the arrows between them.

- The reviewer's browser, running the library
- The helper, one local Node process
- The store on disk, `events.jsonl` plus `review.json`
- The agent, reading the JSON and appending reply lines

**Why:** The architecture doc has a version of this, but it predates agent
sessions and the static servers. A current one is the single picture that
answers "what talks to what".

**Embedded in:** `README.md` and `AGENTS.md`.

**Also (Ken, 2026-09-04):** the architecture doc's Summary diagram is already
out of date, so building this one includes putting a pointer above it in
`02_architecture_live_agentic_html_editor.md` naming
`docs/diagrams/system_overview.md` as the current picture. Same treatment for
any other history-doc diagram a new file supersedes.

### 2. `module_map.md`

**APPROVED 2026-09-04.** Ken: "this is probably important."

**Shows:** The four folders under `src/` and which way the dependencies point.

- `shared/` the kernel: markers, normalize, record, lifecycle, merge,
  regions, uniqueness, protocol
- `layer/` the browser bundle, drawn in concatenation order because there is
  no module loader in the browser and load order is dependency order
- `service/` the helper: routes, auth, log, projection, sessions, watchers
- `cli/` the six commands

**Why:** This is the "where does my code go" diagram. It is `manifest.js`
drawn as a picture, and `manifest.js` is already the ownership table, so the
content is there and just needs rendering.

**Embedded in:** `CLAUDE.md` under Directory layout.

**On frameworks and conventions (Ken, 2026-09-04):** there is no framework
here, and that is a hard rule rather than an omission. `dependencies` in
`package.json` stays `{}` so the tool runs from a `git clone` with no install
step. The helper is `node:`-prefixed core modules plus global `fetch`; the
layer is standard DOM APIs. Playwright is a devDependency, and `marked`,
`mermaid` and Heroicons are vendored under `vendor/` rather than installed.

So there is no external folder convention to follow. The convention is this
repo's own, and it is already enforced in two places:

- `src/shared/manifest.js` lists every file under `src/` exactly once, with an
  owner and a one-line reason. `npm run lint` fails when a file is missing from
  it or listed twice.
- `CLAUDE.md` states the placement rule: put new code in the directory that
  matches its job in the architecture doc, and if nothing fits, that is a sign
  the architecture needs an update rather than `src/` needing a new top-level
  folder.

**So the diagram has a second job:** not only "here are the four folders", but
"here is how you decide which one your new file belongs in". It should make
four things visible.

- **What each folder is for.** `shared/` is the one place a wire-protocol field
  name or item-record shape is spelled, and both sides import it. `layer/` runs
  in the browser. `service/` runs in the helper process. `cli/` is the command
  surface.
- **Which way dependencies point.** `layer/` and `service/` both depend on
  `shared/`, and never on each other.
- **Why `layer/` is drawn as an ordered list rather than a cloud.** There is no
  module loader in the browser, so the concatenation order in `manifest.js` is
  the dependency order, and a file may only use what a file above it registered.
- **The three files that are not free to move.** `manifest.js`,
  `review_format.js` and `layer/selection.js` are marked frozen, and a change
  to any of them goes through the orchestrator.

### 3. `item_lifecycle.md`

**APPROVED 2026-09-04.** Ken: "a good idea."

**Rewritten 2026-09-04 after Ken said the first version did not explain
itself.**

Every comment you leave and every edit you make is one "item". At any moment an
item is in exactly one of four states, and this diagram is the picture of those
four states and the arrows between them.

**The four states, in your words:**

- **draft.** You are still typing. Saved so you cannot lose it, but no agent
  can see it.
- **ready.** You hit Cmd-Enter, or you committed an edit. Now an agent may
  act on it.
- **handled.** An agent says it made the change.
- **not_handled.** An agent says it did not, and gives you a reason to read.

**The part that is not obvious:** every arrow also says WHO is allowed to draw
it. You move an item from draft to ready; an agent cannot. An agent may only
move an item out of ready, and only for the exact version of it you last
wrote. The helper never moves anything on its own; it only records the moves it
is told about.

**Two things that look like states and are not.** An agent asking you a
question leaves the item in ready, because the work is still outstanding and
the question is answered on the card. Reopening a handled item is just an arrow
back to ready, not a fifth box.

**Who it is for:** both audiences, which is why it earns Tier 1.

- **Somebody working on LAHE's own code.** The who-is-allowed rule is the thing
  that stops a reply handler from marking your half-written comment as done. If
  the rule only lives in a code comment, the next person writing that handler
  does not see it.
- **An agent using the tool on a document.** It answers the two questions
  agents get wrong: why a draft is invisible to them, and why answering with a
  question does not take the item off their plate.

**Why it does not exist yet:** `src/shared/lifecycle.js` says out loud that the
architecture's state diagram IS its transition table. The table is in the code.
The diagram it points at is not, in current form.

**Embedded in:** `docs/CONTRACTS.md`.

### 4. `review_round_trip.md`

**APPROVED 2026-09-04.** Ken: "probably a very important one."

**Shows:** One comment, end to end, as a sequence.

- Reviewer types, library writes browser storage on every keystroke
- Cmd-Enter confirms, library posts the event
- Helper appends to `events.jsonl`, projects `review.json`
- Agent reads, edits source, rebuilds, appends one reply line
- Library polls replies, the card updates, the highlight clears

**Why:** It is the product in one picture, and it is the loop an agent is
being asked to join.

**Embedded in:** `AGENTS.md` at Step 3.

**On the different paths (Ken, 2026-09-04): yes, and the split is in a useful
place.** `docs/ongoing/SERVING_ARCHITECTURES.md` already settles that there are
four shapes, plus a fallback:

| Shape | Who serves the page | Written into your folder | Where the agent's edits go |
| --- | --- | --- | --- |
| Static HTML doc | the LAHE review server | nothing | that HTML file |
| Markdown doc | the LAHE review server, which renders it first | nothing | the `.md` source |
| Built document | the LAHE review server, after you run the build | nothing | the source fragments, then rebuild |
| App in dev | your own dev server | one pasted line in a layout | the app's code |
| `file://` fallback | nobody, the browser opens the file | the script line, plus a copy of the library | the HTML file |

**Ken asked whether the last row differs from the first.** Same document, same
edit target, different plumbing, and the third column is the whole difference.
On the served row, LAHE puts the script line into the response as it serves the
page, so nothing lands in your folder and the line cannot be lost. On
`file://` there is no server to do that, so the line is written into the HTML
file itself and a copy of the library is written beside it. That is why an
agent rewriting the page takes the line out with it, and why this row alone
needs the heal step. Worth two rows on the diagram, not one.

The useful thing is that **the first half of the round trip is identical in all
five.** You type, the library saves every keystroke, you confirm, the record
goes to the helper, the helper appends it to the log and rewrites
`review.json`. Nothing about how the page got served changes any of that.

**Only the agent's half branches**, and it branches on two questions:

1. **What does the agent edit?** The served page, or the source behind it.
2. **How does the reviewer's page get the change?** LAHE watches the file and
   the page reloads itself; or the project's own build runs first and then it
   reloads; or the dev server hot-reloads on its own.

So the diagram is one shared spine with a labeled fan on the agent's side,
rather than five separate sequences. Five sequences that are 70 percent
identical is how a diagram folder starts drifting.

**And the fallback gets called out on the picture**, because it is the one path
where the loop can quietly break: on `file://` the script line lives in the
file itself, so an agent rewriting the page takes the line out with it, and the
repair only lands if a page with a live layer is still polling. That is worth a
marked branch, not a footnote.

**One more path worth a note on the diagram:** the library works with no helper
running at all. Everything stays in browser storage and the copy and export
buttons carry it out. No agent loop, but no lost work either.

### 5. `session_ownership.md`

**APPROVED 2026-09-04.** Ken: "this sounds like a good one."

**Shows:** What an agent session owns and what the handoff does.

- One helper per machine, many agent sessions
- A session owns reviews, a review owns pages, a session owns its static
  servers
- The immutable-owner rule: the CLI refuses a page owned by another session
- Takeover advancing the handoff fence, and the old monitor exiting with 6

**Why:** AGENTS.md spends more words on this than on anything else, because it
is where agents break. It is a structural thing being described in prose, which
is exactly what a diagram is for.

**Embedded in:** `AGENTS.md` at Agent-session isolation.

---

## Tier 2: the three engines that are hard to hold in your head

These are the parts where reading the code does not give you the shape.

### 6. `finding_the_region.md`

**APPROVED 2026-09-04, and renamed on Ken's note.** He flagged that "anchor" is
overloaded in an HTML tool, where `<a>` is already called an anchor. He is
right, so the file is named for what it does instead.

**The concept keeps its name, though, and that is a deliberate call.** "Anchor"
is load-bearing across the codebase: 224 mentions in `src/`, a module called
`anchor.js`, five test files named for it, decision D9 in the architecture doc,
and field names that ship inside `review.json`. Renaming it is a real refactor
with wire-format consequences, not a docs tweak. So the file name avoids the
collision and the diagram opens by naming it out loud: in this repo an anchor
is how a saved comment or edit finds its spot on the page again, and it has
nothing to do with `<a>` tags. Saying that once on the picture is worth more
than a rename that touches everything.

If you do want the concept itself renamed, that is its own piece of work and
should get its own row on the board rather than riding along with the diagrams.

**Shows:** How a record finds its region again, as a ladder with an honest
refusal at the bottom.

- `data-lahe-id` stamp, if it is unique in the document
- Normalized text, if it hits exactly once
- Text plus tie-breakers plus a widened context ring
- The element fingerprint, for regions with no words
- Surfaced as lost, never guessed

**Why:** D9 is the decision that keeps one edit from landing on the wrong list
item, and the rungs are spread across `anchor.js`, `uniqueness.js`,
`pointing.js` and the 2026-08-26 amendment.

### 7. `replay_branches.md`

**APPROVED 2026-09-04.** Ken: "sounds like a good idea."

**Shows:** The four-way compare that runs after any repaint, per record.

- DOM matches the current `after`: do nothing
- Matches `before`: apply the edit again
- Matches an earlier rev's `after`: re-apply current, tell the card
- Matches none: the page changed underneath, flag it and write nothing

**Why:** This is the single mechanism that lets live editing and agentic
editing run at the same time without clobbering. Four branches with different
consequences is exactly a flowchart.

### 8. `protected_region.md`

**APPROVED 2026-09-04.** Ken: "this kind of stuff that protects from lost work
and creates a seamless UX is very important."

**Shows:** The three protection layers while a block is being edited, and what
happens at commit.

- Cooperative skip attribute for frameworks that honor it
- Pre-morph veto where the framework offers a hook
- Selection snapshot plus mutation-observer restore, the framework-free
  fallback
- On commit: protection lifts, the record is made, a replay pass runs
  immediately so a suppressed change surfaces instead of vanishing

**Why:** The round-2 review proved restore-after alone cannot save the caret.
The reason there are three layers rather than one is the whole point, and prose
buries it.

---

## Tier 3: useful, lower urgency

### 9. `agent_workflow.md`

**Recast 2026-09-04 on Ken's note.** He said: if there are workflows here then
yes, but a list of commands and what they do is not a diagram. Correct. The
command list stays a table in `docs/CLI.md`, where it already belongs.

What IS a diagram is the loop an agent actually moves through, with the
commands sitting on the arrows rather than in a list:

- `lahe review <target>` starts it, and prints the values you are meant to use
  verbatim: the open URL, the session id, and the wake, drain and close lines
- arm the wake channel once, and the shape of that differs by host
- a wake line lands, so run the drain
- handle the items, edit the source, rebuild, verify the change is really in
  the built page, append one reply line each
- drain again, and repeat until it prints nothing
- `lahe session close <id>` at the end

Plus the branches, which are the part prose handles badly:

- **Another document.** Rerun `lahe review` with the same `--session`, which
  loops back rather than starting over.
- **A handoff.** `lahe session list`, then `lahe session takeover <id>`, then
  the catch-up before anything else.
- **The monitor exit codes.** 0 means work, so handle it and relaunch. 5 means
  the session is closed and 6 means somebody took it over, and both mean stop.

That last one is the whole reason this earns a picture: three exit codes where
two of them mean the opposite of the third, described in prose, is exactly how
an agent ends up relaunching a monitor it should have let die.

### 10. `request_checks.md` — CUT, on Ken's note

He said this sounds like documentation rather than a diagram, and might still
be good to have. I went and checked the code before answering, and he is right:
`src/shared/protocol.js` holds the six checks as a flat list, each with a
refusal code and a one-line reason, and `auth.js` calls them from exactly one
place with no branch that skips any of them. There is no ordering to show and
no fork to draw. A list with one call site is a table.

**So it becomes a table in `docs/CONTRACTS.md`**, not a file in the diagrams
folder. The content is worth having. The picture is not.

**The test this established, and the rest of Tier 3 is now held to it:** if the
thing has no branch, no ordering that matters, and no two parties passing
something back and forth, it is a table. Write the table.

### 11. `merge_on_load.md` — APPROVED 2026-09-04

Ken: "fine to make this its own doc that is referenced." So it is its own file
in `docs/diagrams/`, and the docs that need it link to it rather than carrying
their own copy.

Two parties doing things in an order where the order is the entire point: the
browser holds undelivered work, the store holds status, they reconnect, and who
wins depends on which field and which revision. Browser wins on content, store
wins on lifecycle for the revision it named. That is a sequence diagram in the
literal sense, and the architecture doc already draws one. This would be the
current standalone copy.

### 12. `wake_channel.md` — FOLDED into `agent_workflow.md`, with a condition

The fold is still right: item 9 is now the agent's loop, and the wake feed, the
tail, the exit codes and the per-host differences all live on the arrows of
that loop. Two pictures of one thing means one of them goes stale.

**But Ken's point stands and outranks the tidiness argument.** Avoiding no-op
token burn is a product feature, not an implementation detail, so it does not
get quietly absorbed. Two things follow.

**First, the fold is conditional.** `agent_workflow.md` is only allowed to
absorb this if it actually carries all four pieces:

- the wake feed as the thing that stays silent, versus a timer that does not
- the per-host fan, because the right move genuinely differs by host
- the three monitor exit codes, where 0 means relaunch and 5 and 6 mean stop
- the failure being avoided, drawn as its own branch: a timing-out monitor is a
  scheduled model wakeup wearing a disguise

If the drawing cannot hold all four legibly, the fold is off and
`wake_channel.md` comes back as its own file.

**Second, I went and audited what exists today rather than guessing.** The
instructions are in five places, and they correctly travel together:

| Where | What it says |
| --- | --- |
| `AGENTS.md` | the full per-host section, with the why spelled out |
| the `contract` in `review.json` | the same instructions, shipped into every review |
| `docs/CONTRACTS.md` | the restated copy of that contract |
| `docs/CLI.md` | the Antigravity timer warning |
| `README.md` | the user-facing promise: zero tokens while you are quiet |

**The real gap is narrower than "we need documentation", and it is worth
fixing.** The full explanation of WHY lives inside the Claude Code subsection.
An agent on Codex or Antigravity reads a one-line warning and never sees the
reasoning. So:

**New Tier 3 item, a doc task rather than a diagram:** hoist the why into a
short host-independent paragraph at the top of the wake channel section, above
the per-host fan, so every agent reads it regardless of which host it is on.
Then fold that same paragraph into the contract text, since the contract is the
only thing an agent is guaranteed to see.

One caution worth stating, because it changes what "good documentation" means
here: prose alone has not held on this before. The enforcement that works is
the printed command carrying the right flags and the contract shipping in
`review.json`. More words help an agent that reads them; the printed command
helps the one that does not. Do both, and do not mistake the paragraph for the
fix.

### 13. `build_and_gate.md` — CUT 2026-09-04, on Ken's note

Ken: "this sounds like something we shouldn't make the AI do. If we're just
compiling JS files into a single file for simpler injection, that should be
done with a script or command, so it can be consistent."

**It already is, and I checked before answering.** `npm run build:layer` does
the gluing, and `npm run check:layer` fails when the checked-in copy is stale.
No agent concatenates anything by hand, and the order comes out of
`manifest.js` rather than out of anyone's judgment.

**Which kills the diagram, by our own test.** Take away the ordering (the
script owns it) and what is left is: three test commands, which is already a
clear table in `CLAUDE.md`, and one rule about who commits the built file,
which is one sentence. No branch, no ordering that matters, no two parties
passing something back and forth. Table.

So this one is cut. The explanation below is kept only because it is the plain
language version of a thing `CLAUDE.md` currently says in jargon, and that
wording is worth lifting into `CLAUDE.md` when someone next touches it.

It was jargon. Here it is in plain words.

**The situation.** The part of LAHE that runs in the browser is about thirty
small source files. A page cannot load thirty files, so they get glued into one
file, and that one glued file is what a page actually loads. A copy of it is
checked into the repo, at `dist/lahe-layer.js`, so somebody cloning the repo
gets a working tool with no build step.

**That creates three rules that people get wrong.**

1. **The gluing order matters.** The browser has no way to work out which file
   needs which, so the files are glued in a fixed order and a file may only use
   something a file above it already set up. The order is written down in
   `manifest.js`.
2. **The checked-in copy goes stale.** Edit a source file and the glued copy no
   longer matches it. One of the test commands catches that.
3. **Only one person rebuilds it.** When several people work in parallel,
   everybody rebuilding the glued file means a conflict in a machine-generated
   file every single time. So builders never commit it, and the orchestrator
   rebuilds it once at each checkpoint.

**And there are three test commands, not one**, checking overlapping but
different sets of things. Running the wrong one is how a builder either wastes
ten minutes on browser tests they did not need, or misses the staleness check
entirely.

**So the picture is:** source files, glued in a known order, into the one file
the page loads, with a note on who is allowed to commit it, and the three test
commands drawn against what each one actually covers.

**Where this text goes instead:** into `CLAUDE.md` under Running the gate, as
plain-language replacement wording. Not into `docs/diagrams/`.

---

## The first batch

**Eight, approved 2026-09-04: all of Tier 1 and all of Tier 2.**

1. `system_overview.md`
2. `module_map.md`
3. `item_lifecycle.md`
4. `review_round_trip.md`
5. `session_ownership.md`
6. `finding_the_region.md`
7. `replay_branches.md`
8. `protected_region.md`

Together they cover what the system is, where the code lives, what an item
does, how a comment travels, who owns what, and the three engines that are
genuinely hard to hold in your head.

**Tier 3 after Ken's "is it actually a diagram" test, 2026-09-04:**

- `agent_workflow.md` recast from the command list, and it absorbs
  `wake_channel.md` only if it carries all four wake-channel pieces
- hoist the no-op token burn reasoning into a host-independent paragraph in
  `AGENTS.md` and into the contract text, a doc task rather than a diagram
- `merge_on_load.md` APPROVED, as its own referenced file
- `build_and_gate.md` CUT, the script already enforces it; its plain-language
  wording goes into `CLAUDE.md` instead
- `request_checks.md` CUT, it becomes a table in `docs/CONTRACTS.md`

**Tier 3 finished as one approved diagram plus three doc tasks.** Two of the
five proposals did not survive the test, which is the test working.
