# Brief reviews: Style switcher

Requirement numbers below are the draft's. The draft had fifteen; the brief now has thirteen, so R11, R14 and R15 here are not the brief's current R11 to R13.

## PM Review (Round 1)

The brief is close to ready. It has no architecture leaks worth blocking on. The findings below are ordered worst first.

**RF1. important. R8 may not hold for paid styles.**
R8 promises that a kept style still shows in a saved Markdown file "with no Lahe running, as the house style does today." The house style is inlined, but the paid styles self-host fonts from `./fonts/` (crucible line 35). A saved file would need its CSS and fonts to travel with it. Either say what travels, or narrow R8 to "anywhere Lahe serves it" plus "a saved file keeps the style line, and the fonts come with it or degrade to fallback fonts."

**RF2. important. Nothing covers the keep action when no agent answers.**
The crucible lists "keeping depends on an agent being there" as a con. R6 and the metric assume an agent replies. Add a requirement for what the reviewer sees after "Use this style": the request is pending, then applied, and the preview clears. The brief should also say what happens if they press it twice.

**RF3. important. "Valid style" is never defined (R10).**
R10 says a bad folder is refused with "what a style folder needs," but the brief never says what that is. A tester cannot write the refusal cases. State the headline contract in product terms: a name, a stylesheet, optional fonts, and the stylesheet may not pull anything from the network.

**RF4. important. R14's network rule has no product-level test.**
"Cannot load anything from the network" could mean refusing at install, blocking at serve time, or both. Say which the reviewer sees. Install refusal is the testable choice, and it ties into RF3.

**RF5. minor. A reviewer cannot discard a preview.**
R5 says the rail announces a preview. R4 says the preview survives reloads until the reviewer picks another style. Nothing lets them return to "what the document carries." Add "Reset to the document's own style" to R4 or R5. Without it, a reviewer who previewed Poster and changed their mind has to click the current style by name.

**RF6. minor. R7 and R14 lean toward implementation.**
"Servable" and "reaches an agent that only reads the review file" are how-to-build statements. The second is also a repo rule in CLAUDE.md, not a user outcome. Reword R7 as "the agent applies the style correctly from its instructions alone." Reword R14 as "a style cannot expose or load anything beyond its own stylesheet and fonts."

**RF7. minor. R15 is a build constraint and a test-data rule, not a product requirement.**
Both halves are already in CLAUDE.md. Move them to Non-Goals ("no paid style in the repo" is already there) or to the plan. Keep one acceptance line: a made-up style passes the same flow as the metric. Right now the metric only works on Ken's machine and cannot run in CI.

**RF8. minor. R11 duplicates R2 and R12.**
R2 already puts the International Style first, and R12 covers the nothing-installed case. Fold R11 into R2. This supports Ken's "keep it small" preference: 15 requirements can be 13.

**RF9. minor. No way to remove a style (R9).**
Install and list exist, but nothing removes a style. A buyer who installs the wrong folder will notice. Add a non-goal ("no uninstall command; delete the style's folder by hand") or a one-line requirement. The non-goal is cheaper and is probably right for now.

**RF10. minor. The preview's scope in R4 is ambiguous.**
"That page in that browser" does not say what identifies a page. The same file opened in a second tab, or served under a different review, should probably behave predictably. One sentence is enough.

**RF11. taste. UX Notes carry design decisions.**
"Reached from the head menu, drawn like the end-review panel" and the colour strip per row are design choices. They are fine as guidance. Mark them as suggestions so the architecture phase can change them without reopening the brief.

**RF12. taste. The open question about the store link should decide itself.**
Ken waived the gate, and the question is low-stakes. R12 says "one line saying how to add a style." Drop the link from the brief, keep the line, and let Ken add the link in implementation review if he wants it. That removes the only open item.

**Not a finding:** the problem statement is honest that the evidence is Ken's intent plus a public claim, not buyer pull. The scope is right-sized, and the non-goals hold back the likely creep (style editing, dark mode, per-style Mermaid colours). The empty PM Review table is expected.
