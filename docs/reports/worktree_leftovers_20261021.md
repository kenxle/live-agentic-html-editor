# Why 77 old checkouts piled up, and how to stop it

Updated 2026-10-21 09:34. I cleaned up 50 LAHE worktrees and 27 old clones this morning. This page says why they stayed up and proposes three fixes. Each fix needs one click from you. I recommend all three.

## What I need from you

<div class="choice" data-choice="sweep-command">
<p class="choice-q">Add a sweep command to LAHE that finds finished worktrees and removes them safely?</p>
<button type="button" value="build" data-recommended>Build it</button>
<button type="button" value="skip">Skip</button>
</div>

<div class="choice" data-choice="forge-cleanup-teardown">
<p class="choice-q">Change forge-cleanup's teardown step so it also removes the builders' worktrees, not only the one the session runs in?</p>
<button type="button" value="fix" data-recommended>Fix the step</button>
<button type="button" value="skip">Skip</button>
</div>

<div class="choice" data-choice="allow-worktree-remove">
<p class="choice-q">Let an agent remove a merged worktree at cleanup without asking you first?</p>
<button type="button" value="allow" data-recommended>Allow it</button>
<button type="button" value="keep">Keep asking</button>
</div>

The details of each fix are in [the fixes](#the-fixes) below.

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
<span class="badge badge--purple">Recommended</span>
<p class="eyebrow">Fix 1</p>
<h4>A sweep command in LAHE</h4>
<p><code>npm run worktrees:sweep</code> lists every worktree and says, for each one, whether its branch is on main and whether anything in it is worth keeping. With <code>--apply</code> it removes the safe ones.</p>
<ul>
<li>Safe means: the branch is merged (or its changes are already on main), nothing is running in it, and the only uncommitted files are ones the build makes: <code>node_modules</code>, the layer bundle, <code>package-lock.json</code>, and the four screenshots the gate rewrites.</li>
<li>Any other uncommitted change is saved as a patch outside the repo before removal.</li>
<li>It never touches <code>/tmp</code>, an unmerged branch, or a branch you haven't pushed.</li>
<li>It also prints one line at the start of a session when finished worktrees are waiting.</li>
</ul>
</div>
<div class="option">
<span class="badge badge--purple">Recommended</span>
<p class="eyebrow">Fix 2</p>
<h4>forge-cleanup tears down the builders' worktrees</h4>
<p>The last step lists every worktree made for the feature, not only the session's own. It runs the repo's sweep when the repo has one, and plain <code>git worktree remove</code> after the merged check when it doesn't.</p>
<ul>
<li>This is your global skill, so it changes cleanup in every project.</li>
</ul>
</div>
<div class="option">
<span class="badge badge--purple">Recommended</span>
<p class="eyebrow">Fix 3</p>
<h4>Removing a merged worktree is allowed at cleanup</h4>
<p>Add one exception to the no-delete rule: at cleanup, an agent may remove a worktree the sweep calls safe, without asking. It uses <code>git worktree remove</code>, not <code>rm</code>, so it doesn't stop you with a prompt.</p>
<ul>
<li>Every other deletion still waits for your batch.</li>
<li>I'd update the LAHE CLAUDE.md line and the memory note that now says to list it for the batch.</li>
</ul>
</div>
</div>

## What's still around

- `/private/tmp/lahe-codex-event-wake` is merged. I left it, because nothing under `/tmp` gets removed. The OS will clear it.
- The 27 clones are in `~/.Trash/lahe-worktrees-20261021`. Empty the Trash to free 1.2 GB.
- One uncommitted change never landed: a September rewording of the failure messages in `src/shared/failures.js`. It's saved in `~/Documents/lahe-worktree-cleanup-20261021/` in case you want it.
- The local branches are all still there. Removing a worktree doesn't delete its branch.
