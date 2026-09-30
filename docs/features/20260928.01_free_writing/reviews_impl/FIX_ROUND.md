# Fix round: who fixes what

One fix round covers every finding in this folder's six reviews:
- code_reviewer.md (CR)
- codex.md (CX)
- code_lead.md (CL)
- security.md (SR)
- testing.md (T)
- adversary.md (ADV)

Each builder owns the files listed for its group. A builder that needs another group's file says so in one line to the orchestrator; it does not edit it.

## Design calls the orchestrator made

1. **An anchor the reviewer never changed is not compared (ADV 2).** When a record's anchor words and tag are unchanged (the sitting only added blocks), replay finds the anchor, counts it as applied whatever its words now are, and places the run after it. No conflict card, no "Keep mine" over the agent's fix.
2. **The empty-page session opens only on a notes review (CR 1).** It needs the notes flag carried to the layer. Any other empty page stays in reading state.
3. **Once a session adds a block, it stays run-shaped (CR 2, CL 1).** Committing clears nothing by accident. If the reviewer removes every new block and restores the tag, the record commits with the run fields cleared explicitly.
4. **A take-back carries the old tag (CR 3, CL 2).** The change text says to change the block back. Replay's tag check acts on it. The helper checks a take-back of placed blocks: the listed blocks must be gone from the built page (ADV 3).
5. **Undo on a ready item the agent already acted on (ADV 1).** If the item has any agent reply (a question, a proofread, "Use the fixes"), undo raises a take-back like a handled item, never a silent drop.
6. **"Use the fixes" (SR 3, ADV 4, CL 4).** The card lists each fix, as from and to. Fixes to `from_anchor` blocks are refused. The new revision clears `proofread`. The contract tells the agent to replace the old words with the fixed words. `review.json` carries the suggestions, so the agent never has to find old words in history that was cut short.
7. **`lahe review` on a notes file (ADV 5)** uses the same one-page server as `lahe write`. The notes flag wins.
8. **Drain size (ADV 6).** A run's words appear at most twice on a drain line. `review.json` keeps what old agents read.
9. **The layer refuses an older helper (CR 4, CL 24, T I7).** It reads `service_contract` from health and goes read-only with the failure shown, as the architecture says.

## Groups

| Group | Model | Owns | Findings |
|---|---|---|---|
| F1 editing | opus | editing.js, protect.js, anchor.js, highlight.js, lifecycle.js, their tests | CR 1 (layer side), 2, 5; CX P2; CL 1, 6, 11, 13 (only where it fixes a bug; no large refactor), 14, 15; SR 7; ADV 1; design calls 2, 3, 5 |
| F2 replay | opus | replay.js, normalize.js, blocks.js, their tests | CL 3, 8, 9, 10, 12, 18, 19; SR 1 (page-write fallback), SR 2 (cleanBlock cost: sizes first, nesting cap); CR 3 (replay tag leg); ADV 2; design calls 1, 4 (replay side) |
| F3 shared, service, CLI, contract | opus | src/shared/ except normalize.js and lifecycle.js, src/service/, src/cli/, sync.js, index.js, the contract and every copy (skills/lahe/SKILL.md, docs/CONTRACTS.md, test/unit/review_format.test.js), docs/CLI.md | CR 3 (record side), 4; CL 2 (record side), 4, 5, 7, 16, 17, 20, 23, 24, 25; SR 1 (helper checks anchor_after_html and after_html), 2 (validateRun order), 4, 5, 6, 8; ADV 3, 4, 5, 6; design calls 2 (flag to layer), 4, 6, 7, 8, 9 |
| F4 rail and tests | sonnet | tab_done.js, tab_edits.js, overlay.js, test/browser/free_writing_*.spec.js, seams support files, test fixtures | SR 3 (card lists each fix); CL 21, 22; T I1 to I16, as each test's fix; design call 6 (card side) |

Where a finding spans two groups, each builder does its own side against the shape named here.

**Test tier for every builder:**
- `npm run gate:unit`.
- The specs it touches, by name, in Chromium.
- Never the full suite.

Each builder:
- adds a red-then-green test for every finding it fixes
- writes `progress/phase7_fix_<group>.md`
- lists each finding id with fixed, rejected (with a reason), or needs-other-group
