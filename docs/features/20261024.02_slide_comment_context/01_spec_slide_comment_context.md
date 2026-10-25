# Keep the slide with a deck note

Lahe currently sends page notes without the slide the reviewer was viewing. The fix is in progress. Ken has no decision to make.

## Intended behavior

- A new note on a Reveal deck records the visible slide when the reviewer starts typing.
- The snapshot includes the slide's position, author id, heading and a short text excerpt. It stays with the note after navigation, sending and reload.
- The agent receives this context as page data in the drain and exports. An ordinary document note remains a page note without slide context.
- Slide instructions tell agents to use the captured slide when interpreting references such as this slide. They use its id and words when numbering changes. They do not guess an insertion point from the last comment.

## Scope and approach

Capture optional slide context at the first nonblank input, rather than when the always-open composer is created. Read the deck's active slide from its DOM. Keep notes unanchored, so a deck-wide request can still apply to the whole deck.

This is separate from [the icon fix](../20261024.01_panel_icon_fingerprint/01_spec_panel_icon_fingerprint.md). Work is isolated on `fix/slide-comment-context`, based on the icon fix. No browser runs overlap the icon fix's full gate.

## Verification

| Check | Owner | Status and evidence |
| --- | --- | --- |
| Projection and bounded page data | Codex | Pending |
| Real Reveal note captures the slide at first input and survives navigation and reload | Codex | Pending |
| Vertical slides and ordinary document notes | Codex | Pending |
| Real note, CLI drain and agent response | Codex | Pending |
| Independent code, acceptance and instruction review | Independent reviewer | Pending |
| Full project gate | Codex | Pending |

## Progress

The page-note composer creates an empty record at page load and persists it at the first keystroke. It currently stores an empty context. The agent's slide runbook covers editing and building decks but does not tell it how to locate a page note's slide.

No cleanup removals are requested.
