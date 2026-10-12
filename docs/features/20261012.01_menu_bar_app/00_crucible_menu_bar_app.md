# Crucible: Menu bar app

**Two things for you below: agree or disagree with the premises, and pick an approach.** I recommend approach B. After that I write the crucible summary and go straight on to the brief, architecture and plan. Status: in progress, 2026-10-12.

## What you said

You chose B, the icon that tells you when something is waiting on you, and added two things:

- **Recent documents** in the menu, as a quick way to open them.
- **A "you're doing a lot" signal:** how many documents are open, how many agents are listening, or both. It is a nudge to go clean up and close things out.

The running indicator, the Library link and Quit stay in, for completeness.

## Premises

Agree or disagree with each one. A comment on the line is enough.

1. **The job is: one glance tells you whether anything needs you, and one click gets you there.** The running dot and the Library link are basics inside that job, not the point of it.
2. **"Waiting on you" means two things.** An agent asked you a question on a card. Or an agent answered comments you have not looked at since. The Library's existing "waiting" count is the other direction: your comments waiting on an agent. The menu shows both, labeled apart.
3. **The helper already knows almost all of this.** It has every review, every unanswered comment, every agent reply, which review windows are open, and which agents have a live monitor. The one new thing is a "you looked at it" mark per review, so "answered since you looked" can work.
4. **The icon shows only the "waiting on you" count.** The busy counts (open documents, listening agents, open sessions) sit in the menu, so the icon stays quiet unless you are actually needed.
5. **A recent document opens the same way the Library's Open does.** Same address, same rules, nothing new about how pages are served.
6. **The core stays cross-platform.** Everything the menu shows comes from one new helper answer that any program could read. Only the icon itself is Mac code. A Linux or Windows tray icon could later reuse that same answer.
7. **The icon is optional.** On a Mac, `lahe install` offers it. Nothing else in Lahe needs it.
8. **Quit has two items.** "Hide the icon" closes the menu bar app only. "Stop Lahe until next login" stops the helper, and macOS does not restart it until you log in again.

## The case against building this

The basics are already covered: the Library is a bookmark, and `lahe status` says whether the helper is up. The new value is the "waiting on you" count, and that only pays off if you trust it. If it says 3 when nothing is waiting, you will stop looking at it within a week. Also, this is the first Mac-only code in the repo, and the first piece that has to be built on your machine. Board items you hit every day (dismissing a card, clearing old Library rows, cards naming the agent) wait while this is built. I still think it is worth it, because you liked the idea, and because more agents running at once makes "who is waiting on whom" harder to track by tab.

## Approaches

### A. Smallest: a SwiftBar script

Lahe ships one script. SwiftBar, a free menu bar app, runs it every few seconds and shows what it prints as the menu.

- **Pieces:** one script, plus the new helper answer from premise 6.
- **Risk:** low.
- **Good:** no Mac code in the repo; quick to build.
- **Bad:** you install SwiftBar first, and so does anyone else. It looks like a script's output, not a Lahe icon. Clicking a recent document runs a script rather than opening directly.

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

### Do nothing

Keep the bookmark, the Library tab, and `lahe status`. You lose the at-a-glance count, and you keep finding out an agent asked you something only when you happen to open that document.

## Recommendation

**B.** The job is a glance, and only a real menu bar icon is always visible without a window open or a third-party app. Building the helper answer first, as its own step, keeps the core cross-platform and leaves A or C possible later at little cost.

## Draft answers to the other questions

These stand unless you correct them.

**Who it is for.** You, on your Mac. Later, other developers who run coding agents on a Mac.

**Where it happens.** At your desk, mid-work, with several agents running in terminal windows and many browser tabs open. The menu bar is the one place you can see without switching windows.

**Evidence.** You asked for it during stable addresses, and today you said you love the "waiting on you" idea. The board shows the pain: comments sat unanswered while an agent worked elsewhere, and you missed an agent's answer once.

**What you do today.** A bookmark or an open Library tab, and `lahe status` when something seems wrong.

**If models get better.** You will run more agents at once. A "who is waiting on whom" count gets more useful as that grows.

**Priority.** It competes with board rows you asked for directly: dismissing a card while keeping its history, the Library's clear and hide buttons, and cards naming the agent. You chose this one now.
