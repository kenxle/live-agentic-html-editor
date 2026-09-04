# Item lifecycle

Every comment you leave and every edit you make is one "item," and at any moment it sits in exactly one of four states. This diagram is `src/shared/lifecycle.js`'s transition table drawn as a picture; every arrow below also names who is allowed to draw it, because that rule is the whole reason the diagram exists.

```mermaid
stateDiagram-v2
    [*] --> draft : reviewer starts typing

    draft --> draft : reviewer keeps typing (every keystroke saved, revision unchanged)
    draft --> ready : reviewer confirms (Cmd-Enter, or an edit committing)

    ready --> ready : reviewer rewords (bumps the revision)
    ready --> handled : agent, naming the CURRENT revision, says it made the change
    ready --> not_handled : agent, naming the CURRENT revision, says it did not, with a reason

    not_handled --> ready : reviewer answers or rewords it, back to the agent
    handled --> ready : reviewer reopens it (the fix did not land)
```

## The four states, in plain words

- **draft**: the reviewer is still typing. It is saved so nothing is lost, but no agent can see it yet.
- **ready**: the reviewer hit Cmd-Enter, or an edit committed. An agent may now act on it.
- **handled**: an agent said it made the change.
- **not_handled**: an agent said it did not, and left a reason the reviewer reads on the card.

## What to notice

- **Every arrow names an actor.** The reviewer is the only one who can move an item from `draft` to `ready`. An agent can never do that. An agent may only move an item OUT of `ready` (to `handled` or `not_handled`), and only for the exact revision it named. If the reviewer reworded the comment after the agent read it, the agent's reply names a revision that no longer applies, and the move is refused rather than silently swallowing the rewording.
- **The helper never moves anything on its own.** It is not listed as an actor anywhere in the table. It only records moves the reviewer or the agent tell it about, and projects the result.
- **`question` is a reply status, not a state.** An agent asking a question leaves the item exactly where it is, in `ready`, because the work is still outstanding; the question and its answer live on the card.
- **`reopened` is a transition, not a fifth box.** It is just the `handled` to `ready` arrow above, drawn for the case where the reviewer decides a fix did not actually land.
- **A failed transition throws, on purpose.** `src/shared/lifecycle.js` fails loudly rather than ignoring an illegal move, so a bug in a reply handler shows up immediately instead of quietly retiring the wrong item.
- **Deletion is not on this diagram** because it is not a lifecycle transition, but it is worth knowing: a reviewer can delete their own outstanding work from `draft`, `ready`, or `not_handled`. A `handled` item cannot be deleted, because the agent already changed the source and the record is the only thing saying so; the reviewer takes a handled change back a different way (undo), which asks the agent to remove it rather than erasing the history that it happened.
