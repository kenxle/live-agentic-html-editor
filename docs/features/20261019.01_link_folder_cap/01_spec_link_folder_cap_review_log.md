# Review log: rea6a106e5c29

**Pages reviewed:** /.claude/worktrees/link-folder-cap/docs/features/20261019.01_link_folder_cap/01_spec_link_folder_cap.html

**Items:** 3 total, 3 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **comment** · i'm pretty sure this was an old document that had been left open too long an di was jus...
2. **note** · yeah, it never told me that it updated user level claude md to change the styles. i jus...
3. **comment** · sounds good

---

## 1. comment · Needs your decision, li 1

`itm_701c03abbb992543396239ee` · 

**Ken wrote:**

> i'm pretty sure this was an old document that had been left open too long an di was just trying to close things out and i had it do things that had already gbeen completed. if the work was already done, then scrap this work, or take whichever version is better

**Pointing at:**

> Your main checkout holds two commits from a Codex session, and your pages don't have this fix yet. The Codex session working in feature-forge committed Lahe fixes straight to the main checkout without pushing them. The first one (links reuse a folder the site already serves) shipped inside PR #88. The second, f7255597 ("Give rendered Markdown headings stable fragment targets"), is a different version of the heading ids that main already got from PR #86, and the two conflict in src/service/markdown.js. Until the checkout matches origin/main, your always-on helper runs code without the 64-folder cap. Recommendation: I move f7255597 onto its own branch, codex/heading-fragment-targets, so nothing is lost, and fast-forward the checkout to origin/main. The helper then picks up the fix by itself. I haven't done it because it is another session's work.

**Reply (handled):**

> You were right: f7255597 repeated work PR #86 already did, and main's version is fuller (GitHub-matching ids, pandoc pages too). Main passes every check in that commit's test, so I dropped it, keeping a copy on local branch codex/heading-fragment-targets. Your main checkout now matches origin/main and the helper restarted onto it, so the 64-folder fix is live. The top of the page shows this under Done since.

---

## 2. note · (no anchor)

`itm_beb07d4947dc68f56b9915ef` · 

**Ken wrote:**

> yeah, it never told me that it updated user level claude md to change the styles. i just went over the refactor of the other files. that's weird. and it should apparently be part of our regression suite to ensure that we're using house styles. but honestly it shouldn't rely on the user level claude.md. it should be in the skill to take care of this default style when lahe is available

**Reply (handled):**

> Agreed, and I'm doing it. One correction: your user-level CLAUDE.md has uncommitted edits (the shipping rule, skill agency, Bash safety), but none of them touch styles. The style was lost in the skill files. The MVP's new build script stopped reading the Lahe style. The Codex session's legacy audit (feature-forge docs/features/runbooks/LEGACY_AUDIT.md, 'Rendering compatibility') already lists this gap, but nobody has claimed it. The fix, in a feature-forge worktree: when Lahe is installed, the forge build inlines the Lahe doc style and lays the page out the way the style expects, so the components and the style switcher work. Without Lahe it keeps the plain offline page and prints one line saying the house style was not found. A regression test in feature-forge's suite pins both. Then I'll land it and update your installed skills, backing up the current copies first.

---

## 3. comment · Needs your decision, li 1

`itm_72cda12411a249a48b516803` · 

**Ken wrote:**

> sounds good

**Pointing at:**

> Recommendation: serve only the linked files and their images, then drop the cap. Board row LAHE-linked-folder-scope.

**Reply (handled):**

> Got it. I claimed board row LAHE-linked-folder-scope (serve only linked files and their images, then drop the cap). It gets its own whetstone run and its own spec page. You will see that page before anything merges, because it changes what the page server hands out.

---
