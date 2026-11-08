---
read-when: Trying the third small-fixes batch by hand in the rail before it merges.
---

# Try the Saturday-night rail fixes

Three board rows were built while you were away. Two of them change what you see in the rail, and this page is the place to poke at them. The third changes the helper's clock and only shows once the PR merges, so it is described, not linked. Nothing here needs an answer; leave a comment on anything that feels wrong.

## 1. Send goes grey over an empty box

Select any sentence on this page and press Cmd-Shift-C, type a few words, and send. On the card that appears, look at the "Add another message" box: its Send is grey until you type, and goes grey again the moment you clear the box or send. The Done tab's follow-up box, under any card an agent has answered, does the same.

The Send under the page-note box at the bottom of the rail already worked this way. Now all three match.

## 2. A locked window tells you why

Open [this same page in a second tab](play.md) and leave the first tab open. The second tab is read-only, because the review is open in the first. Then, in the second tab:

- Close the amber "This review is open in another window" panel with its x.
- Click into the "Add another message" box under your comment. The box says "Open in another window", its Send is grey, and the panel comes back and pulses "Review here instead".
- Type a letter: nothing types, the panel pulses again.
- Press Cmd-Shift-C on the page: same answer.
- Tab through the rail with the keyboard, or press Escape or an arrow: no pulse. Only a press, a typed key, or the comment and edit chords answer.
- Press "Review here instead": everything unlocks, and the box's own placeholder comes back.

## 3. A held comment waits from its release (helper side, after merge)

You held comments for 45 minutes, released them, and the "Nothing has come back" alert fired at once. The helper now stamps every event it takes in with its own clock, and the rail's clock counts from that stamp, so releasing Hold starts the wait at the release. A same-revision repost (replay fixing a lost stamp, an edit's repost) keeps the first stamp, so the clock never gets quieter on its own. This needs the helper on the new code, which happens when the PR merges and the helper restarts.

## Where the record is

- [The progress page](04_progress_board_small_fixes_three.md) has the spec table, the review findings and what was fixed.
- Screenshots from the browser tests: [the locked box with the pulsed panel, light](readonly_nudge_light.png), [dark](readonly_nudge_dark.png), [an empty box with Send off, light](send_off_light.png), [dark](send_off_dark.png).
- The branch is `task/board-small-fixes-three`. Its three-browser gate is running now; the PR opens when it reads 0 failed.
- A second branch, `task/observer-perf`, stops a live chart's hover redraws from re-running the replay pass per frame. [Its progress page](../20261107.02_observer_perf/04_progress_observer_perf.md) is in the other worktree and is not reachable from this address until it merges.

What is live on this page right now is the rail bundle from the branch, copied into the main checkout's `dist/` for this preview. The helper itself is still on main.
