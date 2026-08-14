# fix-clidocs: the CLI and docs gaps from the cold-install walk

Branch `task/fix-clidocs`. The gaps come from the 2026-08-14 cold-install walk, in
which a fresh agent followed only the public playbook (`AGENTS.md`) and reported
what it could not do.

One commit per gap. Every command below was really run; the output is pasted, not
described.

---

## G1 (blocking): `add` never printed the review folder

Both docs promised it and neither the output nor `AGENTS.md` had it, so an agent
following only the playbook could not find `review.json` at all: the state
directory is derived from environment `add` resolved and the agent did not.

Two halves, both fixed:

- `add` prints a `folder` line carrying `<state-dir>/reviews/<review-id>`.
- `AGENTS.md` Step 3 states the resolution order, read off
  `src/service/state_dir.js`: `$LAHE_STATE_DIR`, then `$XDG_STATE_HOME/lahe`,
  then `~/.local/state/lahe`.

A real run:

```
$ node bin/lahe.js add $D/page.html --port 7831 --state-dir $S
lahe add: /var/folders/5g/.../T/tmp.pR3hPG7ldZ/page.html

  review    r7f647c748e71  (minted just now)
  folder    /var/folders/5g/.../T/tmp.emyTgxvGbA/state/reviews/r7f647c748e71
  library   /Users/kennethstclair/.../fix-clidocs/dist/lahe-layer.js
  helper    http://127.0.0.1:7831  (started just now)
  origin    null (a page opened from disk sends no origin, on every browser)

  The script line is in page.html, just before </body>.
  The script line points at the built library in this clone.

  A per-review token is in page.html.
  A token inside a repository can be committed and shared with everyone who reads the file.
  It opens this one review's feedback and nothing else: not your machine, not another review.

  Open it:  file:///var/folders/5g/.../T/tmp.pR3hPG7ldZ/page.html
```

Tests: `add prints the review folder...` (the printed path is the folder that
really exists) and `AGENTS.md says where the state directory is...`.

---

## G2: any add that minted a new review restarted a running helper

The old third step stopped and started the helper whenever it had to write, and
said "(restarted, so it knows this review)". That helper may be holding somebody
else's live review, so the restart was the wrong price for a second page.

**The helper now learns a new review from disk, with no restart.**

- `src/service/reviews.js` gained `ensureKnown(reviewId)`. It is free when the
  review is already held. When it is not, it looks on disk ONCE for that review's
  `meta.json`, through state_dir's own rules: a safe id, resolved inside the
  state root, no symlink at any level, and the folder must be owner-only (POSIX;
  Windows does not carry the bits). It reads `meta.json` and nothing else, and it
  deliberately does NOT run the log recovery path: recovery is a loud startup act
  and an unauthenticated request must not be able to drive it.
- The look is triggered by a request that has proved nothing yet (the token check
  cannot run for a review with no token), so it is bounded on both axes: one look
  per unknown id per 3s, and at most 64 ids remembered with the oldest evicted, so
  hammering invented ids cannot grow the map or walk the directory.
- `src/service/auth.js` calls `reviews.ensureKnown(req.review)` once, before
  `protocol.checkRequest`. Nothing else in the check block changed; the token and
  origin checks still decide every request.
- Learning a review rewrites `service.json`, because that file is how `lahe wait`
  and anything else on the machine finds a review's token. Leaving it stale would
  be a quiet lie.
- `src/cli/commands/add.js` now writes the review beside the running helper when
  the helper does not already hold it (nothing else is appending to that review's
  `events.jsonl`, so there is no seq to collide on), then asks the helper for it
  over `review.read`. A 200 is the helper having learned it. A restart is the
  FALLBACK only, and the reason is printed.

A real run, two pages against one helper, watching the pid:

```
$ node bin/lahe.js add $D/one.html --port 7841 --state-dir $S
  review    re582267b7f90  (minted just now)
  helper    http://127.0.0.1:7841  (started just now)
helper pid after first add: 65997

$ node bin/lahe.js add $D/two.html --port 7841 --state-dir $S
lahe add: /var/folders/5g/.../T/tmp.CrfqAoMNBv/two.html

  review    r59f89be79ca3  (minted just now)
  folder    /var/folders/5g/.../T/tmp.xZ8L7Kk8tY/state/reviews/r59f89be79ca3
  library   /Users/kennethstclair/.../fix-clidocs/dist/lahe-layer.js
  helper    http://127.0.0.1:7841  (already running, and it picked this review up without a restart)
  origin    null (a page opened from disk sends no origin, on every browser)
  ...
helper pid after second add: 65997
SAME PROCESS: yes
```

And the new review is immediately reachable by an agent, which is the point of
rewriting `service.json`:

```
$ node bin/lahe.js wait --review r59f89be79ca3 --timeout 0 --state-dir $S
{"cursor":2,"items":0}
```

The fallback is real, not theoretical. Running the new `add` against a helper
that was started by the OLD code (which has no `ensureKnown`) took the fallback
and said why:

```
  helper    http://127.0.0.1:7831  (restarted, so it knows this review)
  ...
  The helper that was already running did not pick this review up from disk, so it was started again.
  The helper was already running and was started again so it holds this review.
  Nothing was lost: the log is append-only, tokens survive a restart, and any page still
  open re-posts what it was holding as soon as it reconnects.
```

Tests:

- `a second review on a running helper works without the user restarting anything`
  now asserts the pid in `service.json` is UNCHANGED and that the output does not
  claim a restart.
- `a review minted after the helper started is learned from disk, and a bogus one
  still is not`: the learned token is the minted one, `service.json` picks it up,
  and an id with nothing on disk (and an unsafe id) still gets nothing.
- `hammering unknown review ids does not rescan the disk every time`: the review
  appears on disk BETWEEN two asks, and fifty asks inside the interval all still
  answer nothing; one interval later, one look, which finds it.

---

## G3: `--port` and `--state-dir` were undocumented for agents

`AGENTS.md` gained a short `Running isolated` section under Step 2: both flags
exist on `add` and `serve`, both default to one port and one state directory per
machine, so two agents on one machine share a helper and a history unless they
say otherwise. It also states the two constraints that bite: the port is baked
into the page's script line, and the state directory must sit outside any
checkout because it holds the token.

---

## G4: `lahe wait` had no `--state-dir`

`add` and `serve` both took it; `wait` only read `$LAHE_STATE_DIR`, documented
under other commands. It now takes the flag, and a typed path runs through the
same in-checkout refusal `add` and `serve` apply.

```
$ node bin/lahe.js wait --help
usage: lahe wait --review <id> [--since <cursor>] [--timeout <seconds>]

  --review <id>        the review to wait on. Required
  --since <cursor>     the cursor the last run printed. Default 0, the whole review
  --timeout <seconds>  how long to block. Default 300
  --helper <origin>    the helper's origin. Default: read from the helper's state directory
  --token <token>      the review's token. Default: read from the helper's state directory
  --state-dir <path>   where the helper keeps its data, the same flag `add` and `serve` take.
                       Default $LAHE_STATE_DIR, then $XDG_STATE_HOME/lahe, then ~/.local/state/lahe.
```

Test: `--state-dir points wait at a helper somewhere other than the default`,
which passes no `stateDir` option at all, so the flag is the only thing that can
find the helper and the review's token.

---

## G8: no uninstall story anywhere

Implemented rather than described: `lahe add <file> --remove` deletes the one
script line and nothing else. The match is the same attribute-keyed one `add`
writes with, so only a tag `add` put there can be removed. Removal runs before
the bundle check, so uninstalling never depends on the library being built, and
it touches neither the helper nor the state directory.

```
$ node bin/lahe.js add $D/p.html --remove
lahe add --remove: /var/folders/5g/.../T/tmp.i73K3JUhcU/p.html

  Took out the script line for review re7eac1f22690, and nothing else.
  That review's history is still in /Users/kennethstclair/.local/state/lahe/reviews.
  Stop the helper and delete that directory to forget it. See `Removing it` in the README.

$ diff before.html p.html && echo yes
yes

$ node bin/lahe.js add $D/p.html --remove
lahe add --remove: /var/folders/5g/.../T/tmp.i73K3JUhcU/p.html carries no lahe script line. Nothing to take out.
```

The README gained a `Removing it` section splitting the three things that come
apart (the page, the helper, the reviews) and `AGENTS.md` gained a Step 5 with
the one-liner. Tests cover the round trip (the page is byte for byte what it was
before `add` touched it) and that a page with two other `<script>` tags keeps
both.

---

## G6 (soft): `npm link`

One sentence in the README's `Without installing` section: `npm link` may need a
writable npm prefix or `sudo` on some machines, and `node bin/lahe.js ...` is the
answer that always works.

---

## HINT GAP: no change needed

The walker's rail-hint audit said the edit bar carries no finish hint. It does.
`src/layer/editing.js` defines `HINT_FINISH = "Esc to finish"` and appends it to
every edit bar as a `lahe-edit-bar__hint` span, in the bar's quiet register (half
alpha in both schemes). `test/browser/editing_two_regions.spec.js:179` already
asserts the visible bar label contains it. Nothing was changed here; recording the
verification so the next reader does not go looking again.

---

## Gate

`npm run gate:builder`, synchronously, on Node 20.19.0:

```
lint passed (syntax: 147 files, no jsdom, manifest complete)
# tests 369
# pass 369
# fail 0
# skipped 0
  154 passed (32.8s)
```

## Cleanup needed

Nothing in the repo. Outside it, from the runs pasted above:

- helper processes still listening on 127.0.0.1:7831, :7841 and :7842 (stopped at
  the end of this session; listed in case any survived)
- throwaway pages and state directories under the OS temp directory
  (`/var/folders/.../T/tmp.*`), which every test in this suite also leaves behind
  by design
