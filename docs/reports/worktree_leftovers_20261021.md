# Why 77 old checkouts piled up, and how to stop it

Updated 2026-10-21 10:01. I cleaned up 50 LAHE worktrees and 27 old clones this morning. This page says why they stayed up and what we're changing. Nothing is waiting on you. Two fixes are done. The Seneschal change is built and in review.

## Where things stand

- **Built and fixed: Seneschal spots finished worktrees.** It's on branch `task/finished-worktrees` in the Seneschal repo, not merged. The first review found six ways it could still remove or trash work that isn't on main. The worst: a whole checkout with a builder worktree inside it could go to the Trash as a "stray clone". All of them are fixed, each with a test that failed first. I ran the suite myself: 340 passed, 0 failed. A second review of the fix found two more holes in the last check before each removal. That check didn't recheck whether a worktree was brand new, and it trusted the report's word on whether a folder was a worktree or a clone. Those and four smaller ones are fixed too: 353 passed, 0 failed, run by me. The final check now runs as part of every removal line Seneschal prints, so it can't be skipped. Last step: the builder is running it on a throwaway repo and taking screenshots of the real cards, which will go here for you to look at before it merges. What it changes is in [the fixes](#the-fixes) below.
- **A call I made:** files git is told to ignore (`.gitignore`) won't stop a worktree from counting as finished. Its card will name them, so you can see them before agreeing. If they blocked removal, files like the commit-message scratch files would pile worktrees up again. Comment here if you'd rather they block.
- **Where it differs from the plan:**
  - A finished worktree with a real uncommitted file gets a card for you, naming the files, instead of a saved patch. The builder's reason: Seneschal shouldn't decide what scratch is worth keeping.
  - Removal uses `git worktree remove --force`, and only when every uncommitted file is a build leftover. Without `--force`, git refuses a worktree that has a `node_modules` folder.
  - A branch squashed into one commit on main isn't recognized as finished yet. It stays in flight.
- **After it merges:** LAHE's `docs/STANDARD.md` gets a `generated_paths` row naming the layer bundle, `package-lock.json` and the gate screenshots, so Seneschal stops counting them as work.

<div class="choice" data-choice="seneschal-finished">
<p class="choice-q">Teach Seneschal to tell a finished worktree from one in use, so its tidy report offers to remove the finished ones?</p>
<button type="button" value="build" data-recommended data-chosen>Build it</button>
<button type="button" value="skip">Skip</button>
</div>

## Done

- **forge-cleanup tears down every worktree made for the feature.** Its last step no longer skips when the orchestrator runs in the main checkout. It now covers the builder, integration, review and subagent worktrees too.
- **No sweep command in LAHE.** That belongs in Seneschal, the question above.
- **A builder worktree, and the orchestrator's own feature worktree, are removed without asking once all their work is on main.** The branch is merged, or its commits reached main through another PR. Build leftovers like `node_modules` don't count as work. Any other uncommitted change is saved as a patch first. LAHE's CLAUDE.md now names this as the one exception to the no-delete rule, and the memory note says the same.

<div class="choice" data-choice="sweep-command">
<p class="choice-q">Add a sweep command to LAHE that finds finished worktrees and removes them safely?</p>
<button type="button" value="build">Build it</button>
<button type="button" value="skip" data-chosen>Skip</button>
</div>

<div class="choice" data-choice="forge-cleanup-teardown">
<p class="choice-q">Change forge-cleanup's teardown step so it also removes the builders' worktrees, not only the one the session runs in?</p>
<button type="button" value="fix" data-recommended data-chosen>Fix the step</button>
<button type="button" value="skip">Skip</button>
</div>

<div class="choice" data-choice="allow-worktree-remove">
<p class="choice-q">Let an agent remove a merged worktree at cleanup without asking you first?</p>
<button type="button" value="allow" data-recommended data-chosen>Allow it</button>
<button type="button" value="keep">Keep asking</button>
</div>

## Why they piled up

<div class="stats">
<div class="stat"><p class="stat-label">Builder worktrees</p><p class="stat-value">33</p><p class="stat-meta">32 from September, most from the Library build</p></div>
<div class="stat"><p class="stat-label">Agent tool worktrees</p><p class="stat-value">7</p><p class="stat-meta">made by subagents run with worktree isolation</p></div>
<div class="stat"><p class="stat-label">Other worktrees</p><p class="stat-value">10</p><p class="stat-meta">beside the repo in the workspace folder</p></div>
<div class="stat"><p class="stat-label">Old clones</p><p class="stat-value">27</p><p class="stat-meta">August build, made with git clone</p></div>
</div>

Every one was merged, or its work had reached main another way. Nothing was running in any of them. Five things let them stay:

- **The teardown step skips builder worktrees.** forge-cleanup's last step removes only the worktree the session itself runs in. A LAHE orchestrator runs in the main checkout, so the step tells it to skip. The builders' worktrees are never mentioned.
- **The teardown step calls a script LAHE doesn't have.** It hands off to `st-worktree`'s teardown script, which only exists in Steady Thread. In LAHE there is nothing to run.
- **The no-delete rule pushes removal to a batch that doesn't happen.** Agents are told to list `git worktree remove` for "the cleanup batch" instead of running it. That batch is the last thing in a session. When a session ends before it, the list goes with the session, and the next session never sees it.
- **Agent tool worktrees only clean up when unchanged.** Claude Code removes a subagent's worktree only when the subagent changed nothing. Every builder commits, so every one was kept.
- **The August clones were invisible.** They were made with `git clone`, not `git worktree add`, so `git worktree list` never showed them. Only a look at the folder found them.

Nothing tells you they are there, either. No check at the start of a session says "12 finished worktrees are still up".

## The fixes

<div class="options">
<div class="option">
<span class="badge badge--outline">In progress</span>
<p class="eyebrow">Fix 1</p>
<h4>Seneschal spots finished worktrees</h4>
<p>Seneschal already lists worktrees and can remove them from its report. Today it would have offered almost none of these. It counts any uncommitted file as work in progress, including <code>node_modules</code> and the screenshots the gate rewrites, and it never asks whether the branch is on main. Three changes:</p>
<ul>
<li><b>Build leftovers don't count as work.</b> Each repo names the files its build makes. For LAHE that's <code>node_modules</code>, the layer bundle, <code>package-lock.json</code> and the four gate screenshots.</li>
<li><b>A merged worktree is finished.</b> The branch is on main, or its changes reached main through another PR. Then the card offers removal. Any other uncommitted change is saved as a patch first.</li>
<li><b>It finds stray clones.</b> Folders beside the repo that are copies of it, like the August ones, show up as cards too.</li>
</ul>
<p>It still never touches <code>/tmp</code>, an unmerged branch or an unpushed one.</p>
</div>
<div class="option">
<span class="badge badge--sage"><span class="badge-dot" aria-hidden="true"></span>Done</span>
<p class="eyebrow">Fix 2</p>
<h4>forge-cleanup tears down every worktree the feature made</h4>
<p>The last step lists every worktree made for the feature: builders, integration, review, subagents and the orchestrator's own. It removes each one whose work is all on main. The step carries its own check for that, so it doesn't wait on Seneschal.</p>
<ul>
<li>This is your global skill, so it changes cleanup in every project.</li>
</ul>
</div>
<div class="option">
<span class="badge badge--sage"><span class="badge-dot" aria-hidden="true"></span>Done</span>
<p class="eyebrow">Fix 3</p>
<h4>Removing a finished worktree is allowed at cleanup</h4>
<p>One exception to the no-delete rule: at cleanup, the orchestrator removes a worktree whose work is all on main, without asking. It uses <code>git worktree remove</code>, not <code>rm</code>, so it doesn't stop you with a prompt.</p>
<ul>
<li>Every other deletion still waits for your batch.</li>
<li>LAHE's CLAUDE.md and the memory note now say this.</li>
</ul>
</div>
</div>

## What's still around

- `/private/tmp/lahe-codex-event-wake` is merged. I left it, because nothing under `/tmp` gets removed. The OS will clear it.
- The 27 clones are in `~/.Trash/lahe-worktrees-20261021`. Empty the Trash to free 1.2 GB.
- One uncommitted change never landed: a September rewording of the failure messages in `src/shared/failures.js`. It's saved in `~/Documents/lahe-worktree-cleanup-20261021/` in case you want it.
- The local branches are all still there. Removing a worktree doesn't delete its branch.
