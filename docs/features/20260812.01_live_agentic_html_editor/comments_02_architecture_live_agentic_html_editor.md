# Review comments: Architecture: Live Agentic HTML Editor

_Doc: 02_architecture_live_agentic_html_editor.html · saved 2026-08-12T16:22:02 · 12 comment(s)_

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

