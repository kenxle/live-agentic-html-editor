# Event log fixtures: real in shape, fake in content

Five `events.jsonl` files for `test/unit/projection_incremental.test.js`, which
proves that folding a log in pieces lands on the same `review.json` bytes as
folding it from the top.

They started as real logs out of a live state directory, because the fold keeps
state across event boundaries and a hand-written sequence is a guess about which
boundaries matter. They are not real any more:
`scripts/scrub-log-fixtures.js` replaced every word, path, origin, token and
agent name with a deterministic fake. That script is the process, so the next
person can redo it instead of trusting this file.

## Why each one is here

| File | Bytes before | Bytes after | Events | Why |
| --- | --- | --- | --- | --- |
| `r9de3b2a18cd4.events.jsonl` | 19,483,436 | 19,020,994 | 5,403 | the largest log under the 20 MB cap |
| `r9dcf69be6afc.events.jsonl` | 15,180,258 | 14,966,190 | 5,241 | the most replies (66) and by far the most rewording (255 `item.ready`, 10 items past rev 1) |
| `ra34b8e0e4d5a.events.jsonl` | 2,781,184 | 2,721,622 | 1,175 | 60 replies in a short log, and the only `item.deleted` |
| `r0fce850a67da.events.jsonl` | 931,402 | 916,318 | 283 | the only small log carrying an `item.reopened` |
| `r28b63eabad87.events.jsonl` | 56,635 | 55,783 | 46 | tiny, and carries `review.archived`, so `ended_at` is folded |

Across the five, counted by the script rather than by eye: 12,148 events, 221
items, 226 folded replies, 15 items the reviewer reworded past revision 1, and
every event type in the vocabulary except `reply.rejected`.

The largest log on the machine these came from is 88,298,746 bytes. It is not
here: the builder brief caps a fixture at 20 MB, so the largest under that cap
went in instead.

The files are a little SMALLER after scrubbing even though every string keeps
its length, because the originals carried quotes, newlines and non-ASCII
characters that JSON escapes and lorem does not.

## What the scrub kept, and why

The fold reads all of this, so all of it survives byte for byte:

- the order of the lines, and every `seq` and `ts`
- every event type, item id, revision, review id and `page_seq`
- every lifecycle field: `state`, `status`, `kind`, `accepted`, `draft`, and the
  shape of `reply`
- the LENGTH of every piece of text, because `src/shared/review_format.js`
  bounds page-derived text at a maximum and a shorter fake would not be bounded
- the LENGTH of `thread` and `after_history`, because the fold's continuation
  rule compares them

Replaced: every prose field, with a deterministic slice of a lorem corpus of
exactly the same length; every path, with `dir-N/page-N.ext`; every origin, with
`http://127.0.0.1:4NNN`, one per distinct original; the review token and the
agent session id, with obvious dummies; the agent's name, with `agent`.

Equal inputs map to equal outputs, so two fields that matched before still
match and page grouping is unchanged.

## What holds the line

`shape.json` is written by the same script, which computes the census over the
real log AND over its scrubbed copy and refuses to finish if the two differ.
Three tests then keep it true without the real logs being anywhere near this
repository:

- **the scrubbed fixtures still fold every branch the real logs did**: the
  committed files still match `shape.json`, down to the max revision of every
  individual item and the length of every `thread` and `after_history` array.
- **every prose field is a placeholder**: each one has to BE a slice of the
  lorem corpus, which nothing a person wrote can be. This is stronger than a
  list of banned words, with one honest gap: a one-character or two-character
  string can be a lorem slice by accident, so the check cannot speak for those.
  They carry nothing.
- **the bytes carry no address, url, secret or name**: no `@`, no URL other
  than the minted loopback origins, no hex run of 32 characters or more, no
  home-directory or Windows path, and no spelling of Ken's name.

## Regenerating

From a machine that has the real logs:

```
node scripts/scrub-log-fixtures.js
```

It reads `LAHE_STATE_DIR` (or `~/.local/state/lahe`) and rewrites this folder.
It fails, loudly, if a log carries a field its table does not name, so a new
field cannot leak by going unrecognised.
