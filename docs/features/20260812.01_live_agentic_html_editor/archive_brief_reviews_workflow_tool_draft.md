# Brief reviews

## review-pm Review (Round 1)

### Blockers

**R5 and R27 collide: batch-level confirmation cannot drive item-level clearing.**
R5 makes the agent confirm a batch; R27 clears an individual comment's highlight when "the agent has
handled" it, and nothing in the brief lets the tool know which items inside a batch were applied.
The burn-down will clear items the agent silently skipped, which is worse than losing feedback
because it looks handled. Or R27 is simply unbuildable and gets quietly dropped.
*Fix:* Make the item the unit of confirmation and the batch just the envelope. The agent names what
it applied and what it declined, with a reason. R28's completed list is the applied set; anything
declined stays active on screen.

**R2 and R26 collide: nothing says who wins when the agent rewrites a block the reviewer is editing.**
R2 says an agent write never discards pending feedback; R26 says the page refreshes itself when the
agent lands a change. The brief never says what happens when both apply to the same block. This is
the exact collision behind Ken's first symptom. The reviewer has an unsent edit to paragraph 4, the
agent rewrites paragraph 4, the page repaints. Whose text is on screen? A builder will pick the easy
answer (the agent's) and reproduce the bug the brief was written to kill.
*Fix:* State the rule in one product-level sentence. Something like: a block the reviewer has unsent
work in is never repainted; the incoming change is shown on that block's card as a collision for the
reviewer to resolve. Any rule is fine, but name one.

**The brief never says whether the tool writes the reviewed file.**
R9 implies two modes exist; R30, R31 and R33 say three target types are never written; nothing says a
static HTML file is written, and no requirement covers what happens when a save conflicts. Writing
files is the root of most of the reverting research: the save baseline advancing before confirmation,
one conflict permanently killing saves for a tab, whole-file re-serialization making diffs
unreviewable, a stale frame writing over the agent's newer file. A builder facing silence will guess,
and the guess is the hard version.
*Fix:* Decide it here. Recommend: v1 never writes the reviewed file, everything is feedback. That
deletes a whole class of the reverting bug, makes R2 nearly free, makes every target type behave
identically (which R31 already demands), and makes R33 unnecessary. If Ken wants autosave, it needs
its own requirement and its own conflict rule, not silence.

**R31 promises localhost review and says nothing about authentication.**
Ken's stated main use is reviewing a shipped Steady Thread feature on localhost:3000, and Steady
Thread requires a login. The reviewed route is fetched by the tool, not by Ken's logged-in browser,
so it carries no session. The first real review session ends at a login page. The research confirms
the coverage here is one happy-path GET.
*Fix:* Say how an authenticated route is reviewed, or make it an explicit v1 non-goal in the brief so
it is discovered now instead of in the demo.

**No requirement covers the reviewed app's own re-renders replacing text the reviewer typed.**
Steady Thread is Hotwire and morphs the DOM constantly. Ken's existing dev comments layer needed a
MutationObserver remount just to keep its own panel alive through a morph, and that trick does not
extend to typed content. The research says the old tool stops watching for scripted DOM changes after
the first user edit, so a re-render that eats typing is never even noticed. R31 promises the hardest
thing in the document with nothing behind it.
*Fix:* Add a requirement that typed text on a self-updating page survives the app's own re-renders,
or is loudly reported when it cannot be, and bound R31 by it.

### Important

**No requirement for a free-text note not tied to any passage or page.**
Both existing tools have one, and the note-only send bug (Send dead forever after typing a note) is
literally one of Ken's three reported symptoms. R3 says send is available whenever there is unsent
feedback, but the brief never establishes that a note is feedback, so the bug can be rebuilt while
satisfying every written requirement.
*Fix:* One requirement: a note not tied to any passage is a first-class item, counts as unsent
feedback, and ships in the batch on its own.

**Q1 is a capability question wrongly scoped as a Steady Thread question.**
The Steady Thread dev layer's defining property is that you can be on any route and comment with
nothing opened first. That is how Ken's live-review sessions work. R31 and R32 both require opening a
target and navigating inside it. Deferring the question means the tool ships without the capability
and nobody notices until the first live review.
*Fix:* Resolve it in this brief. Either add a requirement that the reviewer can attach the tool to a
running app once and wander, or add a non-goal saying this tool does not replace the free-roam dev
layer. Then delete Q1.

**R11 and R16 collide on the click gesture.**
R16 makes the whole document editable so a plain click places the caret; R11 says the reviewer points
at an element to comment on it. The brief names no gesture for either and lets the two collide. This
is the source of the old tool's constant rail flicker and of half-typed comments auto-committing on a
stray click, because every mouse-up opened a compose card. Ken's dev layer already solved it with
Alt-click, and that gesture is in his muscle memory. The brief throws the solution away by not naming
it.
*Fix:* R11 names a modifier gesture. Add that a plain click never opens a compose card. Note
separately that the bare "c" hotkey from the dev layer cannot survive R16 and something has to
replace it.

**R1's second sentence is unfalsifiable and is a debounce window in disguise.**
"The gap between typing something and it being durable is bounded and short enough that no realistic
interruption lands inside it." No test fails without it. It also smuggles a mechanism into a brief
that is otherwise clean of them.
*Fix:* Replace with an observable: a reload, a tab close, or a page change immediately after a
keystroke never loses that keystroke. Let the architecture pick the window.

**The Context paragraph overclaims what carries over from the comments module.**
The brief credits the comments module with saving to the browser on every keystroke, posting to a
local helper, and copy/export when one is not running. That describes the built-doc module only. The
Steady Thread dev layer has no offline path at all: an unsent comment is a localStorage draft, a sent
one requires the Rails endpoint to be up, and there is no copy and no export. R7 rests on this claim
and says the property "carries over unchanged." On the live-app path it does not carry over, it is
new work. The brief understates its own scope.
*Fix:* Name which of the two implementations has the property. State R7 as an addition on the
live-app path, not a carry-over.

**Challenge: "features like submission stop working" may not mean the Send button.**
The brief reads Ken's complaint as the tool's Send button and never considers the other reading. The
research flags it explicitly: inside a review, every click on a link, button, and form submit in the
reviewed page is cancelled, so a reviewed app reads as broken. "Features like submission" sounds more
like the app than the button. The brief picks one reading, drops the other, and then turns the
dropped one into a requirement (R25) framed as desirable.
*Fix:* Ask Ken which he meant. If he meant the reviewed app, R25 ships his complaint as a feature and
the escape gesture needs to be far more prominent than a hover hint.

**Five requirements are two or three requirements welded together.**
A welded requirement gets a partial implementation and a passing review. R25 is three (clicks are
inert / one gesture works / the gesture is taught on hover, which is a design call, not a
requirement). R40 is three. R43 is two unrelated security properties (asset containment, frame
isolation). R44 is three sanitization rules. R37 is the worst case: the payload shape gets the
headline and the post-apply verification is a subordinate clause, when the verification is the only
requirement in the whole brief that defends against an agent rewriting the document wholesale.
*Fix:* Split them. Promote R37's second half to its own requirement: after an agent applies a batch,
the tool checks the reviewer's exact wording is present in the result and says so loudly when it is
not. That is the requirement Ken's own commit in the old repo tried to get with a prompt rule and no
code.

**Nothing says what happens when a second window or instance opens the same target.**
The research has this as a shipped bug in the old tool twice: two servers wiped each other's
comments, and two tabs are two visited sets where the second Send overwrites the first's bookkeeping.
Ken's built-doc helper already runs on a fixed port, so two parallel reviews collide today. Students
will double-open on day one.
*Fix:* One requirement: a second window on the same target joins the same review, or is refused with
a reason. Either is fine; silence is not.

**Nothing says what happens when the reviewer sends again while an earlier batch is unconfirmed.**
This is Ken's most common case, because he sends before an agent is running. In the old tool the
second send replaced the first's record and comments re-shipped forever. R3 promises the wait, R5
promises redelivery, and the two together do not describe a queue.
*Fix:* One sentence: outstanding feedback is a single queue, not a frozen snapshot. A second send adds
to what is outstanding rather than replacing it.

**This is four releases described as one feature, and the riskiest third is the part added last.**
Forty-four requirements with no sequencing means the durability laws (R1 to R9), which are the entire
reason for the rebuild, get built in parallel with the auto-refresh pair (R26, R27) that reintroduces
exactly the mechanism that caused symptom one. The proof that the foundation holds arrives at the
same time as the thing most likely to break it.
*Fix:* Sequence it in user value:
- v1, "everything I leave reaches my agent and nothing I type can be taken away": comment and type
  the fix, on a built doc and a markdown file, nothing ever written to the reviewed file, send never
  gated, markdown record on disk, copy and export with no server running.
- v2, "I can review the running app the same way I review a doc": localhost routes, authentication,
  walking several routes in one pass, surviving the app's own re-renders.
- v3, "my review burns down while the agent works": auto-refresh, applied items clearing, the
  completed list, item-level confirmation.
- v4, "someone other than me can use it": public repo, setup, instructions for three agents.

Ken's three late additions split across v1 (live editing, which belongs in v1) and v3 (auto-update
and clearing, which should follow the durability laws rather than ship beside them).

### Minor

**R35's "markdown record on disk, next to the reviewed material" has no meaning for a localhost
route.** That is the target Ken cares most about, so the requirement is undefined exactly where it is
most load-bearing. *Fix:* Name the location for a URL target. The dev layer's pattern of one known
file already works and Ken already reads it.

**R33's "pages that render themselves with JavaScript are recognized as such" sets no bar on false
positives.** In the old tool this is a one-way latch fired by any early DOM change: a lazy image, a
font swap, an analytics script. It silently demoted pages and contradicted the tool's own documented
promise. "Recognized" as written is satisfied by a detector that is wrong most of the time. *Fix:* If
the tool never writes files, cut R33 entirely and fold it into R9. If it does write, require that the
demotion is shown to the reviewer with its reason and is never silent.

**Nothing says which operating systems v1 supports**, for a tool being launched publicly to students.
The research shows four separate commits of pure Windows tax on the tool being replaced, and the fix
each time was to weaken the test structure. A builder facing silence will attempt Windows and pay
that tax inside this build. *Fix:* A non-goal naming the supported platforms for v1.

### Cut

- **R10 through R15 as six requirements.** They are one requirement: do not regress the two existing
  comment layers, which are the specification. Point at both files and list only what changes
  (element commenting now needs a modifier gesture, and orphaned comments must carry their orphan
  state into the agent payload, which R12 promises on the card and R34 drops from the batch).
- **Non-goal "Not a code editor."** Nobody was going to.
- **Non-goal "Not a way to review a site that is not the reviewer's own."** That is R42 restated. A
  requirement is not a non-goal.
- **Success metric "Ken reaches for typing over commenting for wording fixes."** Nothing collects the
  ratio and no requirement adds instrumentation. It is a post-launch observation, not a ship gate.
- **Success metric "without asking a question that the README should have answered."** Not
  falsifiable. Make it: a student completes a review with no help from Ken.
- **R44's "pasted files are restricted to image types."** It constrains a capability the requirements
  never grant. Either add pasting an image as a requirement or drop the clause.

### Non-goals that would do real work and are missing

Not writing the reviewed file. No revert-all. No reviewing authenticated routes in v1. No Windows in
v1. No mobile.

### Open Questions verdict

- **Q1** is a real question wrongly scoped. Answer the capability half in the brief and move the
  Steady Thread half to the board.
- **Q2** is mostly a skills question that is downstream of this tool existing. The part that belongs
  here, whether the tool needs a no-server embedded mode, is already half-answered by R7. Move the
  rest.
- **Q3** is a settled decision dressed as a question. MIT, credit human-review in the README. It
  blocks nothing. Delete it.
- **Genuinely open and absent:** does the tool write the reviewed file at all; how is an
  authenticated localhost route reviewed; which browsers are supported. Those are the three that
  should carry Q numbers.
