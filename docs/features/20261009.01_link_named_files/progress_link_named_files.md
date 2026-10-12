# Name another file as a link: progress

**Needs you:** nothing right now.

## Waiting for comments: what worked, and what goes wrong

### What worked this morning

One Bash call, nothing else:

- command: `lahe monitor --session s_127a0857d117204f`
- `run_in_background: true`
- `timeout: 7200000`

It ran 11.17 hours, from 09:53 to 21:03, and woke once: when your "merge it" note landed. No re-arming, no timer, no tail of a file, no `/loop`.

The skill says "a background command ends at its timeout, and every timeout is a relaunch." That was true only from Claude Code 2.1.285 to 2.1.287. Since [2.1.288](https://code.claude.com/docs/en/changelog), an interactive session (terminal, desktop app, VS Code) has [no time limit on background commands](https://code.claude.com/docs/en/tools-reference#time-limit-for-background-commands). The limit applies only to unattended runs: `-p`, the Agent SDK, CI and cloud. That is the "it was deprecated" agents keep citing. The old line tells agents to expect a relaunch on a schedule, so it goes.

The one other thing that ends a quiet watcher is the memory killer. Since 2.1.274 it acts only when memory is critically low and the session has been idle for 30 minutes.

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

- **CI is fast now:** decided. GitHub runs lint, the bundle check and the unit tests, with no install step. That proves a fresh clone works on Linux. The browser suite runs locally before a PR and again on main after a merge, and the PR body states the local counts. `CLAUDE.md` says so. This makes the repeat-run-after-merge question moot.

- **Watcher code fix:** merged as [PR #46](https://github.com/kenxle/live-agentic-html-editor/pull/46) and shipped in 0.3.0. A watcher launched while items it already printed are still unanswered now waits, instead of exiting at once. Your installed `lahe` has it.

- **Watcher docs:** merged as [PR #44](https://github.com/kenxle/live-agentic-html-editor/pull/44). The lahe skill's Claude Code section is rewritten around the one call that worked. It says one launch waits until there is work, and to answer every item before launching. The false timeout line is gone. The contract, `docs/CLI.md`, and the hint `lahe review` prints say the same. Unit gate: 2,438 passed, 0 failed.

- **Link rule:** merged as [PR #42](https://github.com/kenxle/live-agentic-html-editor/pull/42). The first CI run lost a port to a parallel test; the rerun passed. That flaky test is on the board.
- **Unit gate:** 2,438 passed, 0 failed.
- **Not touched:** the PDF spec's summary sentence. It can ride in this branch if you want it.
