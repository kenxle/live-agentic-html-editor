# Inline reword: the comment's own words are the input

Ken, looking at the rail's card actions:

> do we really need a button for "reword"? before we could just edit a comment
> and the color would go from green to yellow and that was how we knew.

So the Reword button is gone. A card's note is directly editable: click into it
and type. The item drops from ready back to draft, its wash goes green to amber,
and it leaves the set the agent may act on. Cmd-Enter readies it again and moves
the revision once. Delete stays.

Branch: `task/feat-inline-reword`. Files: `src/layer/comments.js`,
`src/layer/tab_active.js`, and the specs and fixtures that clicked the button.

---

## What a reviewer does now

| gesture | what happens |
| --- | --- |
| click the words on a card | a rewording session opens on that item, in place |
| type | every keystroke is durable at once, the card goes amber (draft), the item leaves review.json |
| Cmd-Enter | committed: rev +1 exactly once, ready, green again, and the caret stays in the note |
| Esc | commits the same way and leaves the note; an item that was ready goes back to ready |
| click away | commits the words (still one bump) and leaves the state where the reviewer left it, so a half-rewritten comment is still amber when they come back |
| type the old words back | nothing was withdrawn: it goes green again and the revision does not move |

A DRAFT item's note is the same surface. Typing just updates it; Cmd-Enter
readies it. Nothing here ever readies a comment the reviewer did not ready.

## contenteditable, not a textarea

The note node is `contenteditable` (`plaintext-only` where the engine has it,
feature-detected, plain `true` where it does not). It is NOT swapped for a
textarea on click, for two reasons:

1. **The rail's law.** A card holding focus is never re-created. A node swapped
   for a control the moment the reviewer clicks it is that same revert by
   another name. The node the reviewer READS and the node they TYPE IN are one
   node, created once with the row.
2. **Height.** A textarea has to have its height driven off its own scrollHeight
   on every keystroke to keep flowing like prose. A card whose height is computed
   in two places is a card that jumps.

The cost, stated plainly: reading the words back out of an editable node is not
`textContent` (which runs two typed lines together) and not `innerText` (which
falls back to `textContent` this deep in nested closed shadow roots). There is a
small `plainTextOf()` in comments.js that walks the child nodes and turns `<br>`
and wrapper blocks back into newlines.

## Where the rules live

All of it is in `comments.js`, because a rewording is a rewording wherever it is
entered. `tab_active.js` draws the note and hands the node over once:

- `comments.attachNoteEditor(id, node)` — the tab registers its note node. This
  is called when the row is BUILT, once per item.
- `comments.editInPlace(id, node)` — the session, started by the node's own
  focus event. It returns the open one if there is one, the same way `reopen`
  does for a box: a session is never re-created under a caret.
- `comments.detachNoteEditor(id)` — the tab calls this when the row goes.
- `comments.noteEditor(id)` — what the surface is offering right now, for a
  caller that cannot reach into the closed root.

The session is the SAME `buildHandle` the box uses, with the note node as its
input, so `type()`, `flushReword()`, `markReady()` and `close()` are the ones
that already shipped (R21: keystrokes are content, the commit is the revision).
Three things changed inside it:

- `type()` drops a READY item to draft while the words differ from what was last
  committed, and puts it back when they match again. This is the green-to-yellow
  Ken is describing, and it is the same state that keeps a draft out of
  review.json, so the colour cannot drift from what the file says.
- `flushReword()` asks whether the item was committed WHEN THE SESSION STARTED,
  not whether it is a draft right now. Without that the transient draft the
  session itself creates would mean a rewording never bumped rev at all, and a
  stale reply would be accepted.
- `close()` on an in-note session takes its listeners off and LEAVES THE NODE.
  Those words are the card.

## Read-only

A window that loses the review unbinds the comments group (`index.js`
`enterReadOnly`). `bind()`/`unbind()` now also flip every registered note node
between editable and `contenteditable="false"`, and `editInPlace` refuses to open
a session while unbound. A refused window still SHOWS every comment and cannot
type in one. An affordance offering to do something the window cannot do is worse
than no affordance.

## Failing first

`test/browser/inline_reword.spec.js`, against the code before the change:

```
Running 5 tests using 5 workers

  ✘  3 inline_reword.spec.js:342 › a read-only window cannot type in the note (32ms)
  ✘  5 inline_reword.spec.js:313 › there is no Reword button on a card, and Delete is still there (891ms)
  ✘  4 inline_reword.spec.js:183 › typing in a ready card's note drops it to draft and washes the same card amber (10.9s)
  ✘  1 inline_reword.spec.js:220 › Cmd-Enter in the note readies it again: one rewording, one revision, green again (10.9s)
  ✘  2 inline_reword.spec.js:262 › the agent's file loses the item while it is being reworded and gets it back at the committed revision (11.1s)

    Error: Timed out after 10000ms waiting in the page for the card to hold the reviewer's cursor.
    Error: the button the note replaced is gone
      expect(received).toBe(false)  Received: true

  5 failed
```

After: 5 passed, and the same five green on chromium, firefox and webkit.

## What else changed, and why it is not a weakening

- `reword_rev.spec.js` (R21 arithmetic) now enters through the note instead of
  the button. Every assertion it made is still there, plus one: mid-sentence the
  item is a `draft`.
- `rail_design.spec.js` asserted the card's two buttons were `["Reword",
  "Delete"]` with space between them. It now asserts the card's one button is
  `["Delete"]`, that the NOTE is editable and drawn with a text cursor, and that
  the action row is clear of the reviewer's sentence.
- The same file's handled-card test asserted "Reword is not visible on a handled
  item". It now asserts the note is still ATTACHED (a row is never withdrawn from
  a card) and not DRAWN.
- `cp1_walk.spec.js` and its fixture (`rewordButtonRect` is now `noteRect`) click
  the words instead of the button. Because a click lands where it lands in a
  sentence, the walk now selects all and rewrites the sentence rather than
  assuming the caret is at the end.
- `test/unit/comments_surface.test.js` gains the Node-side half: the drop to
  draft, the commit still bumping once through it, and the words typed back being
  neither.

## One layout fix that came with it

The hosted row had no gap between the note and the action row, which did not
matter when the note was prose and does now: the click target ended exactly where
Delete began. `[data-lahe-active-row]` is a flex column with an 8px gap.

## Verified by hand

A real Chromium, driven through the whole gesture on the app fixture with a live
helper, both schemes (`walk_*.png` in the session scratchpad):

```
01 ready       state=ready rev=1 card=rgb(241,248,244)  (green)   scheme=light
02 typing      state=draft rev=1 card=rgb(253,248,239)  (amber)   note focused, white, ring
03 Cmd-Enter   state=ready rev=2 card=rgb(241,248,244)  (green)
04 dark ready  state=ready rev=2 card=rgb(26,36,32)               scheme=dark
05 dark typing state=draft rev=2 card=rgb(38,34,27)     (amber)   note bg rgb(28,32,40), ink rgb(233,235,240)
06 dark commit state=ready rev=3 card=rgb(26,36,32)     (green)
```

## Nothing needed from another owner

No API was needed from `overlay.js`, `store.js`, `sync.js`, `editing.js` or
`index.js`. The wash follows `setCardState` exactly as it already did, and the
draft flush to the helper is the ordinary store write.
