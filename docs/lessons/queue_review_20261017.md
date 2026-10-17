# Three lessons wait for your call: discard all three

Agents wrote these after hitting a trap. A promoted lesson is what the next agent finds when it searches the words it is stuck on. Answer on each section: promote, discard, or merge.

## What needs you

<dl class="facts">
  <div><dt>Discard</dt><dd>The link-mount trap behind your Homework 6 cards. The PR fixed it; the part still open is a code fix on the board.</dd></div>
  <div><dt>Discard</dt><dd>The drain that dropped the question the reviewer was answering. The code already keeps it, and the whole conversation is on disk.</dd></div>
  <div><dt>Discard</dt><dd>The README hero recipe. It is a how-to, not a trap, and memory already holds it.</dd></div>
</dl>

## A link mount makes one site claim another site's files

<span class="badge badge--cobalt">Recommend: discard</span>

**The problem.** On your Homework 6 review, two paragraphs you added were in the file and on your page. The agent answered "handled" six times between the two cards, and Lahe refused every answer with "the built page does not show its text". The agent gave up and asked you to close the cards. Every other edit on that document quietly came back "can't tell", so the check was doing nothing there either.

The cause: your `docs/ongoing` site had a link into the assignments folder and came first in the list. Lahe picked it for the assignment, could not render the file through it, and read the raw Markdown instead.

**The fix.** The site whose folder holds the file wins, and a link only counts when no site holds it (PR #74, merged today).

**Why discard.** You are right that the PR covers it: a lesson about code that no longer behaves that way would point the next agent at a fixed bug. The part still open is underneath it. When the check cannot get the rendered page for any reason, it reads the raw Markdown without saying so, and a placed paragraph always fails there. That is better fixed than written up: the check should answer "cannot tell" instead. It is on the board as LAHE-handled-check-raw-markdown.

File: [the proposal](proposed/a-link-mount-makes-one-site-claim-another-sites-files.md)

## The agent reading a drain did not write every agent turn in it

<span class="badge badge--cobalt">Recommend: discard</span>

**The problem.** To save tokens, the drain stopped showing an agent its own earlier replies, on the idea that it already has them. Two cases broke:

- You answer an agent's question with "Yes, the second one." The agent sees your answer and an empty question. It cannot tell what "the second one" means.
- A new agent takes over a session. You follow up on a card the old agent answered. The new agent sees your follow-up and none of the replies it follows.

**The fix.** Keep the agent's words when the last turn is a question you are answering, or when an earlier agent wrote them before a takeover. The code does this today (`withoutAgentWords` in `src/cli/commands/status.js`).

**Why discard.** The code fix already shipped with the batch-reply change (PR #70): the drain keeps the question being answered and every turn from before a takeover. And yes, the whole conversation is on disk. `review.json` holds every thread in full, and `lahe status --json` without `--quiet` prints all of it; the skill tells an agent to run that after a compaction. The trim only decides what each wake pushes into the agent's context. What is left of the lesson is a design rule for the next trim, and the charter sends rules like that to docs, not lessons.

File: [the proposal](proposed/the-agent-reading-a-drain-did-not-write-every-agent-turn-in-it.md)

## The README hero needs a real website

<span class="badge badge--cobalt">Recommend: discard</span>

**The problem.** A hero screenshot taken on a plain Markdown page was rejected as too plain. The local Steady Thread server would not start without migrating your dev database, and Herald holds private data in a public repo.

**The fix.** Proxy the public steady-thread.com, add the rail, and shoot with the script in `~/Documents/lahe-readme-hero/`.

**Why discard.** This is a recipe for one recurring job, not something that behaves differently from how it looks. A memory already holds it ("README hero on a real site"), and that is where an agent retaking the hero will look. If you want it findable in the repo, the better home is a short note in `docs/ongoing/` beside the README images.

File: [the proposal](proposed/the-readme-hero-needs-a-real-site-and-no-local-one-is-safe.md)
