---
title: A back-to-back benchmark of a polled route measures only the warm path
category: service
symptoms: [the cache is fast in the benchmark but the helper's processor time keeps climbing, ms per request looks fine but ps time per 10 minutes does not, V18 fails while the warm median passes, idle cost is five times the benchmark, a poll every 5 seconds costs more than the same request back to back, light when idle claim does not match ps, first read after start is slow and every spaced poll is slow too]
applies_to: ["src/service/summary.js", "src/service/index.js", "src/service/catalog_reader.js", "macos/menubar/**", "docs/features/*/03_plan_*.md"]
first_seen: 2026-10-13
confirmed: 2026-10-13
status: live
---

## What happens

A route that something polls on a fixed rhythm is benchmarked with requests sent
back to back, and the number looks fine: a few milliseconds a request, under the
budget. The doc records it as the idle cost. Then the real caller runs, one request
every 5 seconds all day, and the helper's `ps -o time=` climbs far faster than that
number allows.

The figures as they were written, for one route on a copy of a real state folder
of about 700 reviews:

| Measurement | Result |
| --- | --- |
| 50 requests back to back, median | 13.2 ms |
| The same request every 5 seconds, median | 27.5 ms |
| Processor time the helper spent per poll at the 5-second rhythm, idle rate subtracted | about 47 ms |
| Helper processor time over 10 idle minutes with the poller running | 6.31 s |
| Helper processor time over 10 idle minutes with the poller stopped | 0.67 s |

The doc had said 8 to 9 ms. The warm median was under the limit on the day the
processor-time budget failed by about seven times.

## Why

A back-to-back benchmark keeps the processor awake at full speed with its caches
and the file system's metadata warm, so it measures only the warm path. A poll that
lands after five idle seconds runs on a processor woken from idle, and pays that
wake-up on every stat and every pass over the reviews, so the cost scales with how
many files the poll touches and how many rows it loops over, not with how fast the
warm path is. The same route can be cheap by one measurement and expensive by the
other at the same time.

## What to do instead

**Measure at the rhythm the real caller uses, on real-shaped data, with the idle
rate subtracted.** The shape that worked:

1. A copy of the real state folder (not a made-up one; a synthetic folder has the
   wrong number of files and the wrong shape of them).
2. The helper started the way it runs in use (always-on, so its own beats run).
3. A window of idle minutes with the poller running and a window with it stopped,
   each long enough to hold many polls (10 minutes holds 120 polls at 5 seconds).
4. Processor time from `ps -o time=` on the helper and on the poller at the start
   and end of each window; the poller's cost is the difference between the two
   windows plus the poller's own time.
5. A budget that is itself a measured thing, such as one open review tab's
   renderer over the same window.

The verification row that states this method is V18 in
`docs/features/20261012.01_menu_bar_app/03_plan_menu_bar_app.md`, and the
measurement script is `scripts/measure.py` beside the walk notes it names.

**Keep the warm median as a second check, not the first.** It catches a slow
request path. It says nothing about the cost in use, so a pass on it alone is not a
pass on the budget.

**A control for the connection.** Poll an unauthenticated route that does nothing
(`/health`) at the same rhythm. Whatever that costs is the connection, not the
route, and only the remainder is yours to cut.

**When the number is high, count file work per poll, not milliseconds.** Profile at
the rhythm and look for stats and directory listings that run on every poll over
every review. The fix that held was to keep the answer in memory, let the event
log name the review the helper itself wrote to, and have an idle poll stat only the
files that can change without the helper knowing. The related trap, a permanent
state waking a poll loop on every round, is in
`docs/lessons/service/zero-work-waiting-means-both-finished-and-caught-up.md`.
