# Name another file as a link: progress

**Needs you:** one call, on [how agents wait for your comments](#waiting-for-comments-what-worked-and-what-goes-wrong). Pick one:

- **A. Docs only.** Rewrite the Claude Code part of the skill around the one call that worked, fix the false line about timeouts, and add the rule "reply to every item before you relaunch". Same rule in the contract.
- **B. Docs plus a small code fix.** A, plus make the watcher wait instead of exiting at once when the only unanswered items are ones it already printed to this agent. That ends the loop even when an agent forgets the rule.

I recommend B. The rule in A is the kind of prose that has failed before, and the loop costs a turn each time it fires.

## Waiting for comments: what worked, and what goes wrong

### What worked this morning

One Bash call, nothing else:

- command: `lahe monitor --session s_127a0857d117204f`
- `run_in_background: true`
- `timeout: 7200000`

It ran 11.17 hours, from 09:53 to 21:03, and woke once: when your "merge it" note landed. No re-arming, no timer, no tail of a file, no `/loop`.

The skill says "a background command ends at its timeout, and every timeout is a relaunch." That run says otherwise: a 2 hour timeout, and it lived 11 hours. (Your settings also set `BASH_MAX_TIMEOUT_MS` to 24 hours.) That false line tells agents to expect a relaunch on a schedule, so it goes.

### What the other agents did

I read the last four days of Claude Code transcripts on this machine. The script is `monitor_calls.py`, `monitor_gaps.py` and `hook_after_launch.py` in this session's scratch folder.

- **The call itself is mostly right.** There were 1,042 background launches of `lahe monitor`. 1,034 are the bare command, the same shape as mine. The other 8 wrapped it in a `cd` or a `&&` chain.
- **Busy sessions relaunch a lot, and that is fine.** In the busiest one, each relaunch came right after you made another edit. One comment, one wake, one relaunch.
- **The waste is a loop.** The Stop hook said "nothing is watching" 109 times, and 99 of those came within a minute of a launch.

### Why the loop happens

A watcher that starts while any item is still unanswered prints that item and exits at once. The agent relaunches it, it exits again, and the Stop hook fires because the watcher it was just told to start is already gone.

This happened to me tonight. Your "merge it" note stayed unanswered while I waited for GitHub's checks, and two launches in a row died immediately. This morning the run held all day because nothing was waiting: every item had a reply before I launched it.

## The link rule (shipping now)

Agents writing documents for you named other files as bare text. The [PDF button spec](../20261008.01_pdf_button/01_spec_pdf_button.md) ended its summary with "the options weighed are in `00_decision_pdf_button.md`". You read the rendered page, so that name was a dead end.

Lahe already turns a relative link into a page you can open, rail included. So the fix is an instruction: when a document mentions another file the reader may want to open, write it as a link with a path relative to the document. It lives in:

- the lahe skill, [SKILL.md](../../../skills/lahe/SKILL.md)
- the review contract, [review_format.js](../../../src/shared/review_format.js), with its copies in [CONTRACTS.md](../../CONTRACTS.md) and [review_format.test.js](../../../test/unit/review_format.test.js)
- your global CLAUDE.md, under "Anything you want Ken to read goes in a LAHE document"

## Progress

- **Link rule:** [PR #42](https://github.com/kenxle/live-agentic-html-editor/pull/42) is open. You said merge it. The first CI run failed one browser spec out of 844 (`static_site_folder.spec.js`, a start that died at once). Main's last run also fails one spec, a different one. That spec passes locally on this branch, 4 of 4. I am rerunning only the failed job, and I will merge when it is green.
- **Unit gate:** 2,438 passed, 0 failed.
- **Not touched:** the PDF spec's summary sentence. It can ride in this branch if you want it.
