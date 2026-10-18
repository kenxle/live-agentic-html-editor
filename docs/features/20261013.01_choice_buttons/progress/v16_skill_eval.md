# V16: a fresh agent writes a choice page from the skill alone

Date: 2026-10-17. Plan row V16, brief R1.

**Result: pass on the first try.** A fresh Sonnet agent was given exactly two files, the branch's installed `SKILL.md` and `references/components.md` (installed with `npm run install-skills` under a temporary `HOME`), and asked for a page with three lesson decisions. It wrote [this page](v16_fresh_agent_page.md): three groups, unique names on the grammar, three `type="button"` buttons each with values on the grammar, no blank line inside a group, one recommendation per group. Every rule the layer's validation checks is met statically; the in-browser arming check runs with the end-to-end walk (V24) on the integrated build.

**What the agent found unclear**, in its words:

- "The skill says each `##` becomes a numbered section, but not whether a `###` lesson heading above a choice group becomes the `page.context.heading`. I assumed it does." It does. The skill's drain bullet now says the nearest heading above the group, of any level.
- "Nothing says how a merge press names its target lesson. I assumed the reader would write that in a comment." That is right, and it is the page author's job to say so in the question when an answer needs a target. Not a skill change: an answer that needs a target is a sign the author should ask in prose, which the skill already says.
