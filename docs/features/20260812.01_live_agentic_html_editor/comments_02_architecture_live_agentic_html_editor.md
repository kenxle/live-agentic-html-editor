# Review comments: Architecture: Live Agentic HTML Editor

_Doc: 02_architecture_live_agentic_html_editor.html · saved 2026-08-12T16:33:14 · 18 comment(s)_

## 1. Summary

> Two pieces. A library: one JavaScript file added to
> any locally run HTML page, which draws the review surface, records
> everything the reviewer does, and keeps the page fully native the rest
> of the time. A helper: one local background process
> that stores the review durably on disk, gives the agent one file to read
> and one place to answer, and tells the library what the agent said so
> the page can show it.

make into a numbered list

**[DONE]**

## 2. Summary

> There is no send. 

this is an explanation of change that is not needed. remove

**[DONE]**

## 3. Summary

> The reviewer
> works; each finished thing (a confirmed comment, a committed edit)
> becomes a durable record the moment it exists; the
> agent reads records continuously and answers per record; the page shows
> those answers as they arrive

come on. a sentence with four semi-colons? 

**[DONE]**

## 4. Summary

> Neither piece ever needs the other to be alive at the same moment.

, though that is the happy path. 

**[DONE]**

## 5. What carries over, and what
does not

> the
> one idea worth keeping, 

remove

**[DONE]**

## 6. What carries over, and what
does not

> rebuilt on
> the opposite storage philosophy

this is out of context now. don't refer to old changes in reasoning, just explain what we are doing. 

**[DONE]**

## 7. What carries over, and what
does not

> From the dead first architecture draft:

who cares about the dead first draft. just write what we're doing. this is still the architecture doc

**[DONE]**

## 8. What carries over, and what
does not

> the send model, the click-to-edit
> interaction, and the Chromium default are gone, contradicted by the
> brief.

if they're not listed anywhere else anymore, then remove them here. we don't need references to old thinking. it just poisons the context

**[DONE]**

## 9. D1: One file in
the page, one process beside it

> The library is a single built JavaScript file. Adding it to a page is
> one <script> line, which a person or an agent writes;
> an add command in the repo does it for a static file, and
> for a dev server it is one line in a layout. The script line points at
> the built file itself (a path, or a copy in the page's own assets),
> never at the helper: if the helper served the library,
> "the library works alone" would be false the first time the helper was
> down. The repo is the one source (GitHub clone, R40); a build script
> concatenates the source modules into the shipped file, so builders work
> on small files and users add one.
> The helper is a zero-dependency Node process
> (node bin/lahe.js serve). Node 20+ is the only stated
> requirement. Nothing else is platform-specific: the library is standard
> DOM APIs, the helper is standard Node, and macOS, Linux, and Windows all
> run both. The one browser-support note (Custom Highlight API, D10) is
> stated with its reason per R42, and it holds in current Chrome, Edge,
> Safari, and Firefox.

this is kinda multiple decisions, but it's not that big of a deal. 

**[DONE]**

## 10. D1: One file in
the page, one process beside it

> D2

makes sense

**[DONE]**

## 11. D3:
Two page states, browse and edit, with browse fully native

> 
> Grounds R13 (the page keeps working, outranking editing convenience),
> R24, and answers Q1.

these "see" things are great but they should be links

**[DONE]**

## 12. D3:
Two page states, browse and edit, with browse fully native

> Element-pick mode: hover outlines elements, click one to comment on
> it, Esc cancels

this is how we do images and stuff? ok i guess that works

**[DONE]**

## 13. D5:
Durability is browser storage plus an append-only log

> An open edit
> commits automatically on navigation or unload (kept
> synchronously in browser storage, handed to the helper on the way out),
> because browse mode is fully native and a link click is one click: R1
> names navigation, so navigation cannot be a losing move.

maybe if a comment is uncommitted for awhile and the agent sees it's been sitting there iwthout the confirmation it can respond into the thread saying hey you didn't submit this yet. (we've already got the yellow color helping but this could help a noob, and would be pretty magical)

**[DONE]**

## 14. D5:
Durability is browser storage plus an append-only log

> The browser is authoritative for a record's content until the helper
> has acknowledged it; the store is authoritative for lifecycle at
> a given rev: a handled that names rev 1 retires rev 1, and a
> reviewer who reworded to rev 2 offline still has rev 2 outstanding after
> the merge. On load, the library merges both: its own undelivered work
> from browser storage wins on content, the store wins on per-rev
> status.

not sure i understand this fully. would a diagram help?

**[DONE]**

## 15. D5:
Durability is browser storage plus an append-only log

> A second window on the same page is refused with a
> reason pointing at the first. Joining looked cheap until drafts
> entered the picture: two windows sharing one draft bucket is
> last-keystroke-wins, which is silent loss. Refusal costs the reviewer
> nothing and loses nothing.

ah i get it. maybe we have a button that says "move to this tab" and will cause the other tab to deactivate. that way they don't have to go find it in 1000 tabs they have open lol

**[DONE]**

## 16. D5:
Durability is browser storage plus an append-only log

> A review starts when the add step mints it and
> ends when the reviewer archives it from the rail;
> retention (Data and state) ages out only archived and abandoned reviews,
> never a live one.

maybe there's an end review button so we can trigger a review of the human written edits and see if there's style updates to be made. did we end up adding that requirement? i asked but didn't double check to see it got added

**[DONE]**

## 17. D6:
The agent contract is one readable file, and replies are one appended
line

> The helper maintains review.md: one
> file per review, regenerated from the log (atomically: written beside,
> then renamed), human-readable, grouped by page.

do we want a unique naming convention to prevent collisions when multiple docs are open?

**[DONE]**

## 18. D6:
The agent contract is one readable file, and replies are one appended
line

> Two honest notes on this channel. One agent-facing file is a
> deliberate deviation from the usual "JSON is authoritative"
> posture, on Ken's call: agents get one readable file, and the structured
> truth stays in events.jsonl underneath it, available to any
> agent that would rather parse but never required. 

i need you to walk me thorugh this one. if i made a call that is non-standard then i want to talk about it 

**[DONE]**

