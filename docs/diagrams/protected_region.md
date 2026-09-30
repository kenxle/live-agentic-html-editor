# Protecting a block while it is being edited

While the reviewer is actively editing a block, the library owns it: the page must not be allowed to repaint that block out from under the reviewer's cursor. There are three layers doing this, not one, and that is the whole point. An archived round-2 review found that restoring the caret after a repaint cannot work on its own: the repaint destroys the text node the selection lives in before any observer even fires, so by the time a restore runs there is nothing left to restore into.

```mermaid
flowchart TD
  Edit(["reviewer starts editing a block"]) --> L1["Layer 1: mark the block<br/>with a skip attribute<br/>(Turbo's data-turbo-permanent<br/>is one framework that honors it)"]
  L1 --> L2["Layer 2: veto the repaint<br/>before it happens, where<br/>the framework offers a hook<br/>(e.g. turbo:before-morph-element)"]
  L2 --> L3["Layer 3: snapshot the selection<br/>and the block's text/attributes;<br/>if a repaint destroys the node<br/>anyway, a mutation observer<br/>restores it and puts the caret<br/>back at the same character offset"]
  L3 --> Run{"a free-writing session?<br/>(an anchor plus a run of new blocks)"}
  Run -- "yes" --> RunSnap["the snapshot holds the anchor and<br/>every run block, in order, with<br/>the caret as block index + offset"]
  RunSnap --> RunRestore["after a repaint: re-find the anchor<br/>(its region attribute, else the anchor<br/>engine), rebuild the run after it with<br/>blocks.insertPointAfter, put the caret<br/>back by position, make the new parent<br/>the editing host again"]
  Run -- "no" --> Commit
  RunRestore --> Commit

  L3 --> Commit(["reviewer commits<br/>(Esc, click away, or navigate)"])
  Commit --> Lift["protection lifts:<br/>skip attribute removed,<br/>snapshot discarded"]
  Lift --> Record["the edit becomes a record"]
  Record --> Replay["a replay pass runs<br/>IMMEDIATELY, in the same turn"]
  Replay --> Outcome{"had the page tried to change<br/>this block while it was protected?"}
  Outcome -- "yes" --> Told["surfaces through the replay<br/>compare's 'matches none of these'<br/>branch: told, not lost"]
  Outcome -- "no" --> Clean["nothing else to do"]
```

## What to notice

- **Three layers because one alone is not enough.** Layer 1 (the skip attribute) only works if the framework chooses to honor it. Layer 2 (the pre-morph veto) only exists where the framework offers a cancelable hook before it repaints. Layer 3 (snapshot plus mutation-observer restore) is the framework-free fallback: it catches every repaint that honors neither of the first two, standard DOM mutation with no cooperating framework at all.
- **Layer 3 restores by character offset, not by node identity.** The repaint has already destroyed the original text node by the time the observer callback runs, so the caret is necessarily placed in a new node. The restore is judged by whether the text reads right and the caret lands at the same offset, never by whether it is "the same node," because it never is.
- **A free-writing session protects the anchor and its whole run.** The run's blocks are elements the page's server never sent, so a repaint of their parent drops them all; no node-level restore could bring them back. `protect.mark` takes a `blocks()` function (read each time, because every Enter grows the run) and a `host()` function. The snapshot keeps each block's tag and markup in order, and the caret as a block index plus a character offset. The restore re-finds the anchor, rebuilds the run after it with the one insert-point rule, and hands the rebuilt blocks to the editing surface (`protect.protectedBlocks()`), which makes the new parent editable again. A tag swap mid-sitting moves protection to the new element (`protect.rebindTo`).
- **The replay pass on commit is not optional and not delayed.** `protect.release()` calls into replay's commit pass synchronously (deferred only by one microtask when a write epoch is still open), specifically so a change the page tried to make to the block while it was protected is not silently swallowed. Before this was wired up, lifting protection with no immediate pass meant an agent's landed change under the reviewer's fingers just vanished.
- **The write-epoch rule is what stops this from looping.** Every mutation the library makes to the page happens inside `epoch.write(...)`. A mutation observer checks whether an epoch is currently open before deciding to schedule another replay pass, so replay's own writes (and the restore's own writes) do not retrigger replay chasing its own tail.
- **An agent's change lands as information, not as a loss.** The point of running replay right away is that a suppressed page change is never dropped: it comes back through the same "matches none of these" branch that any live conflict goes through, so the reviewer sees both versions and picks, rather than the agent's work quietly disappearing.
