# Make it obvious when nobody is picking up your comments

Ken, 2026-09-16, looking at the rail's footer line "Stored · nobody has picked this up, 10m": "this is great, but it should be more prominent. active boxes should change color if they haven't been picked up after a certain amount of time. something with more prominence should tell you to go check your agent or assign a new one to this doc."

A whetstone-size change to the rail. Progress is at the bottom.

## What you will see

- **A comment card that has waited too long changes color.** Today every waiting card in the Active tab looks the same whether it was sent five seconds ago or an hour ago, and that color is green, signifying success. After the wait passes the limit below, that card turns amber, and it says how long it has waited.
- **A banner at the top of the rail**, not the small line at the bottom, once anything has waited past the limit. It says, in plain words, that nobody has picked up your comments, for how long, and gives two things to do:
  - **Check your agent.** The words say to look at the agent's window, because that is usually the fix.
  - **Hand this doc to a new agent.** A button copies a short message you paste into a fresh agent. The message tells that agent to take over this LAHE session and work the comments that are waiting. It uses the takeover command the tool already has.
- **When the rail is closed to its small pill**, the pill itself turns amber and shows how long things have waited. Hovering it gives the same sentence as the banner, including the agent's name. Clicking it opens the rail, where the banner is.
- **A pop-up notice, once.** The moment something first goes late, the rail shows one of its usual pop-up notices with the same message, whether the rail is open or closed. Dismissing it means it does not come back for that same wait; a new wait later gets a new one.
- The small line at the bottom stays as it is.
- When a reply lands, the card goes back to its normal color and the banner goes away on its own.

## Session names

Ken runs many agents at once, and a LAHE session id like `s_9a3835ce54bc9e66` does not tell him which window to go check. Claude Code tells the agent the human's name for its session when he uses `/rename`. So:

- A LAHE session can carry a name. The agent sets it when it starts a review, and updates it if the session is renamed.
- `lahe session list` shows the name beside the id.
- The banner says "Check the agent named lahe updates 9/16" instead of just "check your agent", and the handoff message names it too.
- With no name, everything reads as it does today. Hosts that never tell the agent a name just show no name.

## What it looks like

Built and passing its tests; not merged yet. Left to right: the Active tab with the banner naming the agent, then a draft, a sent card still within its time, and a late card; the Done tab with a handled card; and the page with the rail closed, showing the one pop-up notice and the late pill.

![The rail in light mode](rail_states_light.png)

![The rail in dark mode](rail_states_dark.png)

What changed from the first pass, because of your comments:

- A sent card that is still within its time is now plain, with a blue outline. Green only means handled.
- A late card has no tint at all, just a strong amber outline and "waiting 12m", so it cannot be mistaken for a draft.
- The banner, the pop-up, and the closed pill all name the agent when the session has a name.
- The garbled comment box in the first screenshot was the test page, not the real rail. These pictures come from the real rail on a real page.

One thing the pictures show that this change did not cause: in dark mode, the "Add another message" boxes are light grey with unreadable text. That is an existing styling bug; it is a separate small fix.

## The limits, decided

The rail already has two limits and this change uses them rather than inventing new ones:

- **No agent listening at all:** the card and banner go amber after 30 seconds. There is nobody to wait for.
- **An agent is listening but nothing has come back:** amber after 10 minutes.
- **An agent is working on it:** never amber. A long queue behind a working agent is explained.

Say if you want different numbers; they live in one place.

## Tests

Written first. Unit tests for the rule that decides amber (each of the three cases above, and the reset when a reply lands) and for the handoff message (it names the session and the takeover command, and it is plain text with no token in it). One browser spec, run by name only, that a card past the limit carries the amber state and the banner shows with the copy button; the full browser suite runs once at merge.

## Files

The rail's drawing code and its styles (`src/layer/overlay.js`, `src/layer/tab_active.js`), the words in `src/shared/protocol.js` beside the existing wait wording, and their tests. The contract text says the rail "offers them a button to export their feedback and take it to another agent" after ten minutes; check that such a button actually exists today. If it does not, the new handoff button is it, and the contract sentence stays true. If it does, keep one button, not two.

## Progress

- 2026-09-16 20:02: spec written, builder dispatched.
- 2026-09-16 20:14: first pass came back with tests green. Sent back for Ken's edit (waiting cards should not be green), an amber that does not blur with drafts, a comment box drawn without styles in the screenshot, and session names in the banner. Ken approved the spec.
