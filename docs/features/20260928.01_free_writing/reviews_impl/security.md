# Security review (implementation): free writing

Diff: `git diff 97a8270..HEAD` on `feat/free-writing` (HEAD 9b5fe24). Design review: `02_architecture_free_writing_reviews.md`, "Security Review (Round 1)".

**Summary.** Most of Round 1 was built, and built well:

- `cleanBlock` is a real allowlist. The helper refuses rather than cleans.
- `lahe write` refuses symlinks, creates with `wx`, and serves one page on its own server.
- Change text quotes no words.
- The handled check always runs on new blocks.

Three gaps are worth fixing before this ships:

1. The allowlist covers `new_blocks` only. The run record's other markup fields skip it at the helper, and replay writes one of them with raw `innerHTML`.
2. `cleanBlock` takes quadratic time on nested tags, and the helper runs it before the byte ceiling. One post from any script holding a review token can freeze the helper.
3. "Use the fixes" applies suggestions the reviewer never sees.

Findings ranked worst first. The timings in finding 2 were measured with `/private/tmp/claude-501/-Users-kennethstclair-Documents-workspace-live-agentic-html-editor/234088e7-1201-4ed5-93c2-cee1b5ec5b8c/scratchpad/cb_dos.js` and `cb_dos2.js`, and extended with a Python one-liner.

## Round 1: what was built

| Round 1 finding | Built? | Where |
|---|---|---|
| SR1, one allowlist in three places | Partly. `new_blocks`, `remove_blocks` and `anchor_tag_after` are checked at capture, at the helper, and before replay inserts. `anchor_after_html`, `after` and `after_html` on a run record are not (finding 1). | `normalize.js:1177`, `record.js:1824`, `log.js:494`, `blocks.js:300` |
| SR1, words derived from the cleaned html | Yes. The projection derives `text`; no stored `text` is read. | `review_format.js:507` |
| SR2, escaping contract line | Yes, in the contract and the skill. | `review_format.js` contract, `SKILL.md:275` |
| SR2, always check new blocks (AQ3) | Yes. | `handled_check.js` `runVerdictFor` |
| SR2, renderer link schemes | On the board (`LAHE-markdown-link-schemes`). | `docs/BULLETIN.md:16` |
| SR3, `lahe write` symlinks | Yes: `lstat` first, `wx`, recheck on `EEXIST`, real parent printed, tests. Two small gaps remain (finding 5). | `write.js:95-132`, `test/unit/write_command.test.js` |
| SR4, one-page server | Yes. Siblings, dotfiles and other renders are 404s, and there are tests. The Host check is on the board and missing from the new server (finding 6). | `static_servers.js:1160-1193` |
| SR5, change text structure only; `from_anchor` | Yes, with tests. | `record.js` `runChangeText`, `run_record.test.js:72` |
| SR6, ceiling | Set and enforced. Its order and scope have holes (findings 1 and 2). | `record.js:1627-1633`, `:1844-1848` |
| SR7, cut the sentence | Done. | architecture Security notes |
| SR8, Tiptap | Not taken. Paste is plain text only (`editing.js:1579`). | |

## Findings

### 1. A run record's anchor and sitting markup skip the allowlist

- severity: important
- kind: defect
- where:
  - `src/shared/record.js:1824-1850` (`validateRun`)
  - `src/layer/replay.js:3029-3035` (`writeAnchor`), into `:3777` and `:3784` (`writeRegion`)
  - `src/layer/editing.js:3757-3761` (`restoreRun`)
  - `src/shared/review_format.js:528`, `:569`, `:592` (`sittingMax`)
- what: `validateRun` checks `new_blocks`, `remove_blocks`, `placement` and `anchor_tag_after`. It never looks at `anchor_after_html`, `after` or `after_html`. Replay then writes `anchor_after_html` straight into the page whenever `cleanBlock` refuses it.
- scenario:
  - **Page side.** A forged record carries one clean block plus `anchor_after_html: "<img src=x onerror=...>"`. `writeAnchor` calls `blocks.writeBlock`. `cleanBlock` refuses the `img`, so `writeBlock` returns null. The code then falls back to `writeRegion(element, view)`. `markupSaysAfter(view)` holds by construction, because `anchorView` derives `after` from the same html. So the result is `element.innerHTML = anchor_after_html`, and the handler runs. Undo does the same with `before_html` at `editing.js:3761`. The code comment at `replay.js:2885` calls this path "today's anchor write, unchanged". The architecture says the anchor keeps the `cleanMarkup` path, but no `cleanMarkup` runs at this write or at the helper. Today the only way to reach this is same-origin browser storage, because `store.mergeWithHelper` still has no caller. The first change that wires a helper merge makes it reachable with a token.
  - **Agent side.** For a run record, the projection lifts the 2000-character bound on `after_full` and `after_html`. The helper does not check that `after_html` equals the anchor plus the blocks. A forged run with one tiny clean block can carry a script-bearing `after_html` of any size up to `RUN_RECORD_MAX_BYTES` (4 MiB). The contract tells an agent that "only knows apply after_html" to apply it, and the plan's old-agent line counts on that. So the allowlist the helper claims to enforce is one field wide. The size bound the agent actually sees is the whole-record ceiling, not the run's markup ceiling (`NEW_BLOCKS_MAX_BYTES`).
- fix:
  - **At the helper**, in `validateRun`, refuse a run record unless all three of these hold:
    - `after_html === buildRunAfter(anchor_after_html, new_blocks).after_html`
    - `after` equals that function's `after`
    - `anchor_after_html` is a fixed point of `cleanMarkup` and is at most `BEFORE_MAX`
  - A take-back gets the same check against `before_html`.
  - **In the projection**, or better, when the record is folded, build `after_html` and `after_full` for a run record from the cleaned parts. Do not copy the stored strings.
  - **In `writeAnchor` and `restoreRun`**, the fallback writes `normalize.cleanMarkup(html)`, never the raw string. That keeps links and drops handlers.
  - **Tests (red first):**
    - The helper refuses a run whose `after_html` has a `<script>` its blocks do not.
    - The helper refuses a run whose `anchor_after_html` carries an `onerror`.
    - Replay of a stored record with that `anchor_after_html` leaves no `onerror` attribute on the page.

### 2. `cleanBlock` is quadratic on nested tags, and the helper runs it before the byte ceiling

- severity: important
- kind: defect
- where:
  - `src/shared/normalize.js:1214` (the closing-tag scan)
  - the recursive `pruneEmpty`, `hasWords` and `trimEdge`
  - `src/shared/record.js:1844-1848` (the check order)
- what: Each closing tag walks the whole open stack. A block of N `<em>` followed by N `</b>` does N×N work. `validateRun` runs `blockListRefusal` (the parse) before `blocksBytes` and `recordBytes`. So the byte ceiling never limits the parse. Only the helper's 8 MiB body limit does.
- scenario: Measured on this branch:
  - a 256 KB block took 1.7 s
  - a 512 KB block took 6.7 s
  - each doubling of size costs four times the time

  Extended at that rate, a 4 MiB block is about 426 s, and a full 8 MiB body is about 1705 s. The helper is one Node process, so every review on the machine stalls for that long. Any script holding a review token can send it, and D11 says that is any script on any served page. The deep case also overflows the stack (`RangeError` at depth 8000). The route catches that as a 500, but only after the parse loop has finished. The layer runs the same function on stored records during replay (`runBlocksWritable`), so a forged storage record can hang the tab the same way.
- fix:
  - In `validateRun`, check `recordBytes` and `blocksBytes` first, then parse.
  - In `cleanBlock`, refuse nesting deeper than a small fixed limit. Only four inline tags and `li` exist, so a real block is a few levels deep. With a depth cap, the closing scan and the recursion are bounded too.
  - Test: a 1 MiB nested block is refused in well under a second, at the helper and in `cleanBlock` alone.

### 3. "Use the fixes" applies suggestions the reviewer never sees

- severity: important
- kind: risk
- where:
  - `src/layer/tab_done.js:634-643` (`proofreadOffer`)
  - `:2258-2290` (`paintProofread`)
  - `:2297-2304` (`answerProofread`)
  - `src/service/replies.js:431-440`
- what: The card shows the agent's `text` and two buttons. The `{block, from, to}` list that "Use the fixes" applies is never drawn. The browser test's own reply text is "One fix you may want." (`test/browser/agent_replies.spec.js:1711`).
- scenario:
  - The agent's prose says "fixed a typo". Its `suggestions` change "we will not" to "we will", or add a sentence. The reviewer presses the button.
  - `applySuggestions` makes a new revision in which those words are the reviewer's own `new_blocks`. They are classed as reviewer-written data, sent to the agent as "put them in the source", and checked as the reviewer's words.
  - The brief says the agent "changes the reviewer's words only when the reviewer says yes". Here the yes is to a description, not to the change.
  - D11 and D12 support reviewing a page someone else sent. A prompt injection on that page only has to steer the agent's suggestions to rewrite the reviewer's text, with the reviewer's approval attached.
  - Suggestions may also target `from_anchor` blocks, which hold the page's own words.
- fix:
  - Draw each suggestion on the card with `textContent`: the block's first words, `from`, and `to`. Draw them from the same list `proofreadOffer` applies, so what is shown is exactly what is applied.
  - Refuse suggestions on `from_anchor` blocks, both in `applySuggestions` and in `lahe reply --proofread`.
  - Test: the card lists every suggestion's `from` and `to`, and one whose `block` is `from_anchor` shows no "Use the fixes" button.

### 4. Proofread suggestions have no count or length bound

- severity: minor
- kind: risk
- where:
  - `src/shared/protocol.js:738` (`suggestionsProblem`)
  - `src/service/replies.js:436`
  - `src/layer/tab_done.js:639`
- what: A reply line's suggestions are checked for shape only. `lahe reply` checks that they apply, but an agent that writes the reply file by hand skips that check.
- scenario: A hand-written line with a very large `suggestions` list is folded into `events.jsonl` in full. The rail then runs `applySuggestions` over all of it on every paint of the card. The damage is limited to the agent's own review, but it is a stall on the reviewer's page.
- fix: In `suggestionsProblem`, cap the count at the item's block count times a small number. Cap `from` and `to` at `NEW_BLOCKS_MAX_BYTES`. Test it at the protocol level.

### 5. `lahe write`: hard links, and a gap between the check and the read

- severity: minor
- kind: defect
- where: `src/cli/commands/write.js:109-131`; `src/cli/commands/review.js:227` (`markdown.writeArtifact` reads by path)
- what:
  - `prepare()` accepts any regular file, including one with more than one hard link.
  - The render reads the file again by path afterwards and follows whatever is there by then.
- scenario: On a shared machine, `notes.md` can be a hard link to another file of the user's. A cloned repo cannot ship one. The agent is then asked to write the reviewer's notes into that file. Or a local process can swap `notes.md` for a symlink after the `lstat` and before the render, and the target is served and later written. Both need someone who can already write in that folder, so the risk is low.
- fix: Refuse `stat.nlink > 1`. Open the file once with `O_NOFOLLOW`, run `fstat` on that handle, and render from it. Test the hard link case.

### 6. The new one-page server has no Host check

- severity: minor
- kind: risk
- where: `src/service/static_servers.js:1162` (`servePage`) and the request handler at `:1196`
- what: The Host check is on the board (`LAHE-static-server-host-check`, `docs/BULLETIN.md:14` and `:26`) as older than this feature. `servePage` is new code, and it serves exactly the page SR4 was about: a reviewer's private notes, with the review token injected into them.
- scenario: A site using DNS rebinding finds the port and reads the notes page. The helper's own Host check stops the token from being used, but the notes are read.
- fix: In page mode, refuse any Host that is not the bound loopback address and port. It is a few lines, and it does not have to wait for the folder-server fix. Add a test that a wrong Host gets a 404.

### 7. The protect restore rebuilds a run from raw markup

- severity: minor
- kind: defect
- where: `src/layer/protect.js:716-722`
- what: After a repaint, the reviewer's run is put back with `anchorEl.innerHTML = first.html` and with `createElement(entry.tag)` plus `innerHTML`. Both come from a snapshot of the live page. This is the one page write in the run path that does not go through `blocks.writeBlock`.
- scenario: The snapshot is in memory and comes from the page itself, so today it can only return what a page script already put there. The risk is drift: it is a second rule for "how a run block reaches the page".
- fix: Rebuild each entry with `blocks.writeBlock(entry.tag, cleanMarkup(entry.html))`. The anchor falls back to `cleanMarkup` as in finding 1.

### 8. The projection trusts events it did not check

- severity: minor
- kind: risk
- where: `src/service/projection.js:79` (`recordFromEvent`)
- what: `validateRun` runs only on append. Events already in `events.jsonl` are folded as they are.
- scenario: A log line written before contract 14, or written straight into the owner-only log, is projected with any run fields it carries. The chance is low, because no layer before this feature wrote run fields.
- fix: Run `validateRun` in `recordFromEvent` and drop a failing record with a helper-log line. It is cheap once finding 2 bounds the parse.

## Cleanup needed

- The architecture's third board follow-up has no row: "`cleanMarkup`, used for anchor markup, is a deny-list that keeps `svg`, `img`, `a`, and similar tags." Finding 1's fix makes `cleanMarkup` the anchor's only guard, so the row matters more now. Add it to `docs/BULLETIN.md`.
- To delete at cleanup: the two measurement scripts in the scratchpad (`cb_dos.js`, `cb_dos2.js`). They are under `/private/tmp`, so the OS removes them and nothing needs doing.
