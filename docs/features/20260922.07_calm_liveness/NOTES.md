# Calm the "nobody picked this up" alarm

A reviewer commented while their agent was thinking through a hard question and
got the loud banner "Nobody has picked up your comments in 27s". Nobody had left.
The agent was mid-thought.

## Why it fired

The rail calls an agent WORKING only if it can see a footprint: a `lahe` command
or a folded reply. A model reasoning through one complex item leaves no footprint
for as long as it reasons, and no monitor is armed while an agent works the batch
it was handed, so nothing holds the wake feed open either. With no footprint and
no listener, the state fell to "no agent", and "no agent" went loud the moment
the line started speaking at thirty seconds.

## What changed

Two numbers in `src/shared/protocol.js` `AGENT_LIVENESS`.

- `ACTIVE_MS`, how recent a footprint has to be for the agent to read as working:
  was 3 minutes, now 10 minutes. That is the same as `RECENT_COMMAND_MS`, which
  is how recent a command has to be for the machine to count somebody as being on
  the review. One number for both: the agent counts as working for exactly as long
  as it counts as present.
- `NO_AGENT_LOUD_MS`, new, 2 minutes. When nothing is listening, the line still
  speaks its quiet sentence at 30 seconds as before, but the amber banner, the
  amber card and the pop-up notice wait until 2 minutes.

Unchanged: every word, every state, the hover detail, and `STALE_MS` (an agent is
listening but nothing has come back stays loud at 10 minutes).

## What a reviewer notices

A comment left while the agent thinks now reads "Stored, nobody has picked this
up, 45s" in the small line at the bottom, with no banner and no amber. If two
minutes go by with still nothing, the banner arrives as it did before.
