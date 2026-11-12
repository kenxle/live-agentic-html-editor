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
