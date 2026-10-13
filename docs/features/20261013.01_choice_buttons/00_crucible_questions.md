# Choice buttons in LAHE: the crucible

Date: 2026-10-13
Status: ROUND 1, seven questions waiting on Ken

**Needs you.** Seven questions below. Under each one I wrote my best answer from what I found in the code, the board and your message. Where I got it right, a comment saying "yes" on the card is enough. Where I got it wrong, say so and I will fold your answer in. Round 2 brings the premises and two or three approaches to pick from.

**Why one page and not one question at a time.** The crucible skill asks its questions one by one in chat. Your global rule says a set of questions goes on a page, and the free-writing crucible ran this way and worked. Same here.

## What you asked for

"We need to teach lahe how to present buttons for basic choices. This page for example [the lesson queue](http://docs.features.20261012-01-forge-international-style.lahe.localhost/02_lesson_queue.md) is a bunch of yes no choices. I have to highlight, create a comment, and submit, when it could just as easily be a click to accept. We already have buttons that send info to the agent ("send"). It should be very doable to have it present buttons that can be clicked, which send messages back to the agent to take action, and have enough identifiers that repetitive buttons are not confused (multiple lessons to approve)."

## What I understand about the area

- **Browse is the page untouched.** Decision D3 in the architecture says the library never intercepts a click in browse mode: links navigate, buttons act, forms submit, the page's own JavaScript sees everything. This is the one design rule a choice button has to get past. A button the agent wrote into the page would have to be the one kind of element whose click the library claims, and the agent opting in by marking it is what makes that square with D3.
- **The record kinds are a closed list.** Decision D4 names five: comment, edit, delete, format_only, and note (free writing added note). A button press is either a sixth kind or a comment with a structured body. Adding note is the precedent for adding one.
- **A non-comment event already exists.** "Mark as done" on a card's chip posts an `item.closed` event naming the item and its revision, nothing else. The helper checks the id and revision and drops a stale one. That is the shape a button press would take: a small identified event the helper can verify, not a free-text comment.
- **The Markdown renderer keeps raw HTML.** I ran marked on `<button data-x="1">Yes</button>` and it comes out as-is. An agent can already write a button into a Markdown page today. Nothing would catch the click.
- **Task-list checkboxes render disabled.** `- [ ] item` comes out as a checkbox marked `disabled`, and the document style already knows how to draw them. That is a second place a clickable choice could live.
- **The drain is where the agent reads.** `lahe status --json` lists ready items with the reviewer's words at the top and page text labeled as data (D12). A press needs to arrive there with its identity spelled out so the agent never has to guess which lesson "yes" meant.
- **The lesson queue page is the live example.** 19 lessons, each with a recommendation (promote or discard), each wanting one of three answers: promote, discard, merge. The page's own shortcut is "one comment here saying all as recommended is enough." That shortcut is the current workaround, written by the agent because the long form is too slow.

## What I looked for first

- **No prior work in this repo.** No brief, board row, ongoing doc or report covers buttons, choices or approvals. The closest is the free-writing crucible (new record kind, new gesture), which is the process precedent, not the feature.
- **Nothing to adopt.** The zero-dependency rule rules out a widget library, and none would fit anyway. What exists is designs worth copying:
  - **Slack's Block Kit buttons.** Each button carries an action id and a value, and a press posts a payload naming the block, the action and the value. That is the identity model your message asks for.
  - **Claude Code's own AskUserQuestion.** Buttons in the terminal, always with an "Other" free-text option. The lesson: a button set needs an escape hatch to prose.
  - **GitHub task-list checkboxes.** Clicking one rewrites `[ ]` to `[x]` in the Markdown source. No separate event channel; the file is the record. A lateral option for LAHE, since the agent already reads the file.
  - **Google Docs suggestions.** Accept and reject buttons per suggestion. LAHE's "Mark as done" chip is already this shape.

## The questions

### Q1. What job is this hired to do?

My read: **clear a queue of decisions the agent has already framed, so the agent can act, without any decision getting lost or misread.** The trigger is an agent handing you a page of recommendations: a lesson queue, a crucible like this one, a forge checkpoint, a cleanup close-out with "approve deleting these". The job is not "answer a question"; it is "get N small verdicts back to the agent in one sitting, each tied to the thing it is about."

Push: is the pain the three gestures per answer, or is it that prose answers get misread? "All as recommended, except merge the two monitor ones" is one comment and the agent can still get it wrong. If the misread is the real job, buttons matter even when there are only two decisions.

What would change my mind: if you tell me you almost always say "all as recommended" and the long form is rare, this is a small convenience and not a job.

### Q2. Who is this for?

My read: **two users, and the second one matters more than it looks.**

- You, reading a decision page an agent made for you, usually while something else is running.
- The agent writing the page. If the way to make a button is fiddly, agents will not use it, or will use it wrong, and you will be back to comments. The authoring side has to be one line of Markdown an agent gets right from the skill text alone.

Push: are there other reviewers yet? The free-writing crucible said "Ken and others, no ideal customer defined." If it is still just you, the authoring side is the harder design problem, because you can learn any gesture and the agents cannot.

### Q3. Where and how does it happen?

My read: **laptop, the page in a browser tab, mid eighteen other things.** Your memory note from checkpoint pages says you read them "at zero", with no context loaded, and want to be told what you will notice. A decision page is read the same way. You are not on a phone, and the rail is open or one keystroke away.

One thing this changes: the answer has to be visible on the page after you click it, not only on a card in the rail, because you will come back to the page later and want to see what you already decided.

Push: do you ever want to answer these from your phone? If yes, that is a different feature (LAHE has no mobile story) and I would keep it out of this one.

### Q4. How do you know the problem is real?

Evidence I have:

- You asked for it today, with the gesture count spelled out: highlight, comment, submit.
- The lesson-queue agent invented the "all as recommended" shortcut on its own, which is a workaround built because the real thing is missing.
- Decision pages are now the normal way agents reach you: the forge checkpoints, the cleanup close-outs that ask approval on deletions, the lesson queue, this page. Every one of them is a list of small verdicts.
- The free-writing crucible already recorded that you reach for the agent instead of the tool when the tool makes something slow.

What I do not have: a count. How many decision pages a week, how many verdicts on each, how often you answered anything other than "yes to all". If you have a feel for that, say it, because it decides whether this is a daily tool or a monthly one.

### Q5. What do you do today, and what does it cost?

My read: three things, each with a cost.

- **Comment per item.** Select, Cmd-Shift-C, type, Cmd-Enter. Four actions per verdict, nineteen times on the lesson page.
- **One blanket comment.** "All as recommended." Fast, but any exception has to be prose, and the agent can misread it. Each misread costs a round trip you may not notice until later.
- **Answer in the chat.** Claude Code already shows buttons in the terminal (AskUserQuestion). You do not use them for this because the chat scrolls away and you are not watching it, which is the whole reason the page rule exists.

If we do nothing: agents keep inventing their own shortcuts page by page, each slightly different, and you keep paying four actions a verdict when you disagree.

### Q6. Does this matter more or less as the models improve?

My read: **more.** A stronger agent brings more finished recommendations and fewer open-ended questions, so your share of the work shifts toward saying yes or no to things the agent already worked out. A queue of verdicts is exactly what a better agent produces more of. The counter-argument is that a good enough agent needs no approval at all. Your lessons process says otherwise on purpose: you keep the promote-or-discard call for yourself. As long as that is true, the verdict channel gets busier, not quieter.

### Q7. Why this, and why now?

What else is on the board that this displaces:

- Two security rows: the CLI sends its raw secret after an unauthenticated probe, and the page server does not check the Host header. Both real, both accepted for now.
- The npm package and the Product Hunt launch, which have waited since September.
- The Library's dismiss-and-hide, which you asked for after your first pass through the Library.
- Teaching the renderer the forge structure, so forge pages are code and not hand-written.

My read: this belongs ahead of all of those except possibly the security rows, on your own priority order for the project (velocity, dogfooding, then security). You hit this on every decision page, several times a day, and every forge run adds more of them. The security rows are not blocking anything you do today. The npm package and the launch make more sense once the daily tool stops having rough edges like this one.

Push: if the launch is near, I would do the launch first and this right after, because a half-built button feature on launch day is worse than none.

## Where I think this is going

Not a decision yet, just so you can steer early. The shape I keep arriving at: the agent writes a choice as plain Markdown the renderer turns into a row of buttons, each button carrying an id the agent chose and the text it shows. A click posts a small identified event, the way "Mark as done" does, and the page shows the chosen answer in place. The agent's drain lists the press with its id, label and the heading it sits under, so "promote" on lesson 7 can never be confused with "promote" on lesson 8. Every button row keeps a way to answer in words instead. Round 2 lays this out against two other approaches, including the checkbox-in-the-file one.
