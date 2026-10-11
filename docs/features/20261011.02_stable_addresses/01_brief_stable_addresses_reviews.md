# PM review: Stable addresses brief

Reviewer: PM persona, 2026-10-11. Read against Ken's directive, the crucible, the decisions page (`docs/ongoing/STABLE_ADDRESSES.md`), `docs/ongoing/LIBRARY.md`, the system overview and session ownership diagrams, and `docs/BULLETIN.md`.

## Summary

The brief is faithful to what Ken asked for. It names the real problem (nothing answers at an old address, and the address says nothing about the page), and it carries every decision Ken settled. Twelve findings, worst first. One blocker: switching between the `.lahe` and `.lahe.localhost` endings changes every address, which brings back the dead tabs the feature exists to remove. Six are important, mostly gaps where the brief does not say what "a document" is or leaves Ken's most common case (docs in worktrees) out by accident. None of the findings disagree with what Ken asked for.

## Findings

### RF1. Changing the address ending kills every address made under the other one

```
severity   blocker
kind       defect
where      Requirements, R6 (".lahe with a fallback"); Rollout / Flags; UX Notes, second bullet
what       An address is only stable if its ending never changes, but the brief switches endings at install, at uninstall, and whenever the setup breaks.
why        Before the install, Ken's tabs and history fill with `.lahe.localhost` addresses. The install moves new addresses to `.lahe`. If those old ones stop answering, or if a broken setup flips him back, he gets the dead tabs and lost drafts the feature exists to end. Drafts are kept per address, so they do not cross endings either. The UX note "the fallback is not an error" hides this.
fix        Add a requirement: an address handed out under either ending keeps loading for as long as the server runs. The server answers both endings for every name. The only exception is a `.lahe` address while `.lahe` lookup is off, and `lahe status` says so. Say plainly whether drafts follow a document from one ending to the other, or accept that they do not and list it as a non-goal.
```

### RF2. "Keeps working after a reboot with no command" is only true after the install

```
severity   important
kind       defect
where      R1 ("An old address keeps working") and R7 ("Starts at login on every system")
what       R1 promises an address works after a reboot with no command run, while R7 says a clone with no install starts the server only when `lahe review` runs.
why        The two requirements cannot both be tested as written. A tester on a clone install fails R1 on the first reboot. It also leaves open whether an uninstalled server still stops itself when quiet, as the helper does today. If it does, "stable for as long as it runs" is close to today's behavior and the clone user gains little.
fix        Scope R1 to an installed Lahe. Then say in one line what a clone user gets: does the server stay up until logout once started, or stop when quiet as today?
```

### RF3. The brief never says what "a document" is

```
severity   important
kind       defect
where      Summary; R3 ("The address names the document"); R4 ("Documents stay walled off"); R8 ("Every existing document can get an address")
what       The address belongs to "a document", but Lahe has reviews, pages inside a review, linked pages, and the same file reviewed many times.
why        The Library already folds "several reviews of one document" into one row, and one review can hold several pages. If a new `lahe review` of the same brief gets `stable-addresses-2`, Ken's history fills with near-duplicates and the old address shows an old review. If each linked page is its own origin, links between pages and relative images could break. This brief itself links to the decisions page. These are product choices Ken would notice, not build details.
fix        Add one sentence defining the unit: an address names one file on disk. Add two requirements: (a) serving the same file again, in any review, gives the same address; (b) links between Lahe pages, and images and styles a page loads by relative path, keep working. If (a) is not wanted, say what Ken sees instead.
```

### RF4. Docs in worktrees, Ken's most common case, are left out by accident

```
severity   important
kind       risk
where      Non-Goals, third bullet ("Not a better story for deleted or moved files"); Questions, "how long a document keeps its name"
what       Most of Ken's feature docs, this brief included, are written in a worktree that is torn down once the feature merges. The same file then lives on in the main checkout.
why        Under the brief as written, every feature doc's address turns into "this file is gone" the day its worktree is removed. That is a dead tab with a nicer message. Ken said deleted docs are not his concern; a worktree doc is not deleted, it moved. The Library already serves "the main-repo copy of a worktree" on pick-up, so the idea exists in the product.
fix        Add an open question for Ken: when a worktree is gone, should its addresses serve the main-checkout copy of the same file? If he says no, name worktree teardown in the non-goal, so the gap is chosen rather than missed.
```

### RF5. "Light when idle" measures the wrong idle

```
severity   important
kind       risk
where      R11 ("Light when idle")
what       R11 measures the server with nothing open, but Ken's normal state is many Lahe tabs open across days.
why        Today most of those tabs are dead, so they cost nothing. Once every address answers, every open tab is live and polls the helper. The bulletin row LAHE-idle-battery-cost (battery drain with review tabs open, with a visible tab polling once a second) shows this is where the cost is. "No CPU" is also an absolute no test can pass, since the helper already runs 15-second checks.
fix        Measure two cases: nothing open, and a realistic count of open tabs (taken from Ken's own browser) left overnight. Replace "no CPU" with a number the plan sets and then measures.
```

### RF6. Which systems get the `.lahe` setup in this feature is unclear

```
severity   important
kind       risk
where      R6 (".lahe with a fallback"); R7 ("Starts at login on every system"); decisions page, "Your rule for this"
what       The decisions page calls the `.lahe` ending "an optional extra per system". The brief reads as if the one-time `.lahe` setup ships for macOS, Linux and Windows at once.
why        Each system sets up name lookup differently. The plan cannot size the work, and a tester cannot tell whether Linux or Windows on `.lahe.localhost` passes or fails.
fix        State it: the login item ships on all three systems. The `.lahe` setup ships on the systems Ken names now (likely macOS), and the others use `.lahe.localhost` until it is added. Put each system that is left out under Non-Goals.
```

### RF7. "Not a change to agent sessions" is not true, and agents will act on it

```
severity   important
kind       defect
where      Non-Goals, sixth bullet ("Not a change to agent sessions, takeover, or the monitor"); R12 ("Agents are told")
what       Sessions stop owning page servers. Closing a session no longer stops anything. Takeover no longer reopens servers. The helper's stop-when-quiet rule and the reopened-session sweep lose their reason to exist.
why        A reader, or an architect agent, will take "not a change" at its word and leave those rules in place or skip their docs. R12's list of docs to update leaves out `docs/ongoing/LIBRARY.md` (its "Helper lifetime" section) and `docs/ongoing/SESSION_OWNERSHIP.md`, which describe exactly these rules.
fix        Reword the non-goal: "Sessions keep owning reviews, takeover and the monitor. What changes is that a session no longer starts or stops page servers." Add the two missing docs to R12's list.
```

### RF8. Three requirements are hidden in other sections

```
severity   minor
kind       defect
where      UX Notes, fourth bullet (the Library at `library.lahe`); Non-Goals, first and third bullets
what       The Library's own stable address, the "this file is gone" page, and "the Library's Open moves an old tab to its stable address" are all promises, but none is a numbered requirement.
why        Promises outside Requirements do not reach the plan's test list. The Library bookmark is the one Ken uses to get back to everything else, so it matters most. A document whose name comes out as `library` would also clash with it.
fix        Promote the Library address and the gone-file page to requirements. Say that `library` and any other names Lahe uses itself are reserved.
```

### RF9. Most names will come from file names, not titles

```
severity   minor
kind       risk
where      R3 ("The address names the document"); Summary example `stable-addresses.lahe`
what       A name is fixed the first time a page is served, but the bulletin row LAHE-title-recorded-late says a page's title is only recorded once someone comments.
why        Most addresses will be built from file names, like `01-brief-stable-addresses`, not from titles. Common names like `README`, `index` or `progress` will collide often and need tags. The brief's example sets an expectation the product will not meet.
fix        Use a realistic example built from a file name. Either say the title is read from the file when it is first served, or say the file name is used first. Add a non-goal: renaming a row in the Library does not change its address.
```

### RF10. The related bulletin rows are not named

```
severity   minor
kind       defect
where      Problem section; R10 ("Only this computer can reach it")
what       Four open rows are closed or changed by this feature: LAHE-static-server-host-check (filed twice: page servers do not check the Host header), LAHE-idle-battery-cost (finished sessions' page servers keep running), LAHE-library-quiet-close-no-self-stop (the helper stays up after a Library close), and LAHE-title-recorded-late (titles are only recorded after a comment).
why        Without them, cleanup will not close them, and the architect will not know R10 has already been found twice by security review.
fix        Add a "Related rows" line under Problem naming each row and what this feature does to it.
```

### RF11. A port clash and a mistyped name do not say what Ken sees

```
severity   minor
kind       defect
where      R5 ("One port for every document"); R10 ("Only this computer can reach it")
what       R5 reports a port clash only in the log and `lahe status`, and says the port is "picked once at install", with no word on clone use. R10 refuses an unknown host, but does not say what a mistyped `something.lahe` name shows.
why        When the port is taken, every document is dead and the browser says only "can't connect". Ken will not think to run `lahe status`. A typo under Lahe's own ending is a Lahe name, not a foreign site, and a bare refusal looks like a dead tab.
fix        Have `lahe review` also print the clash and what to do about it. Say that the port is never changed on its own, since a change kills every address. Say that an unknown name under a Lahe ending shows a short "no document by that name" page with a link to the Library.
```

### RF12. Style: a bare requirement number, absolutes, and a broken link

```
severity   minor
kind       defect
where      Rollout / Flags, first sentence; R3, R6, UX Notes; parts/brief/questions.md line 3
what       (a) Rollout says "as described under R7" with no description. (b) Absolutes: "once, ever" (R6), "never changes" (R3), "never dies" (UX Notes), "no CPU" (R11). (c) The questions file links to `../../../../ongoing/STABLE_ADDRESSES.md`. That path is right from `parts/brief/`, but the build inlines the file into the brief without rewriting links, so in the built brief it points outside `docs/`.
why        (a) sends Ken hunting for the requirement. (b) Absolutes are claims a test will catch out: reinstalling, or a new Node, asks for the password again. (c) The link Ken is most likely to click is dead.
fix        (a) "as described under R7 (starts at login on every system)". (b) "asks for an admin password once at setup"; "does not change"; "keeps working". (c) Write the link relative to the brief's folder (`../../ongoing/STABLE_ADDRESSES.md`), as the brief body does.
```

## Smaller notes, no finding

- The evidence is good. One strong data point from the crucible is missing: the decisions page's own server stopped mid-review, two minutes after its window lost focus. It is worth one sentence under Problem.
- Old drafts saved under today's random-port addresses cannot be recovered. The first non-goal covers old tabs; adding "or their drafts" makes the trade explicit.
- Nothing to cut. The Analytics and Rollout sections are the right size.
