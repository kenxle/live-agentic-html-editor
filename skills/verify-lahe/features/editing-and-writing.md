# Editing and writing

A reviewer changes words directly on the page. The change goes to the agent as
an edit with the before and after text. The agent changes the source file, the
page rebuilds itself, and the card moves to Done once the helper sees the new
words on the built page. On a blank notes page (`lahe write`), the reviewer
just types, and the agent places the new blocks in the file.

## Sub-features

- `edit-passage`: edit words in an existing paragraph and commit with Escape.
- `edit-agent-places`: the agent changes the source and replies handled; the page shows the change once, after reload too.
- `edit-handled-check`: a handled reply is accepted only when the new words are on the built page.
- `notes-blank-page`: `lahe write` opens a blank page ready to type; headings and paragraphs become new blocks.
- `notes-agent-places`: the agent writes the blocks into the file and they show once.

## How to get to it (user POV)

- Click into a paragraph, press Cmd-Shift-E (Ctrl-Shift-E elsewhere), type, press Escape.
- Run `lahe write <file.md>` and open its address. The page opens with a caret ready. Type, press Enter for a new block, Escape when done.

## Driving it with lahe-verify

Preconditions:

- For editing: a fresh run on the sample document.
- For notes: a fresh run started with `lv up --write --doc notes.md`.

- **Place the caret.** Run `lv page caret "text=The garden plan needs" --text "second pass"`.
- **Edit.** Run `lv page key ControlOrMeta+Shift+KeyE`, `lv page type " (and a soil test)"`, `lv page key Escape`. `lv agent wait "soil test"` shows `"kind":"edit"` with `before` and `after_full`.
- **Agent places it.** Change `a second pass before spring` to `a second pass (and a soil test) before spring` in `<source>` (for example with `sed -i ''`). Run `lv agent reply <item> 1 handled --text "Added the soil test."`. Then `lv page wait "window.__lahe.items().find(i=>i.kind==='edit').state === 'handled'" --timeout 30000`.
- **Still there after reload.** Run `lv page reload` and `lv page eval "document.body.innerText.split('(and a soil test)').length - 1"`. It prints `1`.
- **Blank notes page.** On the `--write` run, `lv page wait "window.__lahe.editState().open === true"`. Then `lv page type "# Notes"`, `lv page key Enter`, `lv page type "First thought about the shed."`, `lv page key Escape`. `lv agent wait "First thought"` shows `new_blocks` with an `h2` "Notes" and a `p`, placement at the start of `main`.
- **Agent places the notes.** Write `## Notes`, a blank line and `First thought about the shed.` into `<source>`. Reply handled to the item at its rev. After `lv page reload`, the sentence appears exactly once on the page.
- **Proof.** `lv page shot` after each handled state, the source file contents, and the drain lines.

## Gotchas

- Wait for `agent wait`, not just the page state, before the agent step. The page commits first and sends a moment later.
- Never reload the page to make a rebuild appear. If the page does not change on its own after the source changes, that is the bug.
- A handled reply whose words are not in the built page stays outstanding with `handled_not_on_page`. That is the handled check working, not the tool failing.
- Typing only works while the page keeps focus. That is why `lahe-verify` holds one browser connection for the whole run. If an edit closes on its own between commands, run `lv doctor` and check the keeper.
- Regression specs: `free_writing_seams.spec.js --grep "placement: a header"`, `free_writing_seams.spec.js --grep "notes page:"`, `cp2_walk.spec.js`, `formatting_survives.spec.js`.
