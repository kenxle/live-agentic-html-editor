# Review log: re0a9463eeeab

**Pages reviewed:** /00_decision-beda7a33299eb550.html

**Items:** 4 total, 3 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **note** · get me a progress on this page so we can finish what we need and close this
2. **comment** · we determined in an earlier session that this wasn't about mac memory, but was about so...
3. **comment** · leave it for now
4. **note** · run your forge-cleanup and let's get this closed

---

## 1. note · (no anchor)

`itm_cdf688e66b8a7f48c7645998` · 

**Ken wrote:**

> get me a progress on this page so we can finish what we need and close this

**Reply (handled):**

> Added a To close this out list at the top. Two of the four items are done. One is your call: turn off Claude Code's low-memory shutdowns, yes or no. The last is the leaked-helper fix, which is being built now. Once it merges, this page is done.

---

## 2. comment · li 3

`itm_4597eada8a08fe5ab9d79823` · 

**Ken wrote:**

> we determined in an earlier session that this wasn't about mac memory, but was about something else. can you search online to confirm this behavior? the diagnosis has been different between sessions, so i don't trust the first guess

**Pointing at:**

> Claude Code sometimes stops background commands when the Mac is short on memory, and the watcher is one of them.

**Reply (handled):**

> Checked against Anthropic's own docs and their open bug reports; the sources are linked on the page under your call. You and the earlier session were right that macOS isn't the one doing it. Claude Code stops idle background commands itself when it reads the OS memory signal as critical. Three open issues report that signal misfiring on healthy machines. Last night your Mac really was under pressure from the leak, but the misfire means it can also happen without that. I recommend turning it off. Say yes and I'll add the setting.

---

## 3. comment · li 3

`itm_524f57dfbd8453dfa85f4e54` · 

**Ken wrote:**

> leave it for now

**Pointing at:**

> Your call: stop the low-memory shutdowns. Claude Code sometimes stops background commands when the Mac is short on memory, and the watcher is one of them. Adding CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1 to your Claude Code settings turns that off for sessions started afterward. Say yes or no on this line. The memory shortage that set it off is fixed (next item), so this matters less than it did.

**Reply (handled):**

> Left off. I've ticked that line on the page as decided.

---

## 4. note · (no anchor)

`itm_d5c8b8057e28ff3697335465` · 

**Ken wrote:**

> run your forge-cleanup and let's get this closed

**No reply recorded.**

---
