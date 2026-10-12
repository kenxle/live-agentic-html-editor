# Crucible: Stable addresses

Date: 2026-10-11
Status: ACCEPTED (questions settled by Ken on [the decisions page](../../ongoing/STABLE_ADDRESSES.md); this summary was written without a live question round, at his request)

## The idea, as stated

Ken, 2026-10-11: "using randomized port numbers means that we can't use the browsers history to open documentation. we always have to use the lahe library to find old docs, or ask an agent for them by name. the more i use it, the more i see how bad of a ux it is to have docs that don't load, and you have to go somewhere outside the browser to find them."

And on the decisions page: "it's the constant dead tabs that i run into and have to try and decipher what they are by the url."

## Jobs to be done

Get back to a document I was working on, from the browser, the way I get back to any web page: a tab I left open, a history entry, a bookmark. Without leaving the browser, and without asking an agent.

## Who the user is

Ken first: he runs several agent sessions a day, keeps many Lahe tabs open across days, and reads almost every plan, brief, and report through Lahe. Later, anyone running Lahe from a clone on Mac, Linux, or Windows.

## User context

A laptop browser with many tabs, some from yesterday. He clicks a Lahe tab, or types a few letters into the address bar and picks a history entry. No agent is necessarily running for that document.

## What already exists

- The Library (`docs/ongoing/LIBRARY.md`): lists every review, and its Open button re-serves a document. It works, but it is a detour: find the Library, find the row, click Open, and a new tab opens on a possibly new address.
- Option D on [the Library ideas page](../../ongoing/DOCUMENT_INDEX_IDEAS.md): "a stable address based on the review id". Dropped on 2026-09-22 because the Library's Open seemed enough. This feature is that option, revisited with use.
- Page servers already ask for their old port when they restart (`src/service/static_servers.js`), so the port number rarely changes. The address dies because nothing is listening on it.
- Prior art: `*.localhost` host names are reserved for the local computer by RFC 6761, and Chrome, Firefox, and Safari on macOS send them to this computer. Local dev tools (Laravel Valet, puma-dev, pow) give each project a host name under one custom ending (`.test`, `.dev`) with a tiny local name server plus a per-system resolver file. Nothing to adopt: those are separate tools with their own runtimes; the technique is what carries over.

## Evidence

- Ken's own repeated pain, in his words above, after weeks of daily use.
- Seen in this very session: the decisions page's own server stopped two minutes after its window lost focus, mid-review, and had to be restarted by hand.
- 682 reviews in Ken's state folder on 2026-10-11, almost all of whose addresses no longer answer.
- No other users yet. The tool is public, so the fix has to hold for other systems too.

## Status quo

Open the Library (through an agent, or a bookmark to the helper), find the document, click Open, read in a new tab. Or ask an agent "open the stable addresses doc". Every dead tab is a small detour plus a moment of "what was this?" from reading a bare `127.0.0.1:56055` address.

## Premises

1. The problem is that nothing answers at an old address, not that the port number changes. Agreed (Ken: "correct").
2. An always-on Lahe server, started at login, is acceptable. Agreed ("yes!").
3. Each document must stay its own browser origin, so one page's JavaScript cannot read another's comment key. Agreed once the attack was laid out; a host name per document does this on one port.
4. The core stays a plain cross-platform server; Mac-only pieces are companions on top. Agreed (Ken's own rule).
5. Deleted or moved files are not the concern. Agreed ("deleted docs aren't really my concern here").

## The case against building this

The Library already solves "find my document", and its Open works. This feature changes who owns page servers (sessions today, the always-on server tomorrow), touches the origin and token model that the security reviews shaped, adds an install step that asks for an admin password, and adds a name server to a tool whose whole pitch is "nothing to install". That is real cost and real risk for something a bookmark to the Library mostly covers. What would make this the wrong call: if dead tabs were rare. They are not; Ken meets them every day, and the detour is exactly the "go somewhere outside the browser" he named.

## What happens if we do nothing

Every tab older than two idle minutes stays dead. Ken keeps routing through the Library or an agent several times a day, keeps guessing what `127.0.0.1:5xxxx` was, and unsent drafts saved under an old address stay out of reach. It does not get worse, but it does not get better with more use; it gets more annoying.

## Approaches considered

### Approach A: One port per document, always held open (minimal change to the origin model)

Each document keeps a port forever; the always-on server listens on all of them. Effort M, risk Med. Keeps today's origin model exactly. Needs one open port per document (682 today, over the 256 macOS gives a login program by default), and every port can clash with another tool.

### Approach B: One address with paths, like `127.0.0.1:7817/r/<review>/` (simplest)

Effort S to M, risk High. Every document shares one origin with every other and with the Library page, so any page's JavaScript could read every other page's key and drafts and drive the Library. Needs a security redesign to be safe.

### Approach C: One port, one host name per document (ideal)

`http://stable-addresses.lahe:7820/`, falling back to `stable-addresses.lahe.localhost:7820`. Effort L, risk Med. Each host name is its own origin, so isolation holds. One port, so no port limit and one clash point. The address names the document, which answers "what was this tab?". Needs a one-time setup per system for `.lahe` (`.lahe.localhost` needs none).

### Do nothing

Keep the Library as the way back. Loses everything in "What happens if we do nothing".

## Recommended approach

C. It is the only option that keeps each document walled off, removes the per-document port cost, and puts a readable name in the address bar, which is half of Ken's complaint.

## Challenges the session leader accepted

- The fix is "something always answering", not a fixed port number.
- An always-on server, started at login.
- Login item first; a Mac menu-bar companion app with a Library link as its own follow-up.
- Separate addresses per document are needed against a bad page (one sent to him, saved from the web, or a hacked script it loads), not against his own pages.

## Challenges the session leader rejected

- "Use `.lahe.localhost` and skip the setup": Ken wants `.lahe` from the start ("isn't this just a vhosts edit? it's really easy"), with `.lahe.localhost` as the fallback. The hosts file cannot hold a wildcard, so the setup is a resolver entry pointing `.lahe` at a tiny name server inside Lahe, one password once.
- "`.lahe` could become a real internet ending": low risk, deal with it then.
- "An install step bends the no-install rule": Ken accepts an install step. It is for setup only; no outside packages are added.

## What we skipped and why

The one-at-a-time question round. Ken answered the substance on the decisions page and asked for the doc set without stopping. Roadmap priority (Q7) was not argued: Ken chose this from daily pain.

## Open questions

- How long a document keeps its address after its file is gone. Ken does not care much; the brief picks a default.
- Whether review pages served by an outside dev server (a running app) get a stable address. Likely not: Lahe does not own that server.

## The assignment

Write the brief, then the architecture, starting from how today's per-session page servers, origins, and tokens fit together.
