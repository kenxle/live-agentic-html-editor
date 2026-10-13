# Review log: r903ce60ad715

**Pages reviewed:** /01_brief_stable_addresses.html

**Items:** 12 total, 11 handled, 1 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Hand edits

1. Added "/[file]_[stamp]".

## Everything, in order

1. **edit** · Reopened by the page check: the change landed but the data-lahe-id stamp did not reach...
2. **comment** · ok cool. i guess i'm glad we kept it this way. the primary reason was that i didn't wan...
3. **comment** · ok, then that will be fine. that makes sense
4. **comment** · i mean, mac is linux under the hood, so it should work the same for linux. windows shou...
5. **comment** · the dots are easier to read if that's doable
6. **comment** · i kinda want it to look like lahe
7. **comment** · what copy buttons? and why?
8. **comment** · huh? why?
9. **comment** · what?
10. **comment** · it's decided at setup whether to use .lahe and a system would only do it if it was set up
11. **comment** · ok sounds good. we'll go with .localhost for now
12. **note** · ok im done with the brief. go update the other docs based on these changes

---

## 1. edit · Problem, User, and Context, p 2

`itm_1e793d42148d214412fed1cb` · 

**Ken wrote:**

> Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why.

**Hand edit:** Added "/[file]_[stamp]".

**Before:**

> So Ken cannot use browser history or bookmarks to get back to a document. He routes through the Library or asks an agent, and he reads bare 127.0.0.1:56055 addresses trying to work out what a dead tab was. In his words: "it's the constant dead tabs that i run into and have to try and decipher what they are by the url."

**After:**

> So Ken cannot use browser history or bookmarks to get back to a document. He routes through the Library or asks an agent, and he reads bare 127.0.0.1:56055/[file]_[stamp] addresses trying to work out what a dead tab was. In his words: "it's the constant dead tabs that i run into and have to try and decipher what they are by the url."

**Reply (not_handled):**

> The source is Markdown, built to HTML by the forge build script, and a Markdown paragraph has no place to carry a data-lahe-id attribute. The words are on the page, so the comment still finds its spot by its text.

---

## 2. comment · Non-Goals, li 8

`itm_e84e8682f4d28b628f638f12` · 

**Ken wrote:**

> ok cool. i guess i'm glad we kept it this way. the primary reason was that i didn't want to have to try and keep up with the npm packages in addition to the github and it looks like we're doing that just fine

**Pointing at:**

> he zero-runtime-dependency rule

**Reply (handled):**

> Recorded that reason in the brief: Lahe ships from GitHub only, so there is no npm package to keep in step with the repo.

---

## 3. comment · Solution Outline, code 1

`itm_39f957a369bc516b4923082b` · 

**Ken wrote:**

> ok, then that will be fine. that makes sense

**Pointing at:**

> :<port>

**Reply (handled):**

> Recorded as decided: the setup drops the port on Mac (same admin step as .lahe), with written steps for Linux and Windows. Brief requirement 5 (one port for every document) now names the port-free option, the plan has a Mac forward task with two new tests, and the item is off your Needs-attention list. Still open there: which ending lahe review prints (folder.lahe/file or folder.lahe.localhost/file).

---

## 4. comment · Solution Outline, li 4

`itm_6bdd752504e6b7d0f56df822` · 

**Ken wrote:**

> i mean, mac is linux under the hood, so it should work the same for linux. windows should have similar things as well, so we might as well document them

**Pointing at:**

> On a Mac, an optional setup step, run once with an admin password, also makes the shorter .lahe ending work. Which ending lahe review prints is the open decision in the questions below.

**Reply (handled):**

> Agreed, and done: .lahe is now an option on all three systems, and the install guide will write out the steps for each.
>
> One small correction: a Mac is Unix underneath but not Linux, and the part that matters here, how the computer looks up a name, works differently on each. On a Mac it is one small file. On Linux it is a setting in the name-lookup service most distros run. On Windows it is a rule for the .lahe ending, and that rule cannot name a port, so Lahe would also need to answer on the standard lookup port there. So the setup command does it on Mac, and Linux and Windows get written steps the install spike checks first. Same safety check on all three: Lahe only answers .lahe once it has proved its own lookup is the one answering.
>
> The architecture now has a table of the steps per system, for .lahe and for dropping the port, and the plan's install docs task covers it.

---

## 5. comment · Requirements, p 3

`itm_8ab46696b76206b785d3184f` · 

**Ken wrote:**

> the dots are easier to read if that's doable

**Pointing at:**

> R3. The address names the folder and the file. The folder's name, in lowercase words joined by dashes, comes first: 20261011.02_stable_addresses becomes 20261011-02-stable-addresses. The file's path in that folder comes after the port, as it does today. Two different folders with the same name get a short tag from their parent folder, like notes-personal. A folder keeps its name once it has one. Serving the same file again, in any review, gives the same address.

**Reply (handled):**

> Doable, and done: live-agentic-html-editor.docs.ongoing.lahe/STABLE_ADDRESSES.md. Dots also remove the underscore risk, since dotted names are standard.
>
> What changed to make it safe: Lahe's name check now accepts up to four dotted pieces, and only a whole registered name, never its parent or a longer name under it. The architecture notes that dotted names share parent domains only for cookies, and Lahe uses none. Brief requirement 3, the name rule, the first browser test, and test rows V1 and V8 are updated.
>
> Side note: the doc pages' servers just went idle and stopped (the exact problem this feature fixes). I restarted them on the same addresses; a reload brings the page back.

---

## 6. comment · Requirements, p 5

`itm_7ce4cfbced5452ea2e67784a` · 

**Ken wrote:**

> i kinda want it to look like lahe
> 1483 - that's kinda like lAHE is that one used for any common server software?

**Pointing at:**

> the helper's own port, 7817

**Reply (handled):**

> 1483 is a good pick. It is registered to the AFS License Manager, an old license server almost nobody runs, it is not a port any common dev tool uses, and nothing on your Mac listens on it right now (I checked).
>
> So pages now live on 1483: live-agentic-html-editor-docs-ongoing.lahe.localhost:1483/STABLE_ADDRESSES.md. With the port-80 setup you won't see it at all; it is what shows when the setup is skipped or port 80 is taken.
>
> One adjustment: the helper keeps 7817 for its API, alongside 1483. Pages already written with a Lahe script line point at 127.0.0.1:7817, and moving the helper off it would break them. Both ports are one process, so there is nothing extra running. Updated brief requirement 5 (one port for every document), the architecture, and the plan's listener task.

---

## 7. comment · Open, li 2

`itm_8fff2f0ca9054a5382d81675` · 

**Ken wrote:**

> what copy buttons? and why?

**Pointing at:**

> copy buttons lose the clipboard and need an older copy method;

**Reply (handled):**

> Lahe has four copy buttons:
>
> - the rail's copy button, which copies all your comments as text to paste to an agent when no helper is running;
> - the copy button on the hand-off message you give a new agent;
> - the Library's copy of that same message;
> - 'Copy the command' on a page whose review has gone missing.
>
> Why: browsers only let secure pages use the modern clipboard. http://name.lahe is not secure to the browser, so on a .lahe page those buttons would fail unless we add the older copy method as a backup (it still works, it is just older). On .lahe.localhost nothing changes. I named the four buttons in Q1 so it is clear what is affected.

---

## 8. comment · Open, li 3

`itm_96ac2bd464aa64f9374330a5` · 

**Ken wrote:**

> huh? why?

**Pointing at:**

> the guard against two tabs of one document both acting turns off;

**Reply (handled):**

> When the same review is open in two tabs, Lahe lets only one tab send comments and edits; the other goes read-only. That stops two tabs from overwriting each other's work. The guard uses a browser lock feature that browsers only give to secure pages. On a plain http://name.lahe page there is no lock, and today's code then lets both tabs act rather than lock you out. The plan has a backup lock (task 6.3) if .lahe is printed. On .lahe.localhost nothing changes. I rewrote that line in Q1 to say this.

---

## 9. comment · Open, li 4

`itm_aa928e38972736b316cd7a0f` · 

**Ken wrote:**

> what?

**Pointing at:**

> the browser stops sending headers the Library's safety checks rely on;

**Reply (handled):**

> Browsers add a header to each request saying which site it came from: the same site, or some other website. The Library uses it to refuse requests that come from any other website, so a web page you visit cannot quietly press Library buttons. Browsers leave that header off for pages that are not secure.
>
> This one is already handled: the Library stays on library.lahe.localhost and is never served on .lahe, and the new page server falls back to an older header to tell a page from a file. So it is not a real cost of choosing .lahe; I kept it in the list so the trade is complete, and rewrote the line to say so.

---

## 10. comment · Open, li 5

`itm_0a51d590d95994d89f335510` · 

**Ken wrote:**

> it's decided at setup whether to use .lahe and a system would only do it if it was set up

**Pointing at:**

> on a machine where Lahe does not control .lahe lookups, someone on the network could take over a name.

**Reply (handled):**

> Right, and the design already works that way: .lahe is only used where it was set up, and Lahe checks every few minutes that its setup is the one answering. If the check fails, Lahe stops answering .lahe, so Lahe's own pages stay safe.
>
> What is left is narrow: if the setup breaks later (an OS update removes the lookup file, say), an old .lahe bookmark asks the network who name.lahe is. On a hostile network, like café Wi-Fi, the answer could be someone else's server, and that server would get the browser's saved storage for that name, which holds your unsent drafts. .lahe.localhost never asks the network, so it cannot happen there. I rewrote the line to say this is a broken-setup leftover, not a general risk.

---

## 11. comment · Open, ul 1

`itm_8fd43b38b9601076df88066b` · 

**Ken wrote:**

> ok sounds good. we'll go with .localhost for now

**Pointing at:**

> Lahe's copy buttons stop working unless they switch to an older copy method. These are the rail's "copy my feedback" button (for pasting comments to an agent when no helper is running), the copy button on the hand-off message for a new agent, the Library's copy of that message, and "Copy the command" on a page whose review is missing. Browsers only give the modern clipboard to secure pages;
> the two-tab guard turns off. Today, when the same review is open in two tabs, only one tab can send comments and edits, and the other is read-only, so the two cannot overwrite each other. The guard uses a browser lock that only secure pages get. Without a backup, both tabs could act;
> the browser stops sending the headers that say which site a request came from. The Library refuses any request without them, which is why the Library stays on library.lahe.localhost and is never served on .lahe. The new page server also reads them to tell a page from a file, and would fall back to an older header. This one is already handled; it is listed so the trade is complete;
> a small leftover risk if the setup later breaks (an OS update removes the lookup file, say). .lahe is only used where it was set up, and Lahe stops answering .lahe the moment its check fails, so Lahe's own pages stay safe. But an old .lahe bookmark would then ask the network who name.lahe is, and a hostile network (a café's Wi-Fi) could answer with its own server. That server would get the browser's storage for that name, which holds unsent drafts. .lahe.localhost never asks the network.

**Reply (handled):**

> Confirmed, already recorded that way in the brief, architecture, and plan.

---

## 12. note · (no anchor)

`itm_677ece7fa37697fef167343e` · 

**Ken wrote:**

> ok im done with the brief. go update the other docs based on these changes

**Reply (handled):**

> Done. The architecture, plan, and progress page now match the brief:
>
> - Port-free addresses are their own option, lahe install --port-80, separate from .lahe, and the plan builds it first in the last workstream since you'll use it either way. The helper checks the forward works before printing an address without :1483 (new test V76).
> - Names are the folder plus two parents joined by dots, everywhere, including the examples and the name check.
> - Pages on 1483, API on 7817, in the listener task and the Host rules.
> - .lahe.localhost is printed; the .lahe backup work (task 6.3) is dropped and its three tests marked not applicable; HTTPS for .lahe is a follow-up.
> - The decisions page on main has a note pointing to the brief's resolved list.
>
> I took your naming comments as approving one name per folder and moved it off your list; say so if not. One item is left on the progress page: approve the plan's hand-run CI workflow, and accept that CI cannot prove 'starts at login' on Linux and Windows (your reboot proves it on the Mac).

---
