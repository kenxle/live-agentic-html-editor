---
read-when: Changing a file in src/browser/review-layer/editing/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/browser/review-layer/editing/`: the review layer's editing code

This folder holds the review layer's editing code. Today that is `write-epoch.ts`; `editing.ts` arrives with the review layer's own conversion (slice B11 of the [TypeScript migration](../../features/20261112.01_typescript_migration/parts/target_layout.md)).

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## `write-epoch.ts`: keeping Lahe's own writes from waking replay

The problem: replay writes a region; the MutationObserver watching the page sees that write and schedules another replay pass; that pass writes again, or at best compares and skips, and the observer sees it, and the loop runs until something else stops it. On a page that also repaints on a timer, the two interleave, with the reviewer's caret inside.

The rule has three parts, and all three are needed. The first two alone lose mutations, and the third alone is a race.

1. Every mutation the tool makes to the reviewed page happens inside `write(reason, fn)`. No exceptions, including a one-line `textContent` assignment and the rail attaching a highlight.
2. `write` raises the depth synchronously, runs `fn`, and lowers the depth in a microtask, not when `fn` returns. This is the part that is easy to get wrong. A MutationObserver's callback is a microtask queued at the moment of the first mutation, which happens inside `fn`, so a microtask queued after `fn` runs after the observer. The observer sees the epoch open for exactly the batch holding the tool's own writes, and for nothing after.
3. The observer asks `isWriting()` first and returns without scheduling when it is true. It still notes that something happened (`noteExternalMutation`), because a page repaint can land in the same batch as a tool write, and dropping it silently is how a real repaint goes unnoticed.

The owed pass must be run, not just remembered. When the depth unwinds to zero with a mutation owed, the epoch calls its `onIdle` listeners, whoever opened it. Replay used to consume the flag only at the end of its own passes, so a repaint that collided with any other write (an edit session opening, a format command, an undo, protect restoring a snapshot) was remembered and never run, and the page kept whatever the repaint put there until something unrelated happened. The epoch is the only place that knows every one of its openings, so the wake-up belongs to it. A listener calls `takePendingExternal` and decides for itself. The flag stays set until a listener, or anyone, takes it.

The epoch number advances once per write. Replay stamps the number it last ran at, so a pass that wakes with no new write and no outside mutation can finish without touching the page.

An exception inside `fn` still closes the epoch. Otherwise the depth would stay above zero and mute the observer for the rest of the session.

`reason` is checked at run time, because the type `string` admits an empty name, and the first question every replay bug asks is who scheduled this. The reasons are not recorded. `fn` and the listener are not checked, because the types guarantee them.

There is one epoch per page, made when the module loads, and the module's own functions act on it. The old code reached it two ways (an `epoch.shared` object and four delegates); that second surface is gone. Tests make their own epoch with `createEpoch`.
