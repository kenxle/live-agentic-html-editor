# Crucible: Menu bar app

**One thing left for you: agree or disagree with the five premises below.** They are now real assumptions; the requirements moved to their own list. You ruled out A and C, so the approach is B. Status: in progress, 2026-10-12.

## What you said

You want the icon that tells you when something is waiting on you, and added two things:

- **Recent documents** in the menu, as a quick way to open them.
- **What is open, and who is connected:** how many documents are open and how many agents are listening. For you it helps find a stray open session or a forgotten agent, and nudges you to close things out. For others it can be a satisfying sign of how much they have going on.

The running indicator, the Library link and Quit stay in, for completeness. It has to be a Lahe icon in the menu bar. You keep the Dock hidden, so a Dock badge does not count.

## Jobs to be done

One glance tells you whether anything needs you, and one click gets you there. Second job: see at a glance what is open and who is connected, so nothing is left running by accident.

## Premises

Agree or disagree with each one. A comment on the line is enough.

1. **An always-visible icon is worth building, even though the Library is a bookmark away.** The value is seeing without looking for it.
2. **Mac-only native code is fine in this repo,** as long as it is optional and the core stays cross-platform. (You agreed to both parts already.)
3. **Building the icon on your Mac with Apple's command line tools is fine.** A Mac without them gets a clear message and no icon. The alternative is shipping a ready-built app, which needs an Apple developer account to sign it.
4. **A wrong count is worse than no count.** So the first version shows only signals Lahe can know for certain, even if that means fewer of them.
5. **Agents do not change how they work.** Everything the icon shows comes from what the helper already records, plus one new "you looked at it" mark. No new step for an agent to forget.

## Requirements for the brief

These came out of the conversation. The brief writes them up properly.

- **"Waiting on you" counts two things:** an agent asked you a question on a card, and an agent answered comments you have not looked at since. The Library's existing "waiting" count is the other direction (your comments waiting on an agent); the menu shows both, labeled apart.
- **The icon shows only the "waiting on you" count.** The menu shows what is open and who is connected: the counts, and under them the open documents and the agents listening, by name.
- **Recent documents open the same way the Library's Open does.** Same address, same rules.
- **The core stays cross-platform.** Everything the menu shows comes from one helper answer any program could read. Only the icon is Mac code.
- **The icon is optional.** On a Mac, `lahe install` offers it. Nothing else needs it.
- **Quit has two items:** "Hide the icon" closes the menu bar app only. "Stop Lahe until next login" stops the helper until you log in again.

## The case against building this

The basics are already covered: the Library is a bookmark, and `lahe status` says whether the helper is up. The new value is the "waiting on you" count, and that only pays off if you trust it. If it says 3 when nothing is waiting, you will stop looking at it within a week. Also, this is the first Mac-only code in the repo, and the first piece that has to be built on your machine. Board items you hit every day (dismissing a card, clearing old Library rows, cards naming the agent) wait while this is built. I still think it is worth it, because you liked the idea, and because more agents running at once makes "who is waiting on whom" harder to track by tab.

## Approaches

### A. Smallest: a SwiftBar script

Lahe ships one script. SwiftBar, a free menu bar app, runs it every few seconds and shows what it prints as the menu.

- **Pieces:** one script, plus the new helper answer from premise 6.
- **Risk:** low.
- **Good:** no Mac code in the repo; quick to build.
- **Bad:** you install SwiftBar first, and so does anyone else. It looks like a script's output, not a Lahe icon. Clicking a recent document runs a script rather than opening directly.
- **Your call: out.** Without a real Lahe icon it is not the thing.

### B. Best shape: a small native Mac app

A small Swift program draws the icon and menu. `lahe install` builds it on your Mac with Apple's compiler, which you already have, and makes macOS start it at login next to the helper. It reads the new helper answer every few seconds.

- **Pieces:** the new helper answer, a "you looked at it" mark, a Swift program, a build step in `lahe install`, and a second login item.
- **Risk:** medium. It is the first native code in the repo, and the app needs a way to prove to the helper that it is allowed to read review data. The CLI already has a secret for that, so a security review in the architecture will check that the app reuses it safely.
- **Good:** a real Lahe icon with the count on it; nothing extra to install; the helper answer is reusable by other systems later.
- **Bad:** a build step that needs Apple's command line tools. A Mac without them gets a clear message and no icon.

### C. Sideways: a badge on the Library instead of a menu bar icon

Make the Library installable as a browser app (Chrome and Edge can do this). It then sits in the Dock, and the Library page puts the "waiting on you" count on its Dock icon as a badge.

- **Pieces:** a small change to the Library page, and the "you looked at it" mark.
- **Risk:** low.
- **Good:** no native code; works on Windows too; recent documents are already in the Library.
- **Bad:** the badge only updates while that Library window is open. It is a Dock icon, not the menu bar, and it works in Chrome and Edge only, not Safari.
- **Your call: out.** You keep the Dock hidden and want a menu bar item. Interesting as a later addition.

### Do nothing

Keep the bookmark, the Library tab, and `lahe status`. You lose the at-a-glance count, and you keep finding out an agent asked you something only when you happen to open that document.

## Recommendation

**B, and with A and C out it is the one left.** The job is a glance, and only a real menu bar icon is always visible without a window open or a third-party app. Building the helper answer first, as its own step, keeps the core cross-platform and leaves A or C possible later at little cost.

## Draft answers to the other questions

These stand unless you correct them.

**Who it is for.** You, on your Mac. Later, other developers who run coding agents on a Mac.

**Where it happens.** At your desk, mid-work, with several agents running in terminal windows and many browser tabs open. The menu bar is the one place you can see without switching windows.

**Evidence.** You asked for it during stable addresses, and today you said you love the "waiting on you" idea. The board shows the pain: comments sat unanswered while an agent worked elsewhere, and you missed an agent's answer once.

**What you do today.** A bookmark or an open Library tab, and `lahe status` when something seems wrong.

**If models get better.** You will run more agents at once. A "who is waiting on whom" count gets more useful as that grows.

**Priority.** It competes with board rows you asked for directly: dismissing a card while keeping its history, the Library's clear and hide buttons, and cards naming the agent. You chose this one now.
