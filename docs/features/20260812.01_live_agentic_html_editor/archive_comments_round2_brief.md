# Review comments: Feature Brief: Live Agentic HTML Editor

_Doc: 01_brief_live_agentic_html_editor.html · 65 comment(s) · exported 2026-08-12T19:41:30.489Z_

## 1. (no section) [DONE]

> placeholder in their pandoc header:
>          ~/.claude/skills/feature-forge/assets/feature_pandoc_header.html
>          ~/.claude/skills/research-report/assets/report_pandoc_header.html
>        The injector is shared-assets/shared_assets.py. Edit the module here and
>        the next build of either doc set picks it up. Do not copy it back into a
>        header: two copies is the drift this file exists to end.
> 
>        What it gives a reader: highlight any passage, press Cmd/Ctrl+Shift+C (or
>        click the Comment button that pops up), and type straight into the
>        auto-focused box. Comments save to localStorage on every keystroke and
>        POST to the comment helper (feature-forge scripts/comment_server.py, port
>        8377) when it is running, which writes comments_.md next to the doc.
>        Copy for Claude / Export .md cover the no-helper case.
> 
>        It styles itself from the host header's --ink / --accent / --rule /
>        --accent-soft variables, which both headers define.

for some reason all our latest docs have had this visible weird header meta data or something. it doesn't bother me that much but if we're publishing this we need to get rid of it

## 2. Context [DONE]

> Their storage design is careful and well tested.
> Their liveness design, the part deciding when work
> moves from the screen into storage, has no browser-level test at all,
> and every symptom lives there. Our comments module survives because it
> barely has a liveness layer.

well tested does not mean well designed. but i do agree we should make some tests for ours. 

## 3. Goal / Problem [DONE]

> Build a standalone JavaScript library that anyone adds to any
> HTML page with one script tag,

this is an architecture level detail. it's probably right. but the goal does not contain architecture details

- Build a library that can be added to any locally run HTML page, by anyone, and allows for live editing, commenting that is auto-read by an agent, and agent communication that can appear on the page without having to go read the chat (which is constantly scrolling and loses the important agent requests quickly). 

## 4. Goal / Problem [DONE]

> plus a small local server the library posts to

again, this is an implementation detail. let's recheck the feature forge skill. doesn't it state that we don't put implementation details in the spec? if it got removed during one of our recent edits, we need to add it back

additionally, our current version of the comments module can run without the server, having fallbacks like the copy for claude and export md buttons. 

## 5. Goal / Problem [DONE]

> Everything the
> reviewer leaves is written to a file their coding agent reads.

The library needs to enable live editing and agentic editing simulatenously without clobbering each other's work. 

## 6. Goal / Problem [DONE]

> That is the whole product. One script tag, one background process,
> one file the agent reads. It is our comments module with live editing
> added, packaged so Ken, his students, and anyone else can wire it into
> their own pages.

remove

## 7. Goal / Problem [DONE]

> The bar is not features, it is trust. A reviewer has to spend an hour
> leaving feedback and never once wonder whether it survived.

Trust is an important aspect of this product. Reviewers work hard leaving feedback and making edits, and we cannot lose their work or clobber their work. 

## 8. Non-Goals [DONE]

> Not a workflow tool

Not integrated into or relying on our existing tools. It should be stand alone, not requiring feature forge or research report skills. those skills, or any other user's skills, should be able to easily insert this module into any locally run or opened HTML. 

## 9. Non-Goals [DONE]

> Not something that writes into an agent's
> configuration. No installing skill files, no editing
> instruction files, no assumptions about which agent the reviewer uses.
> The agent contract is a file on disk; how a reviewer points their agent
> at it is their business.

i don't mind having a simple install file. i never said not to do this. you misunderstood me. other users should be able to clone this repo and then run a command to set it up, or just ask their agent to make sure it's ready to be used. or just ask their agent to add it to something they're working on

## 10. Non-Goals [DONE]

> Not a build-step dependency. Adding the library to
> a page must not require the host page to have a bundler, a package
> manager, or a build.

architecture level requirement. not in the brief

## 11. Non-Goals [DONE]

> Not multiplayer. One reviewer, one outbox. No replies, no threads,
> no second author.

as this is local, it will have one human reviewer. but it might have multiple agents, esp if the core agent is acting as orchestrator and sending off subagents to do the work that the comments describe


## 12. Non-Goals [DONE]

> Not reviewing pages the reviewer did not produce. v1 assumes the
> page is the reviewer's own.

not really a requirement. as long as its running local, i don't care where it came from. it's on the users computer and they're reviewing it. i could be reviewing a doc chris sent me

## 13. Non-Goals [DONE]

> Not mobile, and not Windows in v1. macOS first, Chromium only.

given that it's probably going to be using standard languages and libraries like js, node, python, it will be pretty platform independent. we just need to list the requirements to run. and i'm not sure why you say chromium only. are we using js features that only chrome has? that's probably not a great idea

## 14. Non-Goals [DONE]

> Not an agent. It collects feedback and hands it off. Applying it is
> the agent's job.

sure. but agent agnostic would be good. like codex should be able to use it too

## 15. Non-Goals [DONE]

> User Stories

new story
- at the end of a session, i want a list of all the human edits that were made, so that we can review and see if there is anything we should add to our writing style guide, compounding our learnings

## 16. User Stories [DONE]

> so the agent gets my exact words instead of a note describing
> them.

and i want my exact words to remain on the page. I do not want the agent to rewrite them into the page, potentially changing them.  (I've had sentences where I asked the agent to put exact words in, and where I used a comma, it put an em dash)

## 17. User Stories [DONE]

> and send the whole walk at once.

with comments going to the agent in real time so that I can keep clicking around and exploring the page leaving feedback without waiting for the agent. 

## 18. User Stories [DONE]

> As Ken mid-review, I want to click a button in the
> app to reach the next screen without leaving the review or losing what I
> typed.

and i want all buttons links and interactivity to continue to work. (if this comes at the cost of having to hit a keystroke in order to do inline editing, that might be acceptable). for example right now i can hightlight and hit something like cmd-shift-c to leave a comment. maybe cmd-shift-e creates inline edit. but don't do that just because i am throwing ideas out. think through it

## 19. User Stories [DONE]

> I want to send anyway
> and have it waiting when I next start one.

i want a way to grab my comments (we currently have a copy button and an export button that work well). not sure what this story would require as it is written now. it sounds complicated

## 20. User Stories [DONE]

> giving before and
> after text for each edit, so I make targeted changes instead of
> regenerating a document.

i believe some of my versions of this module even include html in the reference, so that we can see things like element ids

## 21. User Stories [DONE]

> As a coding agent that finished

as a coding agent that could not complete a task, i want to report back to the html that a task could not be completed. 

as ken, when a task is completed, i want the highlight to be removed, and i want the comment to move out of the main comments thread and into a completed/archived thread

## 22. User Stories [DONE]

> As one of Ken's students, I want to add one script
> tag to my own page, start one process, and be reviewing, without
> learning a workflow.

as any new user, i want easy install that allows me to quickly plug this into my documents and get started. i want to be able to figure it out without having to read instructions (tooltips, etc)

## 23. The library [DONE]

> R1: One script tag, any HTML page. Adding the
> library is one line in the page's markup. It needs no bundler, no
> package manager, and no build step in the host page.

implementatino detail. the requirement is that we make something that goes into any html page

## 24. The library [DONE]

> R2: Configuration travels on the tag. Where the
> server is, and which review this page belongs to, are attributes on the
> script tag. There is no config file to create and no project to
> register.

architecture

## 25. The library [DONE]

> R4: The library does not fight the page's own
> JavaScript. It does not break the host page's event handling,
> its framework, or its routing, and it survives the page re-rendering
> parts of itself.

kinda architecture level. this is more like

- the module does not break functionality on the page, including native links, interactivity, javascript event handling, etc. 

## 26. The library [DONE]

> R5: Nothing the library adds can end up in the reviewer's
> feedback. Its own markup, highlights, chips, and panels are
> never part of a quoted passage, an edit, or anything handed to the
> agent.

kinda confused why we need this one

## 27. The library [DONE]

> Nothing is ever taken back

rewrite
The users work is never clobbered

## 28. Nothing is ever taken back [DONE]

> R9: Sending never depends on an agent being present.
> Send is available whenever unsent feedback exists. Agent presence is
> information shown to the reviewer, never a gate.

this assumes things need to be sent, where our current module actually works on polling

## 29. Nothing is ever taken back [DONE]

> R10: Send sends everything on screen, including the
> sentence typed a moment before pressing it.

again, i kinda don't want to wait to send things most of the time. i want to just work and have the agent working with me as we go

## 30. Nothing is ever taken back [DONE]

> R11: Outstanding feedback is one queue, not a frozen
> snapshot. Sending again while an earlier send is unconfirmed
> adds to what is outstanding rather than replacing it.

there's some assumptions about how this works mechanically, that are leaning too much on the human-review lib. the way we did it with the comments module was better

## 31. Nothing is ever taken back [DONE]

> R12: Feedback is offered until an agent confirms it, and
> applied once. A confirmation naming something never delivered
> is refused, so a stale confirmation cannot erase newer feedback.

i don't really understand this. but it kinda sounds like the feature we made where a comment isn't acted on until you hit cmd-enter to confirm the comment is done?

## 32. Nothing is ever taken back [DONE]

> R13: Failures are loud and they persist. A failed
> send, a server that cannot be reached, an item that could not be placed:
> each stays visible in a state the reviewer can still see a minute later.
> The library never shows a success state for something that did not
> succeed.

sure, but if a server isn't running and i don't care to start it, don't force the error to stay on the page. let me dismiss it. 

## 33. Nothing is ever taken back [DONE]

> R14

yes good

## 34. Nothing is ever taken back [DONE]

> R15: A second window on the same page does not cost the
> reviewer work. It joins the same review or is refused with a
> reason, and never accumulates separate feedback that overwrites.

interesting. i guess this is a good idea, but i'm curious if it makes it way more complicated

## 35. Commenting [DONE]

> R17: Comment on selected text. Select a passage,
> take one action, type a note. The passage is marked in the page and the
> note appears keyed to it.

"one action" can be clicking a button or hitting a hotkey. when opening a comment it should always receive focus so the user can start typing immeditaely 

## 36. Commenting [DONE]

> R18: Comment on a whole element by holding Alt and
> clicking it, for when the problem is not in the words: an image, a
> diagram, a chart, a card, a section. A plain click never opens a
> compose box, because a plain click places the text cursor.

interesting idea. this one is going to be harder to discover. i wonder if a double click would make sense. or maybe cmd-click since we use cmd for our other keystrokes

## 37. Commenting [DONE]

>  because a plain click places the text cursor.

i think we may need to be careful with this. we might want to have a keystroke/button to open the inline editor. that may make all this functionality a lot easier to implement

## 38. Commenting [DONE]

> R23: A note tied to nothing is first-class feedback.
> It counts as unsent feedback for R9 (send is available whenever unsent
> feedback exists) and can be sent alone with no comments and no
> edits.

right now we don't have a place for that. but it would be good to add an open comment box at the bottom of the comments thread

## 39. Commenting [DONE]

> a description of the element.

not sure what this means. but would be ok with inlcuding some html, but like hidden in the bg. i don't want to try and read html in the comments section. 

this is getting into architecture, but i wonder if we should use javascript to add IDs to elements when we comment on them. or maybe unique classnames since there can only be one id. 

## 40. Editing the page [DONE]

> bulleted and numbered lists

we don't even need these. i can ask for those to the agent. just really basic stuff is ok for now

## 41. Editing the page [DONE]

> R28: Images can be resized and moved, keeping the
> size the reviewer gave them. Pasting a new image is cut from v1: it is
> the one action that would force the library to write a file.

if this is hard i'm ok with it slipping. it would be better than asking the agent to resize, but only if it actually works well, and it might be difficult to get working well. 

## 42. Editing the page [DONE]

> reordered

reorder is just folded into this deletion criteria but has no real requirement. reordering is a little harder that just "whole blocks can be reordered". need to think about how. that's a thing that may break some stuff if we dont do it well

## 43. Editing the page [DONE]

> R32: Region names are stable and distinct. Two
> separate edits never collapse into one, and no edit is silently
> overwritten by another that happened to be named the same.

"region" isn't really defined here, so this requirement is hazy

## 44. Editing the page [DONE]

> R34: The reviewer can see every edit they have made,
> listed by region, without leaving the page.

maybe hand edits get their own tab in the comments thread? not sure. maybe it's good to see them in the list. but no, i want the comments thread to get shorter as things are completed, so hand edits will need their own tab. and completed comment edits will need to go to their own tab

## 45. Using the page while
reviewing it [DONE]

> R35: A plain click while editing does not fire the page's own
> behavior. Links do not navigate, buttons do not act, forms do
> not submit, because a plain click places the cursor.

this is in direct conflict with the earlier requirement that everything on the page continue to work. NO. everything on the page working is the higher priority, so if we need to use a keystroke or button to edit text, that's fine

## 46. Using the page while
reviewing it [DONE]

> R36: The reviewer can use the page for real, and it is
> obvious how. An editing toggle turns interception off for a
> stretch and gives back an ordinary page. Holding Cmd and clicking a link
> follows it. Both are taught on screen rather than in documentation.

yeah ok this is decent. having a mode to switch back and forth might work. or just clicking each time? hmm. i see this one requires thought

## 47. What the agent gets [DONE]

> R38: One file per review, readable by a person.
> Every send writes a plain markdown record at a documented location,
> grouped by page, listing comments with their quoted subject and edits
> with their before and after. This is the whole handoff contract.

no, i disagree. that is not how we did this before. also this is an implementation detail that should go in the architecture. i want side by side editing, not a file handoff where then i have to wait for the agent to resopnd to 50 comments. but if you just mean everything that we do in the editing goes into a single file as we go, then that could work. this is kind of an implementation detail

## 48. What the agent gets [DONE]

> R39: A structured file alongside it carrying the
> same content with identifiers, for an agent that would rather parse than
> read.

doesn't this contradict 38? i would rather just have one file that is for the agent

## 49. What the agent gets [DONE]

> R40: The reviewer's own words are never truncated on the way
> through. A clipped after becomes an agent
> faithfully truncating the reviewer's own paragraph. Text quoted out of
> the page is a search key rather than the reviewer's intent, so it may be
> bounded, visibly.

not really sure what this means but it sounds like a response to a real situation

## 50. What the agent gets [DONE]

> R38: One file per review, readable by a person.
> Every send writes a plain markdown record at a documented location,
> grouped by page, listing comments with their quoted subject and edits
> with their before and after. This is the whole handoff contract.

i'm open to thinking through a database implementation as well. i think someone i met at a recent event said their did their inline editor with a db. 

## 51. What the agent gets [DONE]

>  never a document rewrite.

this is big. never rewrite the whole doc

## 52. What the agent gets [DONE]

> R44: The agent can write back to the reviewer, in the
> page. When it cannot apply an item, applied it differently, or
> has a question, it attaches a message the reviewer reads on that item's
> own card.

we'll need to refine the ux for this live, because we need to make sure the user can see it

## 53. Keeping up with the agent [DONE]

> R46

good


## 54. Keeping up with the agent [DONE]

> R47

good

## 55. Keeping up with the agent [DONE]

> R48

good

## 56. Install and safety [DONE]

> R49

really i just want install to be easy and doable by an agent. and one source of truth, so no nmp and github. 

## 57. Install and safety [DONE]

> R51

sure this is good. should be easy to have the comments module have a signature or something it can send

## 58. Install and safety [DONE]

> R52: Text taken out of a reviewed page is data, never
> instructions. It reaches an agent as something to search on,
> clearly marked, and never as a directive the agent might follow.

sure, i mean edits in general are provided for context, not as instructions

## 59. Install and safety [DONE]

> R53: Nothing the reviewer drops or pastes reaches
> disk, and a file dropped from the desktop does not navigate the
> page away from the review.

implementation detail, and not required here. or at all really. this is a reaction to the human-review implementation

## 60. Success Metrics [DONE]

> Send is never unavailable while unsent feedback
> exists, verified by test.

wrong framing. send isn't our core mechanism

## 61. Open Questions [DONE]

> Q1: Does the library ship as one file or several?
> One file is the simplest thing to add to a page and the easiest to host
> anywhere. Several files are easier to work on and let separate builders
> own separate diffs. A concatenation step gives both, at the cost of a
> generated artifact in the repository.

this is an implementation detail

## 62. Open Questions [DONE]

> Q2: How does a page authorize itself to the server?
> R51 says being open in the browser is not enough. The reviewer has to do
> something deliberate once, and what that something is decides how much
> friction sits between adding the script tag and being able to send.

the user doesn't have to do anything other than ask for the comments module to be included on the page. adding it should take care of everything. that probably means creating the server with some kind of hash that it can send over, or something like that that a public webpage without the module wouldn't have. pretty easy. no user action. also this is implementation detail

## 63. Getting it and running it [DONE]

> Adding it to a page is something a person or their agent
> does in one step.

don't use "it" unless the "the module" has already been used in that requirement. "it" is too ambiguous unless we have already establisehd the reference

## 64. Open Questions [DONE]

> Q1: What is the gesture for entering an inline edit, and for
> commenting on a whole element? R13 (the page keeps working)
> means editing cannot simply be "click and type", and element commenting
> needs something a new user will find. Both need to be worked out
> together rather than picked separately, since they share the same small
> vocabulary of clicks and keys.

i want the keystroke to be one-handed, so let's do cmd-shift-e to edit

## 65. Open Questions [DONE]

> Q2: Is resizing an image by hand worth building? It
> is only worth having if it works well, and if it does not, asking the
> agent is a perfectly good answer.

not at this time
