# How LAHE gets into a page: the serving architectures

When a person reviews a document in their browser and their agent acts on
the feedback, three questions decide the whole setup:

- what is actually running?
- who serves the page?
- how does the review layer get into it?

The answer changes by use case. This doc walks each one with a diagram. It is
written for someone who has never thought about the problem before. For the
agent-facing operating rules (what to run, when to reply), see `AGENTS.md`;
this doc is the map underneath those rules.

## The three moving pieces

Every setup has the same three pieces. Only the third one changes.

1. **The library.** One JavaScript file (`lahe-layer.js`). Once it is in the
   page, it draws the review rail, records comments and edits, and talks to
   the helper. It is the whole browser side of the tool.
2. **The helper.** One local Node process (`lahe serve`, usually started for
   you). It listens on a fixed loopback port (7817 by default) and owns the
   review store on disk:
   - the event log
   - `review.json`, what the agent reads
   - the reply files, where the agent answers

      It runs in every use case, no exceptions. It also serves every page LAHE
   serves itself, on a second fixed port (1483), at the page's stable address
   (see "Stable addresses" below).
3. **The page server.** Whatever answers the browser's request for the page
   itself. This is the piece that varies, and it is the whole difference
   between the use cases below:
   - the helper itself, at the page's stable address (the preferred path for documents)
   - your app's own dev server (Rails, Vite, whatever you already run)
   - no server at all (the `file://` fallback)

```mermaid
flowchart LR
    subgraph Browser
        P["The page"]
        L["Library (rail, recording)"]
        P --- L
    end
        PS["Page server (the helper :1483, your dev server, or file://)"] -->|serves the page| P
    L <-->|"comments, edits, replies"| H["Helper :7817 (always running)"]
    H --> S[("Review store on disk<br/>events.jsonl, review.json, replies.jsonl")]
    A["Agent"] -->|reads review.json| S
    A -->|appends reply lines| S
    A -->|edits| SRC[("Your source files")]
    SRC -.->|rebuild / reload| PS
```

Two facts worth holding onto before the cases:

- **The library never writes the reviewed file.** An edit in the browser
  changes the page the reviewer sees and mints a record. The agent applies
  the change to source. That is what lets one design work on a static doc and
  on a Rails page whose "source" is a template three directories away.
- **The script line is the whole installation.** The library enters a page
  through one `<script>` tag. Its four attributes carry:
  - where the library is
  - the review id
  - the per-review token
  - the helper's URL

  Every use case is really a different answer to "how does that one line get
  into the page".

## Stable addresses

Every page the helper serves has one address that does not change:

```
http://<name>.lahe.localhost:1483/<path under the folder>
```

- **The name is the folder.** It is the page's folder and its two parent
  folders, in path order, joined by dots: `live-agentic-html-editor/docs/ongoing`
  becomes `live-agentic-html-editor.docs.ongoing`. Each folder name is
  lowercased, and every run of other characters becomes one dash. The home
  folder and anything above it are never part of a name. When two folders
  would get the same name, the second takes one more parent folder, then a
  number. A name is never reused for another folder.
- **The path is the file.** It is the same path under the folder that a page
  server used before, so links between pages, images and recorded comments
  keep working.
- **A site is one folder, or one notes page.** Every file in a site's folder
  shares its address's origin, the same unit a page server was. Different
  folders are different origins, so one cannot read another.
- **It keeps working.** The address does not depend on the agent session: it
  loads after the session closes and after the helper restarts, whenever the
  helper is running. With `lahe install`, the helper starts at login.
- **Every browser treats `.lahe.localhost` as this computer, and as secure,**
  with no setup.
- **Names are made by the CLI only.** `lahe review` and `lahe write` ask the
  helper to bind the review to its site (`site.bind`, with a secret from the
  state folder). Visiting an address never makes a name.
- **One page, every spelling.** With the port-80 forward a page also answers
  with no port, and with `.lahe` names at `<name>.lahe`. Comments and
  review.json treat every spelling as the same page (`record.pageIdentityKey`).
- **The state folder is never served,** even from a site whose folder holds
  it: any file whose real path is inside it is a 404.
- **A name Lahe does not know, or a file that is gone,** gets a page that says
  so, with an "Open the Library" link to `library.lahe.localhost`.

The registry is `sites.json` plus its append-only `sites.log` in the state
folder, written only by the helper. Each change goes to the log first, so on
start the helper replays any log entry `sites.json` is missing. `lahe status` prints each review's address,
and the pages port and why addresses print the way they do.

## Use case 1: one HTML file that is the document

A one-pager, a presentation, a mockup, three logo options on a page. The HTML
file is the source: editing it is editing the document.

```sh
lahe review path/to/page.html
```

The helper serves the page's own folder, read-only, at the folder's stable
address, and `lahe review` prints one URL. The reviewer opens that URL and
nothing else.

```mermaid
flowchart LR
    F[("page.html<br/>(untouched on disk)")] --> RS["The helper's pages<br/>name.lahe.localhost:1483"]
    RS -->|"page + script line,<br/>injected into the response"| B["Browser"]
    RS -->|"serves the library at<br/>/.lahe-library/lahe-layer.js"| B
    B <--> H["Helper :7817"]
    A["Agent"] -->|edits page.html directly| F
    H -.->|"watches the file,<br/>reloads the page"| B
```

What makes this the preferred path:

- **Nothing is written into your folder.** The script line goes into the HTTP
  response, not into the file, and the library is served from a reserved
  route on the page's own address. So no review id, no token, and no copy of the library
  land next to your page. This matters because the folder is usually a git
  checkout: before this design, `git add -A` committed both, and a deployed
  copy brought the review rail up for every visitor to the live site.
- **The page reloads itself.** The helper watches the file. When the agent's
  edit lands, the reviewer's page reloads and their outstanding comments and
  edits are re-applied on top. Nobody tells anybody to refresh.
- **The address outlives the agent session.** `lahe session close <id>`
  closes the session; the page stays at its address. It is read-only and
  loopback-only.

One trap: the address serves the page's own folder. An image beside the page
loads; an image referenced as `../assets/x.png` is above that folder and
404s. Opened from disk the same page looks fine, because `file://` has no
root to escape. Load the served URL yourself before handing it over, and if
assets live above the page, move them under it or move the page.

## Use case 2: one Markdown file

A spec, a skill, a plan, a draft. The `.md` file is the document.

```sh
lahe review path/to/SKILL.md
```

Same shape as use case 1, with one extra step in front: the helper renders the
Markdown to HTML itself, from the source, when the page is asked for. The
address serves the source's own folder, and the page's path is the `.md` file's
own name. The rendering:

- handles CommonMark and GFM
- draws mermaid diagrams as local SVG
- sets the page in the St. Clair AI document style, vendored under
  `vendor/stclair-doc-style/` and inlined so a saved page stays self-contained

Nothing is written beside your source. The render is cached by the source's
file time, and the reload check, rebuild and the handled check all read that
same render. LAHE also keeps a rendered copy in its own state directory, which
older addresses and a `file://` open read.

```mermaid
flowchart LR
    MD[("SKILL.md<br/>(the source, never written by LAHE)")] -->|rendered by the helper| G[("the render,<br/>cached by file time")]
    G --> RS["The helper's pages<br/>name.lahe.localhost:1483/SKILL.md"]
    RS -->|page + script line| B["Browser"]
    B <--> H["Helper :7817"]
    A["Agent"] -->|edits the .md| MD
    MD -.->|"the helper sees the source is newer<br/>and renders again by itself"| G
    H -.->|reload| B
```

The loop for the agent:

1. Edit the `.md`.
2. Reply.

There is no rebuild step. When the reviewer's page asks the helper whether
anything moved, the helper checks whether the `.md` is newer and renders it
again if it is (`src/service/rebuild.js`). The page then
reloads onto the new render. An agent that forgets to rerun anything is not a
failure mode any more; before this, a forgotten rerun left the reviewer's own
edit disappearing on every refresh.

Two limits on that, both deliberate: only a Markdown review, and only LAHE's
own artifact. A review pointed at the reviewer's build output is never
rewritten, because that file belongs to their build.

Do not hand-convert Markdown to HTML or start a separate server; the
renderer exists so that never happens.

Relative images and local links work: they are served from the source folder,
and a link to another local `.md` opens as another rendered page. A link to a
file in another folder is served through a mount, `/.lahe-source/<hash>/`,
stored on the page's site. A mount serves only the files the site's pages link
to or show (`docs/ongoing/STATIC_SITE_FOLDER.md`, "Linked documents"). When that folder also has a site of its own, the
helper renders and checks its files through the site that holds them, never
through the mount (`page_routes.siteForFile`, spec
`docs/features/20261017.01_site_for_file_owner/`). Links stay
source-true on disk; the renderer translates them for the browser at build time.
A link that leaves the documentation (an external URL, or a protocol-relative
`//host` link) opens in a new tab, so following it never takes the reviewer off
the page they were commenting on. Links we render ourselves, in-page anchors,
and `mailto:`/`tel:` links stay in the same tab.

The rail follows the link (spec `docs/features/20260922.02_linked_docs_rail/`):

- A linked document carries the rail of the review whose page linked to it,
  and a comment there lands in that review naming the linked file on disk.
  There are no redirects between pages: the link opens where it points.
- Nothing is created by the click: no review, no enrollment.
- Only the files a page actually links to get the rail. Their neighbours in the
  mounted folder do not.
- An `--only` review keeps its links read-only.

## Use case 3: a document built from several sources

This is the composed case: a build step produces the HTML the person
actually reads. For example:

- a fully rendered prompt assembled from several `.md` fragments
- a Pandoc report with citations and templates

The rule: **the build is part of the deliverable, so LAHE never bypasses it.**
You run the project's real build, then review the output, and you tell the
review where the sources live:

```sh
npm run build-docs   # or make, or pandoc, or your render script
lahe review path/to/build/report.html --source path/to/build-entrypoint
```

```mermaid
flowchart LR
    subgraph Sources
        S1[("intro.md")]
        S2[("body.md")]
        S3[("template.html")]
    end
    S1 --> BLD["The project's own build"]
    S2 --> BLD
    S3 --> BLD
    BLD --> OUT[("build/report.html")]
    OUT --> RS["The helper's pages<br/>name.lahe.localhost:1483"]
    RS -->|page + script line| B["Browser"]
    B <--> H["Helper :7817"]
    A["Agent"] -->|"edits the right fragment,<br/>guided by --source and the item's page text"| S2
    A -->|reruns the build| BLD
    H -.->|"sees report.html change,<br/>reloads the page"| B
```

The serving is identical to use case 1:

- the helper serves the built file at its folder's stable address
- the script line rides in the response
- the helper watches the built file and reloads the page when a rebuild lands

What changes is where edits go:

- **Edits go to the sources, never the built HTML.** An edit to the output is
  erased by the next build. `--source` is a navigation hint pointing at the
  build entrypoint (the manifest, top-level file, or build script that
  reveals the input set); each review item's captured page text is what
  locates the exact fragment.
- **A reply is not `handled` until the build has rerun** and the change is
  visible in the built page. That is the hard rule in `AGENTS.md`, and this
  architecture is why: the reviewer is looking at build output, so a source
  edit alone changes nothing they can see.

Use cases 2 and 3 look similar, and picking between them is a real decision.
Direct Markdown review is for one file that is the whole document. The
moment several files, includes, or filters compose the visible page, the
project's build wins, and use case 3 is yours.

## Use case 4: an app running on its own dev server

Your Rails app (or any dev server) is already serving pages at
`http://localhost:3000`. Here LAHE serves no pages at all. The app's server
and LAHE's helper run side by side, each doing its own job:

- the app's server serves every page, exactly as it always did
- the helper stores the review and serves the library file

So to answer the natural question directly: yes, there is a second server
alongside your dev server, and it is the same helper that runs in every other
use case. What LAHE does not do here is serve the page; your app already is
one.

```sh
lahe review path/to/project --origin http://localhost:3000
```

This edits nothing. It registers the origin, mints the review and token, and
prints one script line for you (or your agent) to paste into the app's
layout:

```mermaid
flowchart LR
    subgraph Your app
        T[("Layout template<br/>+ one script line,<br/>dev-only guard")]
        DS["Your dev server :3000<br/>(Rails, Vite, anything)"]
        T --> DS
    end
    DS -->|"every page, natively"| B["Browser"]
    H["Helper :7817"] -->|"serves the library file"| B
    B <-->|"comments, edits, replies"| H
    A["Agent"] -->|edits app code / templates| T
    DS -.->|"the app's own hot reload<br/>keeps working"| B
```

How the pieces resolve in this mode:

- **The script line goes in the layout**, so every page the reviewer walks
  carries the rail. One review spans the whole walk; records carry the page
  they were made on, and `review.json` groups by page.
- **The library loads from the helper's URL.** The line's `src` points at the
  helper, so your app does not need to serve the library. The line also
  names a fallback path (`/lahe-layer.js`) that loads when the helper is
  down. Copy the built library into your app's `public/` if you want that
  fallback, or skip it.
- **Browse mode is fully native.** Links navigate, forms submit, your app's
  JavaScript sees every event. The library does not fight the framework, and
  a hot-reloading stack keeps hot-reloading; the two reload mechanisms are
  designed not to fight.
- **Editing the app is just editing the app.** The agent changes templates
  and code the way it always does; the dev server rebuilds; the library
  re-applies the reviewer's outstanding work over the new page and flags real
  collisions instead of clobbering anything.

### The guard is on you

The printed snippet includes a comment that warns you to guard it. A comment
is not a guard. The line carries a per-review token, and a script line that
ships to production brings the review rail up for every visitor. Wrap it in the
framework's real development-only conditional, and delete it when the review
is over. Nobody else will.

### Rails specifically

Rails is the first named integration (it is what Ken reviews on), and the
wiring is:

- Paste the line into `app/views/layouts/application.html.erb`, where the
  layout's scripts go, inside a real guard:

  ```erb
  <% if Rails.env.development? %>
    <script src="http://127.0.0.1:7817/..." data-lahe-review="..." ...></script>
  <% end %>
  ```

- **Turbo is handled.** The library honors and uses Turbo's own hooks: a
  region the reviewer is actively editing is marked so Turbo skips it, and
  the library re-applies committed records after Turbo repaints the page.
- **Restart if your app reads config at boot.** Rails reads the environment
  and initializers once at startup. If your project routes the review values
  through an env file or an initializer instead of pasting the literal line,
  the server must restart before the page carries them. This exact step cost
  three separate agents a blank page in the Steady Thread repo before it was
  written down.
- **A strict development CSP** can refuse the line's inline `onerror`. The
  only cost is the fallback load for when the helper is down; the primary
  library load still works.

### Any other framework

Nothing in the protocol is Rails-shaped. Any server that can put one line
into a shared layout works the same way:

- Django: the base template, inside `{% if debug %}`
- Next.js / Vite / anything with an HTML shell: the shell, behind a
  `NODE_ENV === "development"` check
- static site generators in dev mode: the layout partial

The three things a framework must let you do:

1. put one script line into the pages under review, in development only
2. keep serving its pages itself (LAHE asks nothing of the page server)
3. optionally serve one static file (the fallback library copy)

That is the whole integration surface. What actually varies per project is
not the framework but the local conventions:

- how the server is started and restarted
- where the review values go

That is what the setup file at the end of this doc exists for.

## The fallback: opening the file straight from disk

`file://` works. Double-click the HTML file and the rail comes up, even with
the helper down:

- everything is kept in browser storage
- copy and export carry the feedback out by hand

With the helper up, `file://` joins the normal loop: a page opened from disk
sends a `null` origin, and the review registers it.

It is the fallback, not the preferred path, because it is the one mode that
writes into your folder:

- the script line goes into the HTML file itself
- a copy of the library lands beside the page (the `src` on the line points
  at the helper; the copy is the offline fallback)

```mermaid
flowchart LR
    F[("page.html + script line<br/>lahe-layer.js beside it")] -->|"file:// (no server)"| B["Browser"]
    B <-->|"when the helper is up"| H["Helper :7817"]
    B -->|"helper down: browser storage,<br/>copy and export carry the work out"| X["Hand-carry"]
```

Consequences that make it second choice:

- Both files sit in what is usually a git checkout, waiting to be committed.
- A rebuild that overwrites the file strips the line and takes the rail with
  it. The helper heals the file when it is running, but the served path has
  nothing to heal in the first place.
- Cleanup is a real step: `lahe add path/to/page.html --remove` takes the
  line and the sibling copy back out.

When it is genuinely right: a machine where a server cannot run, or the
assets trap above (resources that live above the page's folder resolve on
`file://` and 404 on the served path).

## So what are the architectures, in total?

Four, and every review is one of them:

| Shape | Page served by | Written into your folder | Where edits go |
| --- | --- | --- | --- |
| Static HTML doc | the helper, at the folder's stable address (the page's own folder, and the rail follows the reviewer onto every page in it unless `--only`) | nothing | the HTML file the item names |
| Markdown doc | the helper, at the source folder's stable address (rendered on request) | nothing | the `.md` source |
| Built document | the helper, at the build folder's stable address (you run the build) | nothing | the source fragments, then rebuild |
| App in dev | your own dev server | one pasted line in a layout | the app's code |

Plus the `file://` fallback, which is the first shape with no server and two
files written to disk.

In every one of the four, the helper runs alongside on port 7817, the agent
reads `review.json` and appends reply lines, and the review store on disk is
the single source of truth. The only things that ever change are who serves
the page and how the script line gets into it.

Variations that are not separate architectures:

- **A folder of HTML pages.** `lahe review path/to/folder` is the first shape
  with the server rooted at the folder instead of at one page's own directory.
  It mints one review for the folder and opens `index.html`, or the first page
  in name order when there is no index. Nothing else changes: nothing is written
  into your folder, the script line rides the response, and edits go to whatever
  page file the item names.

  What makes it work is a rule rather than a mechanism: **the rail follows the
  reviewer.** Ken, setting it: "if you can navigate to a page from where you
  currently are, and you currently have the lahe editor, it should follow you
  across anything you click on." So every HTML page the helper hands out of a
  reviewed folder gets the rail, whether or not any review recorded it: pages
  reached by a link, pages written after the review was opened, and the siblings
  of a single reviewed page. No page is enrolled, nothing is written to the
  review store, and the server stays a reader of it. A dev server somebody else
  runs is a different thing and keeps its own row above; ours has no such
  excuse.

  **`lahe review <page> --only` is the way out**, and it is the same sentence
  from Ken: "if you want to isolate a single file because you know other things
  around shouldn't be in there, that should be an option." The case is the
  folder nobody chose. `lahe review ~/Downloads/statement.html` serves the
  Downloads folder at its address, and an isolated review is never borrowed for a page it did not
  record, so the rest of that folder is served plain. It records
  `only_recorded_pages` on the review, and it goes one way only: the helper
  route that applies it accepts `true` and never `false`, because widening a
  review back out is the one thing a script that read the token off the script
  tag would ask for.

  Nesting is where the rule stops. A review answers for the folder it serves:
  the folder for a folder review, the page's own folder for a single page.
  `lahe review site/` and `lahe review site/sub/` are two documents that happen
  to sit one inside the other, each at its own address, so the newer inner
  review never takes over the outer one's pages.

  **The rule has no session filter.** Two reviews of the same file, in two
  agent sessions, share one address. The review that recorded the file wins,
  newest first, where "newest" is created or re-served most recently: `lahe
  review` and the Library's Open both stamp a review as re-served. So the most
  recent explicit act decides which review's rail a page carries.

  **`lahe write` is the one exception to the folder rule.** A notes page gets
  its own address, a site that serves that one page, the style and fonts it
  names, and a 404 for everything else, dotfiles included. It takes no mounts. See `docs/ongoing/FREE_WRITING.md`.

  **A page recorded on its own keeps its own review**, and the wider review
  covers the rest. That happens when someone ran `lahe review page.html` on a
  file in the folder before or after opening the folder itself. It is legal and
  deliberate, and the helper log says so the first time each such page is
  served, because otherwise it is discovered by wondering why a reply landed on
  the wrong card.

  **What is reachable is the served root, and `lahe review` prints it.** The
  reviewer is handed one URL, but the root line is the honest answer to "what
  else can be opened through this", and it is the line to read before deciding
  whether this wants `--only`.

  The folder needs at least one `.html` file of its own, and it is the folder's
  own pages that count, not a recursive walk. A directory with no pages in it is
  still the app-in-dev row, which is what pointing at a project checkout means.

  **Pages reload themselves, the same as a single-page review.** The review's
  recorded target is the folder, and a folder's modification time is no use as a
  trigger: it moves when a stray file appears and stands still when a page's own
  text is rewritten. So the poll's page path is what the helper stats, resolved
  under the folder with the same rules the helper applies to the request. An edit to one page reloads that page and no other. Nothing is ever
  written into those pages, healing included: their script line only ever lived
  in the response, and writing one to disk would put a live token in a file
  nobody asked to enroll.

  A Markdown file in the folder is rendered from its source like any other
  Markdown page, and carries the folder review's rail when it has no review of
  its own.

- **Several pages, one review.** Run `lahe review` again with the same
  `--session <id>`. Each page shows only its own items; `review.json` and
  `lahe status` show them all.
- **A distinct deliverable gets its own review** in the same session, for the
  same reason two documents do not share a comment thread.
- **Your own file server** (`--origin` pointing at something you run,
  serving plain files) behaves like the app-in-dev row: the origin is
  registered, the line is yours to place, the server is yours to run.

## The per-project setup file

This one is proposed, not built. The board row (`docs/BULLETIN.md`,
LAHE-project-setup-file, 2026-08-25) describes a `.lahe-setup.md` at a
project's root. The first agent that works out how to wire LAHE into a repo
writes it. Every agent after that reads it.

The motivating story: three cold agents each independently rediscovered the
same non-obvious Steady Thread step (restart the server after writing the
review values, because the env file is read once at boot) by getting an empty
page first. The knowledge died with each agent, because there was nowhere for
it to live.

What it would hold, per project:

- how a server is started and restarted here (a worktree script, not
  `rails s`, in Steady Thread's case)
- where this project chose to put the review id and token
- what needs restarting after they are written
- the gotchas an agent already paid for once

The proposed rule for agents: before wiring LAHE into an app, look for
`.lahe-setup.md` at that repo's root; follow it if it exists; write it if you
work the setup out yourself. Machine-level setup stays out of it, so one
project's instructions never leak into another's review. The board row has
the proposed AGENTS.md wording and a stub template idea.
