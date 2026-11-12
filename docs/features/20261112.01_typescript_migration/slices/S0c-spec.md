---
read-when: Building, reviewing or testing slice S0c's pilot, the rebuild of src/shared/elapsed.js as src/domain/elapsed.ts.
---

# S0c spec: the elapsed phrase, rebuilt as `src/domain/elapsed.ts`

The elapsed phrase is how Lahe tells a person how long something has been going on, in words: "for the last 4 minutes". The server says it in the refusal it sends a second window, and the rail says it again on the chip it draws for that refusal. This module is the one place that wording lives. It reads a time and returns a phrase; it touches nothing.

Old file: `src/shared/elapsed.js` (64 lines: 32 comment lines, 4 blank, 28 code, counted with `count_lines.py` as in S0b). Both sides run it: Node through `require`, the browser through the layer bundle.

This is the browser pilot. Its other job is to prove that a converted module reaches all three places it runs: Node, the review-layer bundle and a real browser.

## Who calls it, and what they rely on

| Caller | Runs in | Uses | Relies on |
| --- | --- | --- | --- |
| `src/service/reviews.js` (`heldForPhrase`) | Node | `elapsedPhrase(startedAt, { now: clock() })`, with epoch milliseconds or an ISO string | the phrase goes into the second-window refusal's detail, which the rail shows as a chip |
| `src/layer/store.js` (`describeHolder`) | browser and Node | `elapsedPhrase(holder.since)`, an ISO string from the wire, with the real clock | the phrase ends the chip text: "the window on docs/report.html, open for the last 4 minutes" |
| `src/shared/contracts.js` | Node | re-exports the module as `elapsed` | nothing beyond the export existing |
| `test/unit/page_scope.test.js` | Node | `elapsedPhrase` directly, and through `store.describeHolder` | the same phrases |

In the browser, `store.js` reads the module off `window.LAHE.elapsed` when it loads, so the module must be registered there, under that name, before `store.js` runs. Nothing writes to the module's exports, and nothing reads `RECENT_MINUTES_MAX`.

## Behavior

Each statement is something a caller, or a person reading a chip, can observe. The new tests check these.

1. `elapsedPhrase(since, options)` takes the start as an ISO string, epoch milliseconds or a `Date`, and returns a phrase that follows a verb, as in "open for the last 4 minutes".
2. The elapsed time is counted in whole seconds, rounded to the nearest. Under 60 seconds the phrase is `"for less than a minute"`.
3. A start in the future counts as no time at all, so it also reads `"for less than a minute"`.
4. From 60 seconds up to, but not including, 90 minutes, the phrase is `"for the last N minutes"`, where N is the elapsed seconds divided by 60 and rounded to the nearest whole number. When N is 1 it says `"for the last 1 minute"`, singular. So 89 minutes and 59 seconds reads "for the last 90 minutes".
5. From 90 minutes on, the phrase is `"since "` followed by the start as a local date and time, the runtime's `toLocaleString()`. It is never the ISO form a machine writes.
6. A start that is not a readable time is echoed, not guessed at: `"since "` followed by the value as given.
7. `options.now` sets the clock in epoch milliseconds. Without it, the clock is the current time.
8. The module is reachable from all three places the code runs:
   - in Node, from `require("src/shared/elapsed.js")`, the old path, and from an ES module import of `src/domain/elapsed.ts`;
   - in the review-layer bundle, as `window.LAHE.elapsed`, registered before `store.js` loads, so the rail's chip reads the same words as the server's refusal;
   - in a real browser, through the bundle `npm run build:layer` writes.

## Module design

One module, `src/domain/elapsed.ts`. It belongs in `domain` because the server and the browser both run it and must agree on its words, and it imports nothing.

```ts
export type ElapsedStart = string | number | Date;

export interface ElapsedOptions {
  readonly now?: number;
}

export function elapsedPhrase(since: ElapsedStart, options?: ElapsedOptions): string;
```

- The thresholds are module constants, not exports. No caller reads them.
- The three kinds of phrase are three branches on the elapsed seconds, with no shared mutable state.
- The old path keeps a one-line forwarder, `module.exports = require("../domain/elapsed.ts")`, listed in `FORWARDERS`, so `reviews.js`, `store.js`'s Node branch, `contracts.js` and the tests keep working unchanged.
- The manifest's `LAYER_FILES` entry at the same position becomes `src/domain/elapsed.ts` with `registers: ["elapsed"]`, so the bundle registers the module where the old file registered itself.

## Old tests, accounted for

There was no test file for `elapsed.js` alone. Its cases lived in `test/unit/page_scope.test.js`, with the tests of `record.samePage`. The new tests are in `test/unit/domain/elapsed.test.ts`.

| Old case | Carried to | Behavior |
| --- | --- | --- |
| recent times read as a span, older ones as a date, and it never prints an ISO string | moved to `elapsed.test.ts` | 2, 4, 5, 7 |
| an unreadable value is echoed rather than guessed at | moved to `elapsed.test.ts` | 6 |
| the helper's refusal and the rail's chip say the same words | stays in `page_scope.test.js`: it tests `store.describeHolder`, and now also proves the old Node path through the forwarder | 7, 8 |
| the refusal still names the window when the holder is served at the root | stays in `page_scope.test.js`: it tests `store.describeHolder` | 8 |

The two moved cases are removed from `page_scope.test.js`, and every assertion in them has a counterpart in the new file. Nothing is dropped.

New cases with no old counterpart: the rounding at the one-minute edge (2, 4), a future start (3), the last minute before the date form and the first minute of it (4, 5), a start as epoch milliseconds and as a `Date` (1), the real clock (7), and the ES module import and the forwarder returning the same function (8).

The browser half of statement 8 is a new spec, `test/browser/bundle_registration.spec.js`, which loads the in-memory bundle and checks the rail's chip text through `store.describeHolder`.

## Deliberate differences

- `RECENT_MINUTES_MAX` is no longer exported. No caller read it.
- In Node, the old path now returns an ES module namespace (read-only) instead of a plain object. No caller writes to it.

Neither is something a person or an agent can observe. No behavior statement above differs from the old code.

## Fixed behavior tests that touch this slice

- `test/unit/page_scope.test.js`, the two `describeHolder` cases: the chip text, unchanged.
- `test/unit/review_write_hardening.test.js` and the second-window refusal tests: the server's phrase, through the forwarder.
- `test/browser/rail_chips.spec.js` and `test/browser/reload_claim.spec.js`: chip wording. They run at the checkpoint.
