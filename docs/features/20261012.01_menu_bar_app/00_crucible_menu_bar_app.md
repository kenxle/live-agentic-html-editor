# Crucible: Menu bar app

Date: 2026-10-12
Status: ACCEPTED

## The idea, as stated

The menu bar icon deferred from stable addresses: show the helper is running, link to the Library, and a Quit button. During the crucible Ken chose the bigger version, an icon that tells him when something is waiting on him, and added recent documents and a view of what is open and who is connected.

## Jobs to be done

- One glance tells Ken whether anything needs him, and one click gets him there.
- See at a glance what is open and who is connected, so nothing is left running by accident.

## Who the user is

Ken, on his Mac, running several coding agents at once and reviewing their work in Lahe. Later, other developers who run coding agents on a Mac. For some of them the open-and-connected view is a satisfying sign of how much they have going on.

## User context

At his desk, mid-work, with several agents in terminal windows and many browser tabs open. He keeps the Dock hidden. The menu bar is the one place he can see without switching windows.

## What already exists

- The Library lists every review on the machine, at `library.lahe.localhost`. A bookmark opens it in one click.
- `lahe status` says whether the helper is running.
- Since 0.3.0, `lahe install` makes macOS start the helper at login and restart it if it stops.
- The helper already records every review, unanswered comment, agent reply, open review window, and live agent monitor. The Library's "waiting" count is comments waiting on an agent, not on Ken.
- The CLI has a secret in the state folder that proves it may talk to the helper.
- Research: SwiftBar and xbar turn a script into a menu bar item, but need a third-party app installed and do not give a real Lahe icon. Docker, Ollama and Tailscale use the same pattern Lahe would: a native menu bar icon over a background server. Chrome and Edge can badge an installed web app's Dock icon. Nothing found that Lahe could adopt as is.

## Evidence

- Ken asked for the icon during stable addresses, where it was deferred, and today said he loves the "waiting on you" idea.
- The board shows the pain: comments sat unanswered while an agent worked elsewhere (review r03fdeebe1fb6), and Ken missed an agent's answer once (review r5c67aef9754a).
- No sign Ken went looking for the Library or wondered if the helper was up since the login item shipped. The basics alone have no evidence behind them.

## Status quo

A bookmark or an open Library tab, and `lahe status` when something seems wrong. Ken finds out an agent asked him something only when he happens to open that document.

## Premises

All five agreed by Ken.

1. An always-visible icon is worth building, even though the Library is a bookmark away.
2. Mac-only native code is fine in this repo, as long as it is optional and the core stays cross-platform.
3. Building the icon on Ken's Mac with Apple's command line tools is fine. A Mac without them gets a clear message and no icon.
4. A wrong count is worse than no count. The first version shows only signals Lahe can know for certain.
5. Agents do not change how they work. The icon is another way of seeing and reaching what the helper already records, plus one new "you looked at it" mark.

## Requirements found along the way

For the brief to write up properly:

- "Waiting on you" counts two things: an agent asked a question on a card, and an agent answered comments Ken has not looked at since. The Library's "waiting" count (comments waiting on an agent) shows too, labeled apart.
- The icon shows only the "waiting on you" count. The menu shows what is open and who is connected: the counts, and under them the open documents and listening agents by name.
- Recent documents in the menu open the same way the Library's Open does.
- The running indicator and a Library link are in the menu.
- Everything the menu shows comes from one helper answer any program could read. Only the icon is Mac code.
- The icon is optional. On a Mac, `lahe install` offers it.
- Quit has two items: "Hide the icon" closes the menu bar app only; "Stop Lahe until next login" stops the helper until the next login.

## The case against building this

The basics are covered by a bookmark and `lahe status`. The new value is the "waiting on you" count, and it only pays off if it is right; a count that is wrong will be ignored within a week. This is also the first Mac-only code in the repo and the first piece built on the user's machine. Board items Ken hits daily (dismissing a card, clearing old Library rows, cards naming the agent) wait while this is built. Ken chose this one now.

## What happens if we do nothing

Ken keeps learning about an agent's question only when he opens that document, and stray sessions and agents stay invisible until he runs `lahe status` or opens the Library.

## Approaches considered

### Approach A: a SwiftBar script

Lahe ships a script; SwiftBar shows its output in the menu bar. No Mac code, but a third-party app to install and no real Lahe icon. Ken ruled it out: without a Lahe icon it is not the thing.

### Approach B: a small native Mac app

A small Swift program draws the icon and menu, built on the user's Mac by `lahe install` and started at login. It reads one new helper answer. Medium risk: the first native code in the repo, and the app needs to prove to the helper it may read review data.

### Approach C: a Dock badge on the Library

Make the Library an installable browser app and badge its Dock icon. No native code, but it only updates while the window is open, needs Chrome or Edge, and lives in the Dock. Ken ruled it out: he keeps the Dock hidden. Possible later addition.

### Do nothing

Keep the bookmark, the Library tab and `lahe status`. Loses the at-a-glance count and the open-and-connected view.

## Recommended approach

Approach B. The job is a glance, and only a real menu bar icon is always visible with no window open and no third-party app. Building the helper answer as its own step keeps the core cross-platform and leaves a Linux or Windows tray icon possible later.

## Challenges the session leader accepted

- The plain running-dot-and-Library version alone was a small win; Ken took the bigger "waiting on you" version.
- A wrong count is worse than none, so the first version sticks to signals Lahe can know for certain.
- Quit needs two items, because macOS restarts the helper otherwise.

## Challenges the session leader rejected

- SwiftBar as a no-native-code shortcut: rejected, it has to be a real Lahe icon.
- A Dock badge: rejected, Ken keeps the Dock hidden.
- The busy view as only a nudge to clean up: Ken widened it. It shows what is open and who is connected, for finding strays and as a sign of activity.

## What we skipped and why

Q2 to Q7 were drafted from the stable addresses discussion and shown on the page; Ken did not correct them. Roadmap priority was not argued: Ken chose this now over the board rows named above.

## Open questions

- Exactly when "answered since you looked" resets: on opening the document, or on seeing the card. The brief decides.
- What "recent" means for the recent documents list, and how many to show.

## The assignment

Write the brief from the requirements above, then the architecture with a security review of how the menu bar app proves to the helper that it may read review data.
