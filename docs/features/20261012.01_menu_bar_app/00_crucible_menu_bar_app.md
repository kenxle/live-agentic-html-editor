# Crucible: Menu bar app

**One question for you, below.** Everything after it is my draft of the other crucible answers, from what we already said during stable addresses. Correct anything wrong right on the page. Status: in progress, 2026-10-12.

## Your question right now

**What do you want the icon to do for you, now that stable addresses shipped?**

When we deferred it, the plan was three things: show the helper is running, link to the Library, and a Quit button. Since then the helper starts at login and restarts itself, and the Library has its own address you can bookmark (`library.lahe.localhost`). So those three things are now a small win.

My position: the version worth building does one more thing. It tells you when something is waiting on you, without a tab open. For example, an agent asked you a question on a card, or an agent finished answering your comments. That is a different and bigger feature than a status dot.

Which do you mean?

- **A.** The small one: running or not, open the Library, Quit.
- **B.** The small one plus "something is waiting on you" (a count on the icon, and the waiting documents in the menu).
- **C.** Something else. Tell me the moment you last wished you had it.

What would change my mind: a recent time you went looking for the Library or wondered whether the helper was up. I have not seen one since the login item shipped.

## What I understand so far

- The helper is one Node process. Since 0.3.0, `lahe install` makes macOS start it at login and restart it if it stops.
- The Library lists every review on the machine, at `library.lahe.localhost`.
- The core has to keep running on Mac, Linux and Windows. Anything Mac-only sits on top as an optional extra. You settled that during stable addresses.
- "Quit" is not simple. macOS restarts the helper the moment it stops, because that is what the login item is for. So Quit means one of two things: close the icon only, or stop the helper until the next login. That is a decision for the brief.

## What already exists

- **A bookmark** already does "open the Library" in one click.
- **`lahe status`** already says whether the helper is running, in a terminal.
- **SwiftBar and xbar** are free Mac apps that turn any script into a menu bar item. Lahe could ship a small script for them and write no Mac code at all. The cost: you install a third-party app first (`brew install swiftbar`), and anyone else who wants the icon does too.
- **A small native Mac program**, written in Swift. `lahe install` could build it on your own Mac with Apple's compiler, which comes with the Xcode command line tools (already on your Mac). A program built on your own machine runs without Apple's signing check, so no developer account is needed. Shipping a ready-built program instead would need Apple signing.
- Docker, Ollama and Tailscale all do this pattern: a menu bar icon on top of a background server.

## Draft answers to the other questions

**Who it is for.** You, on your Mac. Later, other developers who run coding agents on a Mac.

**Where it happens.** At your desk, mid-work, with several agents running in terminal windows and many browser tabs open. The menu bar is the one place you can see without switching windows.

**Evidence.** You asked for it during stable addresses, and we deferred it. For the "something is waiting on you" version, the board has signs: comments sat unanswered while an agent worked elsewhere, and you missed an agent's answer once. For the plain status dot, I have no sign you went looking since the login item shipped.

**What you do today.** A bookmark or an open Library tab, and `lahe status` when something seems wrong.

**If models get better.** You will run more agents at once. A "who is waiting on whom" count gets more useful as that grows. A plain running dot does not.

**Priority.** It competes with board rows you asked for directly: dismissing a card while keeping its history, the Library's clear and hide buttons for old rows, and cards naming the agent ("Claude said"). Those fix friction you hit every day. The icon is new ground.
