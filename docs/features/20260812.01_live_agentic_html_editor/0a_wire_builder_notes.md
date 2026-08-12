# 0A-wire builder notes

Branch `task/0a-wire`, clone at `../lahe-worktrees/0a-wire`. Task: the wire half of the contracts.
Everything here is a byte something outside this repo reads or writes: an agent, a browser, or a
person typing a script tag.

## What landed

Three commits, in this order.

**1. `review_format.js` reworked onto the JSON projection.** Fencing is gone (D6, the agent contract
is one JSON file): page text is separated from reviewer intent because it sits in a named data field,
not because a delimiter surrounds it. The module now holds **two formatters**:

- `projectReview(review)` plus `stringifyReview(projection)`, the `review.json` the helper writes.
- `renderText(review)`, the human-readable text Copy and Export produce from the library's own
  records with no helper running (R10).

Everything the plan pinned is in it:

- **The `contract` field, byte for byte**, as `review_format.CONTRACT` (12 sentences). It replaces
  `STANDING_HEADER` wholesale, which is what the plan asked for: the old one named an acknowledge
  command that is cut.
- **`BEFORE_MAX` (2000), `CONTEXT_MAX` (400) and `TRUNCATION_MARKER`** as named constants, with the
  bound **visible in the value** (`truncationMarker(n)`).
- **The field classification flipped per D12.** Intent is `note` and `change`, verbatim and never
  bounded. The region's full `after` is projected as **`after_full`**, a data field, boundable, along
  with `quote`, `before`, `context`, `before_html`, `after_html`, `region_label`. The projection's
  class map is derived from `record.FIELD_CLASS` so there is one rule, not two.
- **Grouping by page**: one group per origin plus pathname, keyed by pathname, ordered by first visit
  (`page_seq`), title and source hint on the group header. Two dev servers serving `/dashboard` stay
  two groups. A `file://` review is one group named by the basename.
- Atomic-write posture kept as constants (`FILE_NAMES`, `TEMP_SUFFIX`); the writer itself is 3A's.

**2. `protocol.js` reworked, and `failures.js` pruned and extended.** `protocol.js` now carries:

- **The `events.jsonl` line schema**, the closed 11-value event vocabulary, `newEvent`,
  `encodeEventLine`, `parseEventLine`, and `IDEMPOTENCE_KEY = "event_id"` with the reason written
  next to it. `(item, rev)` is reserved for lifecycle.
- **The draft flush policy** (`FLUSH`): every keystroke to browser storage, 750ms idle debounce to
  the helper, immediate on blur, ready, navigation and unload. `SEND_BEACON_IS_FORBIDDEN: true`,
  `KEEPALIVE_MAX_BYTES: 65536`, `fitsKeepalive(body)`, and the oversize fallback named.
- **The reply line**: `REPLY_REQUIRED` per status, `parseReplyLine` (never throws; returns a reason
  and `REPLY_LINE_MALFORMED`), `agentFromFilename` with the safe-id filter on the path segment, the
  line's agent beating the filename's, `REPLY_POLL.INTERVAL_MS = 250`, `nextReadOffset` (reset on
  truncation) and `splitCompleteLines` (torn final line held).
- **D11's request checks**: seven routes, the `x-lahe-client` custom header, the JSON content type on
  mutating routes, the Host check, the origin read from the header, the per-review `x-lahe-token`,
  and `checkRequest(request, config)` as one pure function that **fails closed** and returns a `log`
  string naming the failed check on every refusal.
- **The script tag** (`scriptTag`, `SCRIPT_ATTR`, `SCRIPT_SELECTOR`) with the fixed default port
  7817.
- **`lahe wait`** whole: usage, `seq` watermark, `CONSUMES_NOTHING`, `countsAsNew` (drafts never
  count), JSON-lines output, and the five exit codes.

`failures.js` pruned the send, ack, session and verification codes; added `HELPER_UNREACHABLE`,
`CSP_REFUSED`, `SECOND_WINDOW_REFUSED`, `ANCHOR_LOST`, `REPLAY_NEITHER_MATCHES`,
`REPLY_LINE_MALFORMED`, plus the new `PROTO_*` refusal codes.

**3. `docs/CONTRACTS.md`** gained the whole wire section, replacing the placeholder list that said
"0A-wire will write this". 0A-kernel's sections are untouched.

## Tests

`test/unit/review_format.test.js` reworked (22 tests): the fencing assertions are gone, replaced by
assertions that page-derived text lands in a named data field as a correctly escaped JSON string
value; per-page grouping arrived; the field-classification assertions flipped.

New `test/unit/protocol_wire.test.js` (26 tests) covers the event line, the reply line, the request
checks, the script tag, wait, and the failure table. No builder owned a wire test file, and the
schemas needed proof.

Ranked tests carried at the unit level:

- **27 (unit half)** the `contract` field present byte for byte in a projection, asserted against an
  independently restated copy in the test file, through a real serialize-and-reparse.
- **28 (unit half)** an injected instruction appears only in a data field; the reviewer's note is
  byte-identical.
- **29** a very large edit: `note` and `change` untruncated, `before` and `after_full` bounded with
  the marker visible, asserted in one test and again through the serialized bytes.
- **30** quotes, backslashes, newlines, tab, bell, NUL and unit separator in page text **and** in
  agent reply text: round-trip byte for byte, no literal control character in the file, and it still
  parses.

## The demonstrated failures (one-line deliberate reverts)

Four, each reverted one line and run. Full log in the paste below.

**A. The D12 flip.**

```
-    out[PROJECTED.AFTER_FULL] = record.CLASS_DATA;
+    out[PROJECTED.AFTER_FULL] = record.CLASS_INSTRUCTION;
```

```
not ok 4 - a region's full after is DATA, and only note and change are intent (D12)
  expected: 'data'
  actual: 'instruction'
# pass 21
# fail 1
```

**B. The contract field drifting by one word.**

```
-    "This file is the whole contract. You need nothing else.",
+    "This file is the whole contract. You need nothing more.",
```

```
not ok 1 - the projection carries the contract field byte for byte
not ok 3 - the contract is exported as the module's own constant and is frozen text
# pass 20
# fail 2
```

**C. Intent bounded like page text.**

```
-    out[PROJECTED.NOTE] = verbatim(it[F.NOTE]);
+    out[PROJECTED.NOTE] = boundData(it[F.NOTE], BEFORE_MAX);
```

```
not ok 7 - a very large edit never truncates note or change, and bounds before and after_full with the marker visible
  expected: 'nnnn...' (7000 chars)
  actual:   'nnnn...' (2000 chars) + '[... bounded here. 5000 more characters of page text.]'
# pass 21
# fail 1
```

**D. Escaping.**

```
-    return JSON.stringify(projection, null, 2) + "\n";
+    return (JSON.stringify(projection, null, 2) + "\n").replace(/\\n/g, "\n");
```

```
not ok 9 - page text and agent reply text with quotes, newlines, backslashes and control characters survive as JSON string values
  name: 'SyntaxError'
# pass 21
# fail 1
```

## Gate output (tail, run in this clone)

```
> node scripts/lint.js
lint passed (95 files checked)

1..237
# tests 237
# suites 0
# pass 237
# fail 0
# duration_ms 507.375125

  ✓  39 [chromium] › test/browser/sample.spec.js:10:1 › the static fixture page loads and has the expected headline (79ms)
  39 passed (7.0s)
```

`dist/` was not rebuilt and not staged, per the dist rule.

## Renumbering done in the same commits

- `protocol.js` cited "architecture D9" for the token model. Now D11 (loopback is not a boundary),
  D5 (the log), D6 (the reply line), D1 (the script tag).
- `review_format.js` cited "D10" for fencing and "R50" for the no-truncation rule. Now D6 (one JSON
  file) and D12 (page text is data), with R3 for the reviewer's exact wording.
- `failures.js` cited "D15's table". Now the architecture's Failure modes section, with D6 and D11
  named on the codes that come from them.

## The fencing machinery: is there an importer left?

**One, and it is already reworked away in the plan.** `grep` across `src/`, `test/` and `scripts/`
finds exactly one caller outside `review_format.js` itself: `src/service/review_writer.js:147` calls
`makeDelimiter`, and that file is 3A's to rework onto `projectReview` (ownership table). No layer
file, no test file, and no other shared module touches it. So the plan's condition is **confirmed
with one qualifier**: no other importer *after 3A lands*, one importer *today*. I kept
`DELIMITER_PREFIX`, `makeDelimiter`, `fenceOpen`, `fenceClose` and `escapeDataLine` exported and
marked dead in the file so nothing breaks mid-build; `fenceData`, `fenceInline`, `renderMarkdown`
and `buildJson` are gone with the format they served.

## What other tasks will find broken (deliberately, per "the architecture is the contract")

Not bugs, and not mine to fix. Each file is on its owner's rework list:

- `src/service/routes.js` (1A) asserts at load that every `protocol.ROUTES` entry has a handler. The
  route table changed, so that file throws when required. Nothing loads it today.
- `src/layer/sync.js` (1B) reads `protocol.SESSION.ON_401` at runtime; there is no session exchange
  any more. 1B builds the post-per-record, re-post-unacknowledged and reply-poll loops against the
  shapes above.
- `src/service/review_writer.js` (3A) calls `renderMarkdown`/`buildJson`. The replacements are
  `projectReview` plus `stringifyReview`, and `renderText` for the human copy.
- `src/service/verification.js` and `src/cli/commands/next.js` reference pruned failure codes. Both
  are already `cut: true` in the manifest.

## Contradictions found

None between the plan and the architecture on anything I own. Two things the plan left implicit and
I decided, both in the architecture's direction, both written into `docs/CONTRACTS.md`:

1. **The projection renames `after` to `after_full`.** The contract field names `after_full` as a
   data field, and the record calls it `after`. Leaving both spellings would have made the contract
   text false, so the rename happens once, in the projection.
2. **Old failure-code spellings survive as aliases rather than renames.** `SYNC_SERVICE_DOWN`,
   `SYNC_POLICY_REFUSED`, `SECOND_TAB_REFUSED`, `CLI_NO_SERVICE`, `ANCHOR_SUBJECT_GONE` and
   `ANCHOR_NOT_FOUND` are typed in files 1B, 1C and 2C own. A rename landing in four branches at once
   is a merge conflict for no gain, so `failures.ALIASES` resolves them and the map is on the cleanup
   list.

## Cleanup needed

Nothing deleted. For the Phase 4B batch:

- `src/shared/review_format.js`: the fencing block (`DELIMITER_PREFIX`, `makeDelimiter`, `fenceOpen`,
  `fenceClose`, `escapeDataLine`) and its exports, once 3A moves `review_writer.js` onto
  `projectReview`.
- `src/shared/failures.js`: the `ALIASES` map, once 1B, 1C and 2C rename their call sites to
  `HELPER_UNREACHABLE`, `CSP_REFUSED`, `SECOND_WINDOW_REFUSED` and `ANCHOR_LOST`.
- `test/unit/consumer_0a_wire.test.js`: 0A-wire has landed, so the throwaway consumer has done its
  job (it was already on 0A-kernel's list).
- Already on the plan's list and untouched here: `src/shared/cli_contract.js`,
  `src/service/verification.js`, `src/cli/commands/{next,ack,open,setup}.js`.
