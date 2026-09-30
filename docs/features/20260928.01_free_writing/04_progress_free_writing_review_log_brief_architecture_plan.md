# Review log: rea4d4c9c9ac6

**Pages reviewed:** /01_brief_free_writing.html

**Items:** 12 total, 12 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Hand edits

1. Added ", or even starting the doc from scratch".
3. Changed "Writing must feel like the edit mode the reviewer already has" to "While the existing edit mode can be updated, there should not be a difference between edit and write new, in terms of what the users sees in the editor".
4. Changed "new" to "separate".

## Everything, in order

1. **edit** · Added ", or even starting the doc from scratch".
2. **comment** · can't read this horizontal graph
3. **edit** · Changed "Writing must feel like the edit mode the reviewer already has" to "While the e...
4. **edit** · Changed "new" to "separate".
5. **comment** · I'm leaning towards using TipTap. I just think we're gonna get a lot of free functional...
6. **comment** · For the under a header all I did was edit a header, hit enter, type another line, exit...
7. **comment** · This is interesting, but you know, this is an agentic editor. It's in the name. So I do...
8. **comment** · include
9. **comment** · ohh, like trying to keep rich formatting from a paste? let's board that for later. if w...
10. **comment** · same issues. newlines, headers, basic formatting options
11. **comment** · i guess it's an edit if it comes in at the same time. i don't think we should try to sp...
12. **note** · ok let's finish up the docs please

---

## 1. edit · Context, p 1

`itm_b88c95ec768e3f20a2cac31d` · 

**Hand edit:** Added ", or even starting the doc from scratch".

**Before:**

> Lahe is a co-authoring tool. A reviewer reads a page an agent produced, comments on it, and edits text in place. Editing an existing block works well for small changes. What is missing is the other half of co-authoring: the reviewer writing their own text.

**After:**

> Lahe is a co-authoring tool. A reviewer reads a page an agent produced, comments on it, and edits text in place. Editing an existing block works well for small changes. What is missing is the other half of co-authoring: the reviewer writing their own text, or even starting the doc from scratch.

**Reply (handled):**

> (no text)

---

## 2. comment · Context, pre 1

`itm_796bf4246f64fb1902ead60b` · 

**Ken wrote:**

> can't read this horizontal graph

**Pointing at:**

> #mermaid-1790629471402{font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;fill:#000000;}#mermaid-1790629471402 .error-icon{fill:#552222;}#mermaid-1790629471402 .error-text{fill:#552222;stroke:#552222;}#mermaid-1790629471402 .edge-thickness-normal{stroke-width:2px;}#mermaid-1790629471402 .edge-thickness-thick{stroke-width:3.5px;}#mermaid-1790629471402 .edge-pattern-solid{stroke-dasharray:0;}#mermaid-1790629471402 .edge-pattern-dashed{stroke-dasharray:3;}#mermaid-1790629471402 .edge-pattern-dotted{stroke-dasharray:2;}#mermaid-1790629471402 .marker{fill:#666;stroke:#666;}#mermaid-1790629471402 .marker.cross{stroke:#666;}#mermaid-1790629471402 svg{font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:16px;}#mermaid-1790629471402 .label{font-family:"Hanken Grotesk",system-ui,sans-serif;color:#000000;}#mermaid-1790629471402 .cluster-label text{fill:#333;}#mermaid-1790629471402 .cluster-label span,#mermaid-1790629471402 p{color:#333;}#mermaid-1790629471402 .label text,#mermaid-1790629471402 span,#mermaid-1790629471402 p{fill:#000000;color:#000000;}#mermaid-1790629471402 .node rect,#mermaid-1790629471402 .node circle,#mermaid-1790629471402 .node ellipse,#mermaid-1790629471402 .node polygon,#mermaid-1790629471402 .node path{fill:#eee;stroke:#999;stroke-width:1px;}#mermaid-1790629471402 .flowchart-label text{text-anchor:middle;}#mermaid-1790629471402 .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#mermaid-1790629471402 .node .label{text-align:center;}#mermaid-1790629471402 .node.clickable{cursor:pointer;}#mermaid-1790629471402 .arrowheadPath{fill:#333333;}#mermaid-1790629471402 .edgePath .path{stroke:#666;stroke-width:2.0px;}#mermaid-1790629471402 .flowchart-link{stroke:#666;fill:none;}#mermaid-1790629471402 .edgeLabel{background-color:white;text-align:center;}#mermaid-1790629471402 .edgeLabel rect{opacity:0.5;background-color:white;fill:white;}#mermaid-1790629471402 .labelBkg{background-color:rgba(255, 255, 255, 0.5);}#mermaid-1790629471402 .cl [... bounded here. 896 more characters of page text.]

**Reply (handled):**

> Turned it vertical, top to bottom, and shortened the last two boxes.

---

## 3. edit · Non-Goals, li 1

`itm_2c43ffb631e38f880794aad4` · 

**Hand edit:** Changed "Writing must feel like the edit mode the reviewer already has" to "While the existing edit mode can be updated, there should not be a difference between edit and write new, in terms of what the users sees in the editor".

**Before:**

> A new mode. Writing must feel like the edit mode the reviewer already has.

**After:**

> A new mode. While the existing edit mode can be updated, there should not be a difference between edit and write new, in terms of what the users sees in the editor.

**Reply (handled):**

> (no text)

---

## 4. edit · Writing new text, p 2

`itm_80746bd8cca59c37eb5e1553` · 

**Hand edit:** Changed "new" to "separate".

**Before:**

> R2: Starting to write feels like the edit the reviewer already knows. There is no new mode to learn.

**After:**

> R2: Starting to write feels like the edit the reviewer already knows. There is no separate mode to learn.

**Reply (handled):**

> (no text)

---

## 5. comment · Open Questions, p 1

`itm_a505e99a2fce87e73ce68bf1` · 

**Ken wrote:**

> I'm leaning towards using TipTap. I just think we're gonna get a lot of free functionality if we can get it to integrate well instead of trying to write all of this stuff on our own.

**Pointing at:**

> Q1: Tiptap (a vendored editor library) or Lahe's own editing code as the engine for new writing? Architecture decides, after a spike. The brief holds either way.

**Reply (handled):**

> Recorded your lean in Q1. The architecture will start from Tiptap and use the spike to check the fit, mainly whether it keeps the page's own markup.

---

## 6. comment · Open Questions, p 2

`itm_899e5abc685eb57a04bdfca2` · 

**Ken wrote:**

> For the under a header all I did was edit a header, hit enter, type another line, exit the editor, and then it like made two it made like another line. that said it and one line was still in the header and one line wasn't. It was really weird. I don't know if it was something about what the agent was doing, um, but I that's the best I can give you for reproduction

**Pointing at:**

> Q2: Are there formatting failures beyond the three cases in R14 (bold and italic edits)? The under-a-header case still needs a reproduction.

**Reply (handled):**

> That is enough to go on. Your steps are now the header case in R14. My guess is that Enter inside a header splits the header itself, so the new line starts out nested inside it. The architecture will confirm that.

---

## 7. comment · Open Questions, div 3

`itm_1859972eb367f34424911082` · 

**Ken wrote:**

> This is interesting, but you know, this is an agentic editor. It's in the name. So I don't know that we need to be doing a bunch of design cases for editing without an agent

**Pointing at:**

> Q3 (Ken): On a blank notes document, who writes the file? Two options:
>
> The agent places each paragraph, as it does for any new text. Notes then depend on an agent being attached and awake.
> The tool writes the file itself as you type, and an agent organizes only when asked. Notes then work with no agent. The agent's placement rules and the handled check (R10) would not apply to them.

**Reply (handled):**

> Agreed. The agent writes the notes file like any other new text. I took the question out, and it is recorded under Decisions.

---

## 8. comment · Open Questions, p 4

`itm_e0e7b7dd52fea14d7b02ae4d` · 

**Ken wrote:**

> include

**Pointing at:**

> Q4 (Ken): Are lists in the first cut? Notes are mostly lists, and your chosen approach included them. Or are they a follow-up?

**Reply (handled):**

> Lists are in. R3 now says paragraphs, headers, and lists; the question is closed under Decisions.

---

## 9. comment · Open Questions, p 5

`itm_bd4bc2e95bbf74a75ae7d9de` · 

**Ken wrote:**

> ohh, like trying to keep rich formatting from a paste? let's board that for later. if we get it for free with the tiptap editor then cool. otherwise look and see how expensive it is. it seems like it would be difficult

**Pointing at:**

> Q5 (Ken): Pasting a draft written elsewhere: in scope, or a non-goal for now?

**Reply (handled):**

> Yes, that is what I meant. Rich paste is out, with a board row LAHE-rich-paste. If Tiptap brings it for free we keep it; otherwise the architecture notes what it would cost.

---

## 10. comment · Open Questions, p 6

`itm_b3c5db3eb6f4f638efbd0aa7` · 

**Ken wrote:**

> same issues. newlines, headers, basic formatting options

**Pointing at:**

> Q6 (Ken): You said larger edits to existing text are also lacking. What fails today? Without a case, this stays out of scope with a follow-up row.

**Reply (handled):**

> Then it is the same work. R3 (make paragraphs, headers, lists) and R4 (match the page's styling) now apply to editing an existing block too; the question is closed under Decisions.

---

## 11. comment · Open Questions, p 4

`itm_648471fd784dcf83c36b661d` · 

**Ken wrote:**

> i guess it's an edit if it comes in at the same time. i don't think we should try to split out new edits with some kind of logic

**Pointing at:**

> Q7 (wireframe): When a reviewer is editing an existing block and presses Enter at its end, is the new paragraph part of that edit or new text? One consistent rule, and the reviewer should be able to see which it is.

**Reply (handled):**

> Settled: one sitting is one edit, no splitting logic. Recorded under Decisions, R8 adjusted to match, and the wireframes are being built that way.

---

## 12. note · (no anchor)

`itm_5178739b440eabedc745d10b` · 

**Ken wrote:**

> ok let's finish up the docs please

**Reply (handled):**

> Moving on: the brief is closed, the wireframes are being built, and the architecture follows. The progress page tracks each one.

---
