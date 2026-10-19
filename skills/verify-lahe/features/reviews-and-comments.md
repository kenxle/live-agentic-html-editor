# Comments and replies

A reviewer selects words on the page and leaves a comment, or leaves a note on
the whole page. The agent reads it from its drain and answers. The answer shows
on the comment's card in the rail, and the reviewer can answer back in the same
thread.

## Sub-features

- `comment-passage`: a comment tied to selected words, with the quote on its card.
- `comment-page-note`: a note not tied to any passage, from the rail's page-note box.
- `comment-agent-answer`: the agent's question or handled reply appears on the card.
- `comment-follow-up`: the reviewer answers in the thread; the agent gets it as the next revision.
- `comment-delete`: the reviewer deletes an outstanding comment; it leaves the agent's drain.

## How to get to it (user POV)

- Select words on the page, press Cmd-Shift-C (Ctrl-Shift-C elsewhere), type, press Cmd-Enter.
- Type in the rail box under "Add a note on the whole page", press Cmd-Enter or Send.
- Read the agent's answer on the card. Type in the card's "Add a new message" box and press Cmd-Enter.
- Press × ("Delete this comment") on a card.

## Driving it with lahe-verify

Preconditions:

- A fresh run on the sample document. `lv doctor` is all `ok`.

- **Select words.** Drag across "roof leaks". Run `lv page select "text=The shed roof leaks" --text "roof leaks"`. It prints `"selected": "roof leaks"`.
- **Write the comment.** Run `lv page key ControlOrMeta+Shift+KeyC`, `lv page type "Which side is north?"`, `lv page key ControlOrMeta+Enter`. `lv page rail` shows one item, kind `comment`, state `ready`.
- **Agent receives it.** Run `lv agent wait "Which side is north"`. The drain line has `"kind":"comment"`, `"quote":"roof leaks"` and the note text.
- **Agent asks back.** Run `lv agent reply <item> 1 question --text "Is north the road side?"` and `lv page wait "(window.__lahe.items()[0].reply||{}).status === 'question'"`. `lv page shot reply` shows the card with a QUESTION chip and "verify is asking" above the agent's words.
- **Reviewer answers.** Run `lv page click "rail:textarea[aria-label='Follow up']"`, `lv page type "Yes, the road side."`, `lv page key ControlOrMeta+Enter`. `lv agent wait "Yes, the road side"` shows the same item at `"rev":2` with a `thread` holding the first exchange.
- **Page note.** Run `lv page click "rail:textarea[placeholder='Not tied to any passage']"`, `lv page type "Overall this reads well."`, `lv page key ControlOrMeta+Enter`. `lv agent wait "Overall this reads well"` shows `"kind":"note"`.
- **Delete.** With a second comment on the page, run `lv page click "rail:article[data-state=ready]:has(textarea) [data-lahe-act=delete]"` (or `rail-text:Delete this comment` when only one card is open). `lv agent drain` no longer has that note, and `lv page eval "window.__lahe.cardIds().length"` dropped by one.
- **Proof.** `lv page shot <name>` after the answer and after the follow-up, plus the two drain lines from `commands.jsonl`.

## Gotchas

- The follow-up box is labelled "Follow up" once the agent has answered. A hidden "Add another message to this comment" box also exists on the card; `rail:` picks the visible match.
- Delete happens at once, with no confirmation, for an outstanding comment. A handled item cannot be deleted.
- `page aria` cannot see the rail. Use `page rail` and `page shot` for card proof.
- Regression specs: `comments_highlights.spec.js` (injected layer, no helper), `agent_replies.spec.js`, `catalog_library.spec.js --grep "Open a closed review"`.
