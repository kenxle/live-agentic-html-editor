# Review log: rb9f7c1db2dd2

**Pages reviewed:** /02_architecture_stable_addresses.html

**Items:** 2 total, 2 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **comment** · remove this section. this is no long an open question. it has become a changelog that i...
2. **note** · are you still going to be able to server documents like this one that are composed of o...

---

## 1. comment · Summary, div 1

`itm_9bd91feee547109ae7803663` · 

**Ken wrote:**

> remove this section. this is no long an open question. it has become a changelog that is fully documented elsewhere and does not need to be in the subagents context

**Pointing at:**

> One decision changed in review, and Ken confirmed it. Ken first chose .lahe as the printed ending. Both reviews found that a plain http://name.lahe page is not a "secure context" to the browser. That brings five costs:
>
> the address bar says "Not secure";
> copy buttons lose the clipboard API;
> the duplicate-tab guard (Web Locks) turns off;
> the browser stops sending the request headers the Library's checks and the redirect rule rely on;
> on any machine where Lahe does not own .lahe lookups, a hostile network could take over a name (DNS rebinding).
> .lahe.localhost has none of these. Ken agreed: lahe review prints .lahe.localhost, and .lahe is an opt-in, guarded alias. HTTPS for .lahe is a follow-up.

**Reply (handled):**

> Removed. The summary now just states the result: .lahe.localhost is printed, .lahe is an opt-in alias, and the address is :1483 or port-free with the forward (it still said :7817, now fixed). I also cleared the same kind of history from the other builder-facing pages: 'as Ken decided' and 'Ken confirms' notes, the dropped .lahe backup task, and its three not-applicable test rows. The resolved-decisions list in the brief and the rejected alternatives still keep the why.

---

## 2. note · (no anchor)

`itm_3999da18f53dfbaadce6ef4e` · 

**Ken wrote:**

> are you still going to be able to server documents like this one that are composed of other smaller documents?

**Reply (handled):**

> Yes, nothing changes for these. This page is one HTML file that the forge build script stitches together from the main .md and its parts/ files before Lahe ever sees it. Lahe serves the finished file, the same as today.
>
> The parts/ files sit inside this feature folder, so they are part of the same site: docs.features.20261011-02-stable-addresses.lahe.localhost/parts/architecture/recon.md opens from the link here, renders on request, and the rail rides along, as linked documents do today. The only change is the address at the top.

---
