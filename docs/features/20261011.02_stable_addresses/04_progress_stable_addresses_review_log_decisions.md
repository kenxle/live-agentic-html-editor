# Review log: ra192291dfb29

**Pages reviewed:** /STABLE_ADDRESSES-bd14d360685f150a.html

**Items:** 21 total, 21 handled, 0 not handled.

Exported from the LAHE state directory by `lib/scripts/lahe_review_log.py`. The reviewer's words are in the note and change fields; everything else is the document text the item pointed at.

## Everything, in order

1. **comment** · correct
2. **comment** · it's a good callout, but i think i'm probably ok with this since we've done optimization
3. **comment** · i don't understand this
4. **comment** · why do we have to have unique ports?
5. **comment** · what about using a vhost so that we can run lahe.local instead of localhost? wouldn't t...
6. **comment** · unclear what the problem is here
7. **comment** · we could just move to something that is separate, including an executable or .app or so...
8. **comment** · deleted docs aren't really my concern here. it's the constant dead tabs that i run into...
9. **comment** · yeah this sounds reasonable. let me keep reading tho
10. **comment** · i do like where this is going. easy access to the library is nice
11. **comment** · this doesn't seem in the same category as the first two. this is always an option?
12. **comment** · make a graph that maps out this exact attack. i feel like there are other ways to preve...
13. **comment** · if it doesn't actually matter, we could just do them as docname.lahe
14. **comment** · isn't this just a vhosts edit? it's really easy. if .lahe becomes a tld then we can dea...
15. **note** · i do think we should keep this, for the most part, as just a server, or something that...
16. **comment** · javascript? be specific
17. **comment** · sweet then i think we found our solution to the security issue
18. **comment** · yes!
19. **comment** · .lahe from the start, with an option to fallback to .lahe.localhost
20. **comment** · ok
21. **comment** · yeah let's do the full forge. i think you have enough from me to do the full docset wit...

---

## 1. comment · p 6

`itm_b1838a6ef9801c4b57dadd15` · 

**Ken wrote:**

> correct

**Pointing at:**

> So "persistent port" is really "something always answering at the document's address".

**Reply (handled):**

> Noted, no change needed.

---

## 2. comment · li 9

`itm_da95ae6c973341f57f3f4d4f` · 

**Ken wrote:**

> it's a good callout, but i think i'm probably ok with this since we've done optimization

**Pointing at:**

> The helper runs all the time. It would start at login (a macOS login item). An idle Lahe process uses roughly 20 to 50 MB of memory going by the monitors running now, and almost no CPU when nothing is happening. Your battery trouble on 2026-10-07 was nearly two thousand leaked test helpers, not one idle one. Still worth measuring before and after.

**Reply (handled):**

> Recorded on the page, here and under question 1.

---

## 3. comment · li 10

`itm_93bd02635ea37dee78eff92b` · 

**Ken wrote:**

> i don't understand this

**Pointing at:**

> Many open ports. There are 682 reviews in your state folder. One listening port each is cheap for one process, but macOS starts a login item with a limit of 256 open files, so the helper would need that raised, or only keep addresses for recent and starred documents.

**Reply (handled):**

> Rewrote it. Short version: each document needs its own open door (port) on the helper, and macOS caps a login program at 256 by default. You have 682 documents, so either raise the cap or keep doors only for recent and starred ones.

---

## 4. comment · li 10

`itm_ac864616ee67982eefe38e97` · 

**Ken wrote:**

> why do we have to have unique ports?

**Pointing at:**

> One open door per document. For a document's address to answer, the helper has to keep a door open for it, one per document. You have 682 documents, so that means 682 doors. Each door costs almost nothing. But macOS limits a program started at login to 256 open doors by default. So either the login item raises that limit (one setting), or the helper keeps doors open only for recent and starred documents. Question 2 asks which.

**Reply (handled):**

> Good question, and it changed my recommendation. The browser walls pages off by host name plus port. Each document's page holds a key to post to its own review, and separate walls stop one page's scripts from using another's key. Ports are just how Lahe gets separate walls today. A host name per document does the same on one shared port, like ra192291dfb29.localhost:7820. Your Mac already routes those names to itself. I added this as option D, now recommended, plus a section explaining the walls.

---

## 5. comment · li 11

`itm_99280d8d696082880566fd6a` · 

**Ken wrote:**

> what about using a vhost so that we can run lahe.local instead of localhost? wouldn't that change the collision issues?

**Pointing at:**

> Port clashes with your other tools. Lahe would reserve a range of port numbers away from the common dev-server ones. A clash is still possible; then that one document moves, as it does today.

**Reply (handled):**

> A name alone does not change clashes: the port belongs to the computer, not the name. But it does give the nicer look. .local is a bad fit on a Mac (it is for finding network devices, is slow, and needs an admin edit per name). .lahe.localhost works today with no setup, so option D now uses addresses like ra192291dfb29.lahe.localhost:7820. Dropping the :7820 needs port 80, which takes a one-time admin setting. Added a section on the page.

---

## 6. comment · li 12

`itm_4bf20d496c198238ef08f99a` · 

**Ken wrote:**

> unclear what the problem is here

**Pointing at:**

> A page is reachable whenever the helper is up. Today a document's page, and the review token inside it, is reachable only while it is being served. Other websites still cannot read it (the existing host checks stay), but the security review would need to look at it again.

**Reply (handled):**

> Rewrote it. In short: a program on your Mac could load a page and use its key to post fake comments. Today that only works while the doc is served; with stable addresses, whenever the helper runs. Websites cannot do it, and local programs can already read Lahe's files, so the added risk is small. It is a note for the security review.

---

## 7. comment · li 13

`itm_f2a3413d5073a2811dc5f024` · 

**Ken wrote:**

> we could just move to something that is separate, including an executable or .app or something

**Pointing at:**

> Who owns the server changes. Today the agent session owns its page servers. With stable addresses the helper owns the address, and sessions only own the review. That touches the session docs, the diagrams, and several tests.

**Reply (handled):**

> Agreed, it is a separate always-on thing either way. I added a section with three ways to run it: a login item (simplest, nothing to build), a small Mac app with a menu-bar icon (needs a little native code), or one self-contained program (only if Lahe goes to people without Node). I suggest the login item first. Added as question 3.

---

## 8. comment · li 14

`itm_ac953240db47dcb49abcefe7` · 

**Ken wrote:**

> deleted docs aren't really my concern here. it's the constant dead tabs that i run into and have to try and decipher what they are by the url

**Pointing at:**

> A link to a deleted file would open a helper page saying the file is gone, with a link to the Library. Better than "can't connect", but not the document.

**Reply (handled):**

> Took the deleted-file point out. Dead tabs are now the first pro. And since you have to decipher tabs by their address, option D now names the address after the document, like stable-addresses.lahe.localhost:7820, instead of an id. Same-name documents get a short tag to tell them apart.

---

## 9. comment · li 15

`itm_d685a547312468039e81782e` · 

**Ken wrote:**

> yeah this sounds reasonable. let me keep reading tho

**Pointing at:**

> A login item Lahe installs. npm run install-cli would also tell macOS to start the server at login and restart it if it stops. No new code to build, and nothing visible on screen.

**Reply (handled):**

> Noted under question 3 as leaning login item.

---

## 10. comment · li 16

`itm_80509a9cd6b90ebeab568967` · 

**Ken wrote:**

> i do like where this is going. easy access to the library is nice

**Pointing at:**

> A small Mac app. The same server, wrapped as an app with a menu-bar icon: it shows it is running, links to the Library, and has a Quit button. The server stays the existing Node code, but the icon needs a small piece of native Mac code, built once and shipped with Lahe. That bends the "runs from a git clone" rule a little, so it would be optional.

**Reply (handled):**

> Noted under question 3, with a suggested path: login item with this feature, menu-bar app (with its Library link) as its own follow-up.

---

## 11. comment · li 17

`itm_67826e1c40fb5f778a96a7d1` · 

**Ken wrote:**

> this doesn't seem in the same category as the first two. this is always an option?

**Pointing at:**

> A single self-contained program. Node can be bundled into one file that runs with no Node installed. Bigger to ship, and it has to be rebuilt on every change. Only worth it if Lahe goes to people without Node.

**Reply (handled):**

> Right, it is a packaging choice open at any time, not a third way to run it. Moved it out of the list into a one-line note below.

---

## 12. comment · section 6

`itm_7090212ba48549f3453affd7` · 

**Ken wrote:**

> make a graph that maps out this exact attack. i feel like there are other ways to prevent this

**Pointing at:**

> The browser walls pages off from each other by address. Two pages with the same host name and port share one walled garden: they share saved drafts, and a script on one can read the other. Different port, or different host name, means a different garden.
>
> Each document's page carries a key (its review token) that lets it post comments to that one review. Lahe gives each document its own garden so a page can only use its own key. That matters because pages can carry scripts Lahe did not write, like a chart library loaded from the web, or a whole site an agent is building. If two documents shared a garden, one page's script could read the other's key and post to it.
>
> So the separate gardens are the point. Separate ports are just how Lahe gets them today. A host name can do the same job.

**Reply (handled):**

> Added a diagram of the attack and a list of other ways to stop it, right below this section. The dangerous step is a fake comment reaching your agent, which can change files. Other ways do exist: a browser rule that boxes each page in (stops it all, but drafts can no longer be saved in the browser), a rule limiting where a page can send requests (partial), or asking you before an agent acts on an outside page (guards the last step). Separate addresses still stop everything with one rule, so I still lean D.

---

## 13. comment · What about a name like lahe.local?, li 3

`itm_e78f7f287430fe21ea48e1c9` · 

**Ken wrote:**

> if it doesn't actually matter, we could just do them as docname.lahe

**Pointing at:**

> .localhost gives the same look with no setup. stable-addresses.lahe.localhost works today on your Mac, in every browser. I checked.

**Reply (handled):**

> Possible, but it costs more than it looks. Your Mac does not know .lahe, so it needs a one-time admin setup and a small name server in Lahe. Browsers treat an unknown ending as a search when typed, and .lahe could become a real internet ending someday. Browsers promise .localhost stays on your computer, which is also safer. I'd keep docname.lahe.localhost. Added a bullet on the page.

---

## 14. comment · What about a name like lahe.local?, li 4

`itm_5b997af8863a114ab3326629` · 

**Ken wrote:**

> isn't this just a vhosts edit? it's really easy. if .lahe becomes a tld then we can deal with that later. it's not highly likely

**Pointing at:**

> Your Mac does not know .lahe, so Lahe would need a one-time admin setup plus a small name server of its own.

**Reply (handled):**

> Close, with one catch: the hosts file has no wildcard, so every new document would need its own line and your admin password. The clean way is one admin step that sends every .lahe name to a tiny name server inside Lahe. One password ever, then any docname.lahe works. Agreed the TLD risk is low. Updated the bullet with both routes.

---

## 15. note · (no anchor)

`itm_e4ea04ef341b5f3bc43eb937` · 

**Ken wrote:**

> i do think we should keep this, for the most part, as just a server, or something that typically runs cross platform. we can make a companion app for an icon on mac, but the core of the code should work on any device

**Reply (handled):**

> Agreed, and added it near the top as the rule for this feature. It settles two things: .lahe.localhost is the default because it works on every system, and the short .lahe ending is an optional per-system extra. Start-at-login becomes a small setup step per system around the same server.

---

## 16. comment · The attack, step by step, p 1

`itm_b3c1d458462876cc61589f83` · 

**Ken wrote:**

> javascript? be specific

**Pointing at:**

> Hidden code

**Reply (handled):**

> Yes, JavaScript: the page's own script tags, or a script it loads from the web. Changed the diagram and the section above it to say so.

---

## 17. comment · The attack, step by step, p 1

`itm_279a7aacc2f7faf443ec3c6a` · 

**Ken wrote:**

> sweet then i think we found our solution to the security issue

**Pointing at:**

> Is your other document
> at the same address?

**Reply (handled):**

> Agreed. Recorded on the page: option D is settled, and it covers the security worry. Question 2 now asks only which name ending to start with.

---

## 18. comment · li 26

`itm_be6b6e5e4301d3c519123fc9` · 

**Ken wrote:**

> yes!

**Pointing at:**

> Are you OK with the Lahe helper starting at login and staying up? Leaning yes, from your note on the cons.

**Reply (handled):**

> Recorded as settled.

---

## 19. comment · li 27

`itm_6c47191d947049de77e3f971` · 

**Ken wrote:**

> .lahe from the start, with an option to fallback to .lahe.localhost
> it's looking like we'll have to upgrade to an npm install as part of this process, which is fine

**Pointing at:**

> or .lahe from the start?

**Reply (handled):**

> Recorded: .lahe from the start, falling back to .lahe.localhost when the setup is missing. On the install: yes, it needs an install step, but only for setup (the .lahe lookup and start at login). The name server can be built from what Node already ships, so we can keep zero outside packages. A lahe install command that asks for your password once would cover it.

---

## 20. comment · li 28

`itm_d92c3c8c27e9737ef3839c36` · 

**Ken wrote:**

> ok

**Pointing at:**

> Login item first, or go straight to a menu-bar app? From your notes: the login item sounds reasonable, and you like the app for one-click access to the Library. One path: ship the login item with this feature, then the menu-bar app as its own follow-up.

**Reply (handled):**

> Recorded as settled: login item now, menu-bar app as a follow-up.

---

## 21. comment · li 29

`itm_1504207755b57bd92b52a55a` · 

**Ken wrote:**

> yeah let's do the full forge. i think you have enough from me to do the full docset without waiting for my input. just write it all up and i'll review once it's ready to code

**Pointing at:**

> Ready for this to become a feature-forge feature, starting with the brief?

**Reply (handled):**

> On it. Writing the full doc set now (brief, architecture, plan) from this page. I'll bring you the finished set for review before any code.

---
