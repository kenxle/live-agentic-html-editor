# Choice buttons

## Charter

**What belongs:** How a choice group works now: the component an agent writes, what a press records, how the layer finds and paints a group, how presses travel, how the decision ends up in the document, and what agents are told.

**What does not:** Why it was built this way (the feature folder, `docs/features/20261013.01_choice_buttons/`). The rail's look (STYLE_GUIDE.md). The record's full field table (CONTRACTS.md).

**Level of detail:** Enough for an agent or a builder to use or change it without reading the code first.

**Sources:**

- [the feature's architecture](../features/20261013.01_choice_buttons/02_architecture_choice_buttons.md)
- [CONTRACTS.md](../CONTRACTS.md), "The record" and "`lahe status`"
- [the component catalog](../../vendor/stclair-doc-style/COMPONENTS.md)
- [the lahe skill](../../skills/lahe/SKILL.md), "Writing a page for someone to read"
- [finding the region](../diagrams/finding_the_region.md), [the item lifecycle](../diagrams/item_lifecycle.md)

Written from the architecture before the build; the integration pass corrects anything the build changed.

## Summary

An agent writing a page for a person can put a choice on it: a question with two or more answers drawn as buttons. The reviewer clicks one. The click is a record of its own kind, `choice`, that names the group and the answer, so two groups that both offer "Promote" are never confused. The press reaches the agent in the drain as data. The agent acts, writes the decision into the page's source, and replies on the thread. From then on the document carries the decision, with or without Lahe.

It works only on pages the Lahe program serves itself as documents. On a page from someone else's dev server the layer claims no click.

## The component

```html
<div class="choice" data-choice="lesson-css-counter">
  <p class="choice-q">Promote this lesson?</p>
  <button type="button" value="promote" data-recommended>Promote</button>
  <button type="button" value="discard">Discard</button>
</div>
```

- `data-choice` names the group: lowercase letters, digits and hyphens, 1 to 32 characters, starting with a letter or digit (`record.CHOICE_TOKEN`). Unique on the page. It is not under `data-lahe-` on purpose: the tool strips that prefix from captured markup, and the name must survive.
- Each button's `value` follows the same grammar. The button's text is the label. `type="button"` keeps it out of any form. `data-recommended` marks at most one.
- Once the agent has handled a press, it writes `data-chosen` onto the chosen button in the source. The stylesheet draws that button as the decision with no Lahe present.
- In Markdown the block is written as HTML with a blank line before and after. The catalog entry is in COMPONENTS.md.

## Which pages are live

The Lahe program adds `data-lahe-document` to the script tag of every page it serves itself (rendered Markdown, an HTML page under a served folder, a `lahe write` page), on the response and never on disk. A tag written by `lahe add` into a file or printed for a dev server never carries it. The layer arms choice groups only when its tag carries the attribute; everywhere else a group is inert and raises nothing.

On a document page the layer refuses a group with no name, a name or value off the grammar, fewer than two buttons, or a name shared with another group, marks it `data-lahe-inert`, and raises a rail chip that names the group and the reason.

## A press

The click is decided by the gesture table (`gestures.GESTURE.PRESS_CHOICE`): a button inside an armed group, in browse mode, outside element pick, with no block open for editing, in a window that may write, not in present mode. It has no hint row, so a page without groups shows the same rail hints as before.

A press mints a record of kind `choice` in `draft` and marks it `ready` in the same tick. Its intent is the `choice` field, `{group, answer}`, and nothing else: no `note`, no `before` or `after`, no stamp. `context.quote` carries the question and `context.heading` the nearest heading. The helper's door and the projection both refuse a choice record off the grammar.

Pressing another answer before the agent replies is the reword path (`ready` to `draft` to `ready` at the next revision). After `not_handled`, a press reopens the same record. After `handled`, a press mints a new one. Mark as done, reopen and delete work as for a comment, and the card keeps the ordinary reply box; words typed there go in `note` as a follow-up turn.

## Finding and painting a group

`anchor.resolve` has a rung keyed on the record's kind: a choice resolves to the one element matching `.choice[data-choice="<group>"]`. Two or none is a refusal with its own reason, and the rung stops there. Replay, lost-marking and "show me where" then work on a choice unchanged. Replay writes nothing for the kind; after the rung binds it paints `data-lahe-pressed` on the pressed button and `data-lahe-choice-state` (`kept`, `open`, `question`, `not_handled`, `done`) on the group, from the group's latest record by `created_at`. A newer press draws over a `data-chosen` button. These attributes are DOM only; a rebuild clears them and the next pass paints them again.

## Presses travel together

The outbox holds every event of a choice item until 3 seconds after the page's last press, capped at 10 seconds from the first held press; hiding the tab or leaving the page flushes at once. The helper writes one wake line per accepted ready item, but every supported host waits with `lahe monitor`, which polls every 15 seconds and exits once on the first poll with undelivered work, so one post of several presses is one wake. A clicking session costs about one wake per agent work cycle. A quiet spell in the monitor is a board row (LAHE-monitor-quiet-spell), not part of this feature.

## What the agent reads and does

The drain line carries `kind: choice` and `choice: {group, answer}` at the top level, and under `page` only the path, the question as `quote` and the heading. No html, region or before-and-after fields. The agent answers with the same reply command: `handled`, `not_handled` with a reason, or `question`. Handling includes writing `data-chosen` onto the chosen button in the source; a handled reply that leaves it out is incomplete, the same rule as a missing `data-lahe-id`. The page check never runs on a choice.

The contract paragraph in review.json, the skill's component table and COMPONENTS.md say all of this to agents, and they travel together (CLAUDE.md, "Agent-facing docs").

## Where things live

| Piece | File |
| --- | --- |
| The kind, the field, the grammar, the checker | `src/shared/record.js` |
| The field's class, the drain shape, the contract paragraph | `src/shared/review_format.js`, `src/cli/commands/status.js` |
| The gesture | `src/shared/gestures.js` |
| The tag attribute | `src/shared/protocol.js`, `src/service/page_routes.js` |
| Arming, minting, the chip | `src/layer/choices.js` |
| The rung | `src/layer/anchor.js` |
| The hold | `src/layer/sync.js`, `splitForFloor` |
| The paint | `src/layer/replay.js` |
| The cards | `src/layer/tab_active.js`, `tab_done.js`, `overlay.js` |
| The look and the catalog | `vendor/stclair-doc-style/document.css`, `COMPONENTS.md` |
| What agents are told | `skills/lahe/SKILL.md`, the contract array |
