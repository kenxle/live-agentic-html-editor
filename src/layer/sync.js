// The sync client, and the reply poll loop.
//
// Owner: 1B. 3A (agent loop) reads replies through this file rather than
// editing it, which is why the poll loop is built here in Phase 1 against
// protocol.js's reply shapes.
//
// Five promises, and each one is a line of code below rather than a paragraph:
//
//  1. POST PER EVENT, on protocol.js's flush policy: browser storage every
//     keystroke (store.js's job), the helper debounced at 750ms of typing idle,
//     and immediately on blur, ready, navigation and unload.
//  2. RE-POST ANYTHING UNACKNOWLEDGED, on reconnect and on the next load. The
//     queue is in browser storage, not in a JS array, so a reload and a kill -9
//     lose nothing.
//  3. RETRY FOREVER, capped backoff, never give up. A stopped helper costs the
//     reviewer nothing and the backlog drains when it returns.
//  4. NEVER BLOCK THE REVIEWER. Nothing here is awaited on the typing path, and
//     every request carries a deadline: A SUSPENDED HELPER ACCEPTS THE SOCKET
//     AND NEVER ANSWERS, which a client written only against a dead helper
//     hangs on forever.
//  5. TELL A CSP REFUSAL FROM A HELPER THAT IS DOWN. Both surface as a rejected
//     fetch with a deliberately opaque error, and they need opposite fixes:
//     one is "start the helper", the other is "this page's policy refuses the
//     connection". The detection is a real SecurityPolicyViolation event on the
//     document naming connect-src, not a guess from the error text.
//  6. TELL AN UNREGISTERED ORIGIN FROM A HELPER THAT IS DOWN, for the same
//     reason: a refused preflight and a dead helper both surface as a plain
//     network error, and one of them is fixed by `lahe add --origin`. After a
//     network-level failure the client asks health (unauthenticated, so no
//     preflight); if health answers, the helper is up and the origin is the
//     problem, and the chip says so with this page's origin in it.
//
// THE SECOND WINDOW, and the case nothing can cover. Shared storage is refused
// by store.js's Web Lock, which works with the helper down. Separate storage
// can only be refused by the helper's session. Separate storage AND no helper
// is refused by nothing, and that is said on the status line as a named limit
// (D5) rather than quietly claimed as covered.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.sync = factory(
      root.LAHE.protocol,
      root.LAHE.failures,
      root.LAHE.record,
      root.LAHE.overlay,
      root.LAHE.normalize,
      root.LAHE.markers,
      root.LAHE.selection
    );
  } else {
    module.exports = factory(
      require("../shared/protocol.js"),
      require("../shared/failures.js"),
      require("../shared/record.js"),
      require("./overlay.js"),
      require("../shared/normalize.js"),
      require("../shared/markers.js"),
      require("./selection.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  protocol,
  failures,
  record,
  overlay,
  normalize,
  markers,
  selection
) {
  "use strict";

  var STATE = {
    IDLE: "idle",
    IN_FLIGHT: "in_flight",
    RETRYING: "retrying",
    REFUSED: "refused" // a policy refusal. Stops posting; the queue is kept
  };

  // Backoff for the helper being down. Capped, and it never gives up, because
  // the promise is that a stopped helper costs nothing and sync drains when it
  // returns.
  var BACKOFF_MS = [250, 500, 1000, 2000, 5000, 10000, 30000];

  // Every request carries this deadline. It is the difference between a dead
  // helper and a suspended one: a dead helper refuses the connection at once, a
  // suspended one accepts it and answers nothing, and only a deadline turns the
  // second into a status line the reviewer can read.
  var REQUEST_TIMEOUT_MS = 2000;

  // How many times drainOutbox re-posts before it answers anyway. Each pass
  // sends everything the store holds at that moment, so a second pass only
  // exists for a keystroke that landed while the first was in flight. Three is
  // a bound on a loop that must not spin, never a retry policy: retries are
  // scheduleRetry's, and they keep going forever.
  var DRAIN_ATTEMPTS = 3;

  // THE HELPER GETS REPLACED UNDER A LIVE PAGE. Any command that needs a helper
  // newer than the running one stops it and starts another, and on a day when
  // code is landing that happens several times an hour. For the second or two
  // that takes, this page's requests fail and its heartbeat is answered by a
  // process that has not read the session table yet. Both used to be acted on at
  // once: the page dropped to read-only, which closes every comment box the
  // reviewer has open, and it blamed the page's address for not being
  // registered when the real answer was "wait a moment" (reviews r4915e2d5d632
  // and r929a3d60b3cb, 2026-09-10 and 2026-09-11).
  //
  // So an ambiguous refusal has to REPEAT before the page believes it. Three
  // consecutive misses, retried faster than the heartbeat so the three take
  // about three seconds rather than half a minute. Any answer at all resets the
  // count. The one refusal that is never waited out is a window deposed by an
  // explicit Review here instead: that is a person deciding, not a machine
  // restarting, and it says so on the wire.
  var CLAIM_MISSES_BEFORE_READ_ONLY = 3;
  var CLAIM_RETRY_MS = 1200;

  // How long after the last answered request a failing page is given the benefit
  // of the doubt about WHY it is failing. Inside this window a failure reads as
  // the helper being down, which during a restart it is; past it the origin
  // diagnosis runs as before. A page that has never had an answer is not in any
  // window and is diagnosed on its first failure, which is the page whose origin
  // really was never registered.
  var RESTART_GRACE_MS = 6000;

  // The library's own poll of the helper. A visible review stays responsive;
  // a hidden document needs only a low-frequency safety check because it polls
  // immediately when it becomes visible again. The cursor is
  // protocol.REPLY_CURSOR_FIELD, a seq, never a timestamp.
  var POLL_INTERVAL_MS = 1000;
  var HIDDEN_POLL_INTERVAL_MS = 10000;

  function pollIntervalFor(doc) {
    return doc && doc.hidden === true ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  }

  // One reading of the wall clock, in one place, so a test that wants to move it
  // has one thing to move.
  function nowMs() {
    return Date.now();
  }

  // -------------------------------------------------------------------------
  // R36: the page updates itself as the agent lands changes
  // -------------------------------------------------------------------------
  //
  // D7 grounded R36 but assumed the serving environment supplies the refresh: a
  // dev server hot-reloads and the agent's landed change arrives as a repaint.
  // A built static page behind a plain http server refreshes nothing, ever, so
  // for the commonest case R36 was unmet and the reviewer had to be told to
  // press reload. The reply poll already runs every second and now carries the
  // reviewed file's mtime, so the trigger is free: a DIFFERENT non-null value
  // from the one this page last saw means the file was rebuilt under it.
  //
  // This does not fight a framework that hot-reloads on its own. The comparison
  // is against the mtime this page last SAW, so a page its own dev server
  // already repainted still holds the old value here and gets exactly one
  // reload, and after any reload the fresh page starts from the current mtime
  // and is quiet again. Reloading a page that repainted itself costs the
  // reviewer nothing anyway: the replay pass is what makes a reload safe.
  //
  // Two waits, both here rather than at the call sites:
  //
  //  1. DEBOUNCE. A rebuild writes the file more than once, so a change starts a
  //     timer rather than a reload, and further changes inside the window just
  //     update the target. One rebuild is one reload.
  //  2. NEVER MID-WORK. An open edit session or a comment being typed defers the
  //     reload (isBusy), and it fires on the first poll after they are done. A
  //     page that swaps under a half-typed sentence is the one failure this
  //     feature could introduce.
  var RELOAD_DEBOUNCE_MS = 1500;

  // The pause between saying "Page updated. Reloading..." and doing it, so the
  // sentence is on screen before the page goes away.
  var RELOAD_NOTICE_MS = 250;

  // LAHE's own reload is the one navigation where the browser cannot know the
  // reviewer's intended viewport after a rebuilt document lands. Keep one
  // exact, versioned marker in this tab only. It is consumed by the next real
  // boot, never by inject.js's SPA, Turbo, popstate, or bfcache remounts.
  var VIEWPORT_MARKER_VERSION = 1;
  var VIEWPORT_MARKER_KEY = "lahe.viewport.v1";

  // The rail's own marker, beside the viewport one and never inside it: the
  // viewport marker is about where the PAGE was, this is about what the TOOL
  // was showing, they are written by different owners, and a malformed or
  // missing one of these must not cost the reviewer the other.
  //
  // Why it exists: Ken clicked a toast, the rail opened on the card, and two
  // seconds later a rebuild for a different review reloaded the page. The rail
  // came back in its default state and the card he was reading "disappeared out
  // from in front of me". A reload the tool starts on its own must give the
  // reviewer back exactly what it took.
  var RAIL_MARKER_VERSION = 1;
  var RAIL_MARKER_KEY = "lahe.rail.v1";

  function removeViewportMarker(storage) {
    try {
      if (storage && typeof storage.removeItem === "function") storage.removeItem(VIEWPORT_MARKER_KEY);
    } catch (error) {
      // Best effort. A denied sessionStorage must never prevent the reload.
    }
  }

  function setScrollRestoration(win, mode) {
    try {
      if (!win || !win.history || !("scrollRestoration" in win.history)) return false;
      win.history.scrollRestoration = mode;
      return win.history.scrollRestoration === mode;
    } catch (error) {
      return false;
    }
  }

  function restoreNativeScrollingAfterPageShow(win) {
    if (!win || typeof win.addEventListener !== "function") {
      setScrollRestoration(win, "auto");
      return;
    }
    try {
      // Native reload restoration is complete by pageshow. Keeping manual mode
      // through that point prevents a later browser scroll from competing with
      // the exact restore below. A direct/test call after load has no event left
      // to hear, so it returns to auto immediately.
      if (win.document && win.document.readyState !== "complete") {
        win.addEventListener(
          "pageshow",
          function () {
            setScrollRestoration(win, "auto");
          },
          { once: true }
        );
        return;
      }
    } catch (error) {
      // Fall through to the immediate, safe reset.
    }
    setScrollRestoration(win, "auto");
  }

  function navigationType(win) {
    try {
      if (!win || !win.performance || typeof win.performance.getEntriesByType !== "function") return null;
      var entries = win.performance.getEntriesByType("navigation");
      return entries && entries[0] && typeof entries[0].type === "string" ? entries[0].type : null;
    } catch (error) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // A reload that lands where the reviewer was looking
  // ---------------------------------------------------------------------------
  //
  // The pixel offset alone is not where the reviewer was. A rebuilt page whose
  // content grew or shrank ABOVE the viewport puts the same number of pixels on
  // a different sentence, and late-drawn content (mermaid, an image with no
  // dimensions, a webfont swapping in) moves the layout again after the restore
  // has already run. Both read as the page jumping under them.
  //
  // So the marker carries what the reviewer was looking AT, not only how far
  // down it was: the normalized text of the topmost visible block and that
  // block's offset from the top of the viewport. On the way back in, the block
  // is found by its text and put back at the same offset, and the pixel pair is
  // still there as the fallback for every case the text cannot answer.
  //
  // The honesty rule is the anchor ladder's, deliberately: a text that matches
  // once is the block, and a text that matches zero or several times is not an
  // answer, so it falls back to pixels rather than guessing.

  // Blocks, as selection.js means them. One notion of "this paragraph" across
  // the library: the gesture that makes a block editable and the block this
  // scrolls to are the same element.
  var BLOCK_SELECTOR = selection.BLOCK_TAGS.join(",");

  // A bound on the scan, so a pathological document cannot turn a reload into a
  // long synchronous walk. Also the snapshot cap below.
  //
  // The scan collects ONE MORE than the cap on purpose. A list truncated at the
  // cap looks like a complete list of a smaller page, and every block past the
  // cut would then read as removed on one side and new on the other. The extra
  // entry is the overflow signal: a caller that sees more than the cap knows the
  // page is too big and sits the comparison out rather than painting nonsense.
  var MAX_BLOCKS_SCANNED = 4000;

  /**
   * The blocks a reviewer would point at, in document order.
   *
   * LEAF BLOCKS ONLY. Every wrapper div is a block by tag, and counting them
   * would make the topmost "visible block" the one holding the whole page. A
   * block whose next block in document order is inside it is a container, since
   * descendants always follow their ancestor in document order, so this is the
   * leaf test and it is linear rather than pairwise.
   *
   * The cost: a container holding text of its own AND a nested block loses its
   * own words here. That is the right trade for this job, where the question is
   * which single element the reviewer's eye was on.
   *
   * @returns {Array<{el: Element, text: string}>}
   */
  function blockCandidates(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") return [];
    var found;
    try {
      found = doc.querySelectorAll(BLOCK_SELECTOR);
    } catch (error) {
      return [];
    }
    var withText = [];
    for (var i = 0; i < found.length && withText.length <= MAX_BLOCKS_SCANNED; i += 1) {
      var el = found[i];
      if (markers.isInsideOverlay(el)) continue;
      // A live region, a hidden region, or anything announcing that it is a
      // copy rather than the page. See isInsideMirror.
      if (isInsideMirror(el)) continue;
      var text = "";
      try {
        text = normalize.normalizeText(el.textContent || "");
      } catch (error) {
        text = "";
      }
      if (!text) continue;
      withText.push({ el: el, text: text });
    }
    var out = [];
    for (var j = 0; j < withText.length; j += 1) {
      var next = withText[j + 1];
      var el2 = withText[j].el;
      if (next && typeof el2.contains === "function" && el2.contains(next.el)) continue;
      out.push(withText[j]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // A MIRROR OF THE PAGE'S TEXT IS NOT A CHANGE
  // ---------------------------------------------------------------------------
  //
  // reveal.js keeps an off-screen announcer, `div.aria-status` with
  // aria-live="polite", and copies the current slide's words into it for screen
  // readers. So an agent rewording the slide the presenter is standing on
  // changes the page in two places, and the change mark painted both: the
  // paragraph, and a copy of the paragraph nobody can see. The reveal spec used
  // to sidestep it by editing a slide the deck was not sitting on, which is a
  // test walking around a bug rather than reporting it.
  //
  // Anything a page keeps as a copy of its own text announces itself the same
  // way, because the copy exists for assistive technology and has to say so:
  //
  //   aria-live (any value)      a region that announces its own changes
  //   role=status|alert|log      the three roles that are live by definition
  //
  // "HIDDEN" IS NOT ON THAT LIST, and reveal is the reason for both spellings of
  // it. A deck marks every slide that is not the current one with BOTH the
  // hidden attribute and aria-hidden="true", which is correct of it: a slide off
  // screen is not part of the accessible page right now. But it is still the
  // reviewer's document, and most of what an agent changes is not on screen at
  // the moment it lands, so reading either one as "this is a copy, ignore it"
  // blinds the mark to nearly every real edit in a deck. Measured: with the
  // hidden attribute on the list, a six slide deck offered six blocks to the
  // comparison, all of them on the slide in front of the reviewer.
  //
  // A copy that is hidden and NOT a live region is caught at paint time instead,
  // by its box: see isVisuallyHidden.
  //
  // The check walks ancestors, because the attribute is on the region and the
  // text is in a block inside it. It runs at scan time, so a mirror is out of
  // BOTH readings of the old page and out of the new one: it can neither be
  // painted nor make anything else look like it moved.
  var LIVE_ROLES = ["status", "alert", "log"];

  function isInsideMirror(el) {
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard < 60) {
      if (typeof node.hasAttribute === "function") {
        if (node.hasAttribute("aria-live")) return true;
        var role = node.getAttribute("role");
        if (role && LIVE_ROLES.indexOf(String(role).toLowerCase()) !== -1) return true;
      }
      node = node.parentNode;
      guard += 1;
    }
    return false;
  }

  /**
   * The other half of the same rule: the `.sr-only` convention.
   *
   * A screen-reader-only copy is a real, laid-out element one pixel square with
   * its overflow clipped, so it has a box and the box is tiny. That is the test,
   * and it is deliberately NOT "is this element invisible": a slide reveal has
   * taken out of layout with display:none has no box at all, and the agent's
   * edit to it is real news the reviewer should see when they navigate to it.
   * getClientRects tells the two apart: none at all means out of layout, one
   * tiny one means hidden on purpose.
   *
   * Cost is why this is not in the scan: it is a layout read, so it runs only
   * for a block that is about to be painted, never for every block on the page.
   */
  function isVisuallyHidden(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;

    try {
      if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
      var rect = el.getBoundingClientRect();
      return rect.width <= 1 && rect.height <= 1;
    } catch (error) {
      return false;
    }
  }

  /**
   * Where a block SITS, written so it survives a rebuild.
   *
   * Tag names and sibling positions from the body down: "MAIN[0]/P[3]". A bare
   * index into the block list does not survive, and that is not a theory. The
   * reviewer edits a paragraph, so that paragraph is one of the blocks that
   * differ between the old page's two readings; the agent then adds a paragraph
   * above it; and the added paragraph lands on the index the edited one used to
   * hold, so the one thing the reviewer most needs to see is the one thing that
   * gets suppressed. A structural path moves only when the structure above the
   * element moves, which is the right sensitivity for "this is the same slide
   * number in the same corner of the page".
   *
   * @returns {string} the path, or "" when it cannot be computed
   */
  function blockPath(el) {
    if (!el || el.nodeType !== 1) return "";
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && node.tagName !== "BODY" && guard < 40) {
      var index = 0;
      var sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.push(node.tagName + "[" + index + "]");
      node = node.parentElement;
      guard += 1;
    }
    return parts.reverse().join("/");
  }

  /** Every leaf block's normalized text, in document order. */
  function blockTextsIn(doc) {
    return blockCandidates(doc).map(function (entry) {
      return entry.text;
    });
  }

  /**
   * The topmost block the reviewer can see, and how far below the viewport's
   * top edge it sits. Partly visible counts: a paragraph running off the top of
   * the screen is still the one being read.
   */
  function topBlockAnchor(win) {
    var doc = win && win.document;
    if (!doc || typeof win.innerHeight !== "number") return null;
    var blocks = blockCandidates(doc);
    for (var i = 0; i < blocks.length; i += 1) {
      var el = blocks[i].el;
      if (typeof el.getBoundingClientRect !== "function") continue;
      var rect = el.getBoundingClientRect();
      if (!rect) continue;
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.bottom <= 0) continue;
      if (rect.top >= win.innerHeight) continue;
      return { text: blocks[i].text, offset: rect.top };
    }
    return null;
  }

  /**
   * The one block whose text is this text, or null.
   *
   * Null for zero matches and null for several: an ambiguous match is not an
   * answer, and the caller falls back to the pixel offset rather than scrolling
   * to whichever copy came first.
   */
  function findUniqueBlock(doc, text) {
    if (!doc || typeof text !== "string" || !text) return null;
    var blocks = blockCandidates(doc);
    var hit = null;
    for (var i = 0; i < blocks.length; i += 1) {
      if (blocks[i].text !== text) continue;
      if (hit) return null;
      hit = blocks[i].el;
    }
    return hit;
  }

  /**
   * Put the marker's block back where it was, or fall back to the pixels.
   *
   * @returns {{byBlock: boolean, text: string|null, offset: number|null}}
   */
  function scrollToMarker(win, marker) {
    var el = typeof marker.blockText === "string" ? findUniqueBlock(win.document, marker.blockText) : null;
    if (el && typeof el.getBoundingClientRect === "function" && typeof win.scrollY === "number") {
      var rect = el.getBoundingClientRect();
      var top = win.scrollY + rect.top - marker.blockOffset;
      if (Number.isFinite(top)) {
        win.scrollTo({ left: marker.x, top: Math.max(0, Math.round(top)), behavior: "instant" });
        return { byBlock: true, text: marker.blockText, offset: marker.blockOffset };
      }
    }
    win.scrollTo({ left: marker.x, top: marker.y, behavior: "instant" });
    return { byBlock: false, text: null, offset: null };
  }

  // What the last restore on this page did. index.js reads it to decide whether
  // there is a block worth re-asserting as the page finishes drawing itself.
  var lastRestore = null;

  function lastReloadRestore() {
    return lastRestore;
  }

  // ---------------------------------------------------------------------------
  // What changed: the page's block texts, across a reload
  // ---------------------------------------------------------------------------
  //
  // After a reload the reviewer is looking at a page that is different in some
  // way they asked for and cannot see. So the outgoing page writes down what its
  // blocks said, and the incoming page compares. index.js paints the difference.
  //
  // Stored beside the viewport marker and read once, because a snapshot that
  // outlives its reload would paint a second page's changes onto a first page's
  // text.
  var BLOCK_SNAPSHOT_VERSION = 1;
  var BLOCK_SNAPSHOT_KEY = "lahe.blocks.v1";

  // WHY THE REASON IS STORED, and why it gates the whole comparison.
  //
  // The mark means "the agent changed this". A reload that happened for any
  // other reason (the helper healing the script line back in, a second window
  // taking over, the reviewer pressing reload themselves) has no agent edit
  // behind it, so there is nothing to report and the comparison does not run.
  // Only the reload LAHE fires because the reviewed file's mtime moved carries
  // this reason, and takeBlockSnapshot refuses anything else.
  var RELOAD_REASON = { REBUILT: "target_mtime" };

  // The cap, in two numbers, and what happens at it: nothing is stored and the
  // feature sits out that one reload. A page big enough to hit this is a page
  // where the diff would cost more than the paint is worth, and a highlight that
  // did not appear is a smaller failure than a reload that stalls.
  var SNAPSHOT_MAX_BLOCKS = MAX_BLOCKS_SCANNED;
  var SNAPSHOT_MAX_BYTES = 1048576;

  // A PAGE THAT CHANGES ITSELF IS NOT THE AGENT, and this is the whole of that
  // rule.
  //
  // Ken, on a reveal.js deck: "that countdown timer is automatically dynamic.
  // The agent is not changing it, but the highlight is applying to it because
  // it's changing. I'm seeing that on page number changes as well. That's not
  // how the highlight should work. It should only be things that the agent
  // changed, not anything that changes."
  //
  // So the old page is read TWICE before it goes away: once when it has settled
  // after boot, and once at reload time. Anything whose words moved between
  // those two readings moved on its own, because no rebuild happened in between.
  // A clock, a countdown, a slide number, a hit counter: all of them announce
  // themselves that way, and all of them are excluded from the comparison the
  // next page runs.
  //
  // The exclusion is by POSITION and by TEXT, because either one alone leaks:
  // the block may sit at a different index after the rebuild, and the text it
  // shows may be a third value by then.

  // The reading taken when this page settled. Set by index.js at boot and again
  // at the end of replay's settling window, so a reload that beats the settle
  // still has a baseline to compare against.
  var stableBlockTexts = null;

  function noteStableBlocks(texts) {
    stableBlockTexts = Array.isArray(texts) ? texts.slice() : null;
    return stableBlockTexts;
  }

  function stableBlocks() {
    return stableBlockTexts;
  }

  /**
   * Which blocks moved on their own between two readings of the SAME page.
   *
   * Positional, deliberately. Nothing rebuilt between the two readings, so a
   * block that is at a different index is a block the page added or removed by
   * itself, and a page doing that is a page whose comparison cannot be trusted
   * anyway. The result there is conservative: many positions differ, many
   * exclusions, and the next page paints little or nothing. Painting nothing is
   * the right failure for a mark that means "the agent did this".
   *
   * @returns {{indexes: Array<number>, texts: Array<string>}}
   */
  function selfChangingBlocks(baseline, current) {
    var indexes = [];
    var texts = [];
    if (!Array.isArray(baseline) || !Array.isArray(current)) return { indexes: indexes, texts: texts };
    var span = Math.max(baseline.length, current.length);
    for (var i = 0; i < span; i += 1) {
      var was = baseline[i];
      var now = current[i];
      if (was === now) continue;
      indexes.push(i);
      if (typeof was === "string" && texts.indexOf(was) === -1) texts.push(was);
      if (typeof now === "string" && texts.indexOf(now) === -1) texts.push(now);
    }
    return { indexes: indexes, texts: texts };
  }

  // A block this short that is only digits and the punctuation counters are
  // written with is almost certainly a counter: "12:04", "3 / 40", "87%",
  // "2 of 9".
  var COUNTER_TEXT_MAX = 12;

  /**
   * A GUARD, NOT THE RULE. The rule is the two readings above, and it catches a
   * counter that actually ticked. This catches the one that happened to hold
   * still across both readings and then ticked after the reload, which would
   * otherwise be painted as the agent's work. It is deliberately narrow: short,
   * and nothing in it but digits, the separators counters use, and the word
   * "of". Any real sentence fails it.
   */
  function looksLikeACounter(text) {
    if (typeof text !== "string") return false;
    if (!text || text.length >= COUNTER_TEXT_MAX) return false;
    if (!/\d/.test(text)) return false;
    return text.replace(/of/gi, "").replace(/[\d\s:/%.,-]/g, "") === "";
  }

  /**
   * The stored form, or null when it is over the cap.
   *
   * @returns {string|null} the JSON to store
   */
  function snapshotPayload(review, href, texts, excluded, reason) {
    if (!Array.isArray(texts) || texts.length === 0) return null;
    if (texts.length > SNAPSHOT_MAX_BLOCKS) return null;
    var json;
    try {
      json = JSON.stringify({
        version: BLOCK_SNAPSHOT_VERSION,
        exactHref: href,
        review: review,
        reason: reason || RELOAD_REASON.REBUILT,
        texts: texts,
        excludedPaths: (excluded && excluded.paths) || [],
        excludedTexts: (excluded && excluded.texts) || []
      });
    } catch (error) {
      return null;
    }
    if (json.length > SNAPSHOT_MAX_BYTES) return null;
    return json;
  }

  /** Write down what this page says, for the page that replaces it. */
  function saveBlockSnapshot(win, review, reason) {
    if (!win || !win.location || !review) return false;
    var storage = null;
    try {
      storage = win.sessionStorage;
    } catch (error) {
      return false;
    }
    if (!storage || typeof storage.setItem !== "function") return false;
    var href = typeof win.location.href === "string" ? win.location.href : "";
    var json = null;
    try {
      var entries = blockCandidates(win.document);
      var texts = entries.map(function (entry) {
        return entry.text;
      });
      var moving = selfChangingBlocks(stableBlockTexts, texts);
      var excluded = { paths: [], texts: moving.texts };
      moving.indexes.forEach(function (index) {
        var entry = entries[index];
        var path = entry ? blockPath(entry.el) : "";
        if (path && excluded.paths.indexOf(path) === -1) excluded.paths.push(path);
      });
      json = snapshotPayload(review, href, texts, excluded, reason);
    } catch (error) {
      json = null;
    }
    try {
      if (!json) {
        if (typeof storage.removeItem === "function") storage.removeItem(BLOCK_SNAPSHOT_KEY);
        return false;
      }
      storage.setItem(BLOCK_SNAPSHOT_KEY, json);
    } catch (error) {
      return false;
    }
    return true;
  }

  /**
   * Read the outgoing page's blocks, ONCE. The key is removed on the way past
   * whatever the answer is, so a snapshot is never used twice.
   *
   * @returns {{texts: Array<string>, excludedPaths: Array<string>,
   *            excludedTexts: Array<string>}|null}
   */
  function takeBlockSnapshot(win, review) {
    if (!win || !win.location || !review) return null;
    var raw = null;
    try {
      var storage = win.sessionStorage;
      if (!storage || typeof storage.getItem !== "function") return null;
      raw = storage.getItem(BLOCK_SNAPSHOT_KEY);
      if (raw !== null && typeof storage.removeItem === "function") storage.removeItem(BLOCK_SNAPSHOT_KEY);
    } catch (error) {
      return null;
    }
    if (!raw) return null;
    var stored = null;
    try {
      stored = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    var href = typeof win.location.href === "string" ? win.location.href : "";
    if (!stored || stored.version !== BLOCK_SNAPSHOT_VERSION) return null;
    if (stored.review !== review || stored.exactHref !== href) return null;
    // Only the agent's rebuild has anything to report. See RELOAD_REASON.
    if (stored.reason !== RELOAD_REASON.REBUILT) return null;
    if (!Array.isArray(stored.texts)) return null;
    return {
      texts: stored.texts,
      excludedPaths: Array.isArray(stored.excludedPaths) ? stored.excludedPaths : [],
      excludedTexts: Array.isArray(stored.excludedTexts) ? stored.excludedTexts : []
    };
  }

  /**
   * Which blocks of the new page are new or different, minus the ones that were
   * never the agent's doing.
   *
   * A MULTISET DIFFERENCE, not a longest common subsequence. LCS is the textbook
   * answer and it is the wrong one here: it is O(n*m), which at the 4000-block
   * cap is sixteen million cells to fill in on the main thread of a page the
   * reviewer is trying to read. The multiset is one pass over each side.
   *
   * What it buys and what it costs, plainly:
   *
   *   a block whose text is not in the old page at all      painted
   *   a block whose text was edited (so the new text is new)painted
   *   a block that only MOVED                               not painted, which
   *                                                         is right: nothing
   *                                                         about it changed
   *   a paragraph that now appears twice where it appeared   the second copy is
   *   once                                                  painted, because the
   *                                                         count is tracked
   *   a block the old page was already changing by itself    never painted; see
   *                                                          selfChangingBlocks
   *
   * REMOVALS ARE NOT PAINTED, and that is deliberate rather than missing. Text
   * that is gone has nothing to paint, and marking the block that now sits where
   * it used to be would put a change highlight on words that did not change,
   * which is worse than saying nothing.
   *
   * @param {Object|Array<string>|null} before the snapshot the old page stored,
   *        or just its texts
   * @param {Array<string>} after  the new page's block texts, in order
   * @returns {Array<number>} indexes into `after`
   */
  function diffBlockTexts(before, after) {
    var changed = [];
    if (!Array.isArray(after) || after.length === 0) return changed;
    var snapshot = Array.isArray(before) ? { texts: before } : before || {};
    var texts = Array.isArray(snapshot.texts) ? snapshot.texts : null;
    // No baseline is not "everything changed". A first load has nothing to
    // compare against, and lighting the whole page up would be noise.
    if (!texts || texts.length === 0) return changed;
    var counts = Object.create(null);
    for (var i = 0; i < texts.length; i += 1) {
      var key = "t:" + texts[i];
      counts[key] = (counts[key] || 0) + 1;
    }
    for (var j = 0; j < after.length; j += 1) {
      var k = "t:" + after[j];
      if (counts[k] > 0) counts[k] -= 1;
      else changed.push(j);
    }
    return changed;
  }

  /**
   * Should this block be left alone, however different it looks?
   *
   * Three reasons, and the first two are the rule: the page was already
   * changing this block by itself (its path, or one of the texts it wore), or it
   * reads as a counter. The caller has the element, which is why the path is
   * passed in rather than looked up here.
   *
   * @param {Object|null} snapshot from takeBlockSnapshot
   * @param {string} text the block's normalized text now
   * @param {string} path blockPath(el)
   * @returns {boolean}
   */
  function isExcludedBlock(snapshot, text, path) {
    if (looksLikeACounter(text)) return true;
    if (!snapshot) return false;
    var texts = Array.isArray(snapshot.excludedTexts) ? snapshot.excludedTexts : [];
    if (texts.indexOf(text) !== -1) return true;
    var paths = Array.isArray(snapshot.excludedPaths) ? snapshot.excludedPaths : [];
    return !!path && paths.indexOf(path) !== -1;
  }

  // ---------------------------------------------------------------------------
  // Holding the page still while it finishes arriving
  // ---------------------------------------------------------------------------

  // How long the incoming page may be held invisible before it is shown no
  // matter what. Short: this is cover for the first correction, not a loading
  // screen, and a page held longer than this reads as a stall rather than as
  // steadiness. Never longer than replay's settling window.
  var STEADY_HIDE_MS = 300;

  // The fade back in. Long enough to read as a fade, short enough that the
  // reviewer is looking at the page rather than at the fade.
  var STEADY_FADE_MS = 120;

  // Below this, a correction would move the page for no reason a reviewer could
  // see. Sub-pixel layout differences land here every time.
  var STEADY_DRIFT_PX = 2;

  // The default window over which late rendering is still expected. index.js
  // passes replay.SETTLE_MS; this is the answer when nobody says.
  var STEADY_SETTLE_MS = 2000;

  function prefersReducedMotion(win) {
    try {
      if (!win || typeof win.matchMedia !== "function") return false;
      return !!win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  }

  /**
   * Keep the reloaded page on its block while the page finishes arriving, and
   * hide the moving about until it has.
   *
   * THE PAGE IS NEVER LEFT HIDDEN. The style goes on in a try/finally, a hard
   * timeout removes it whatever else happens, and reveal() is idempotent. The
   * inline style is the one transient write this makes to the page's own DOM,
   * it is made inside an epoch so replay does not read its own reflection, and
   * the element's previous style attribute is put back exactly as it was.
   *
   * THE REVIEWER ALWAYS WINS. A scroll, a key, a wheel or a touch ends the
   * corrections on the spot: the page is theirs the moment they act on it, and
   * a tool that scrolls them back is worse than one that never scrolled at all.
   *
   * @param {Window} win
   * @param {Object} options {text, offset, settleMs}
   * @returns {Object} a handle for tests: {correct, reveal, stop, state}
   */
  function steadyAfterReload(win, options) {
    var opts = options || {};
    var handle = null;
    var doc = win && win.document;
    var root = doc && doc.documentElement;
    var settleMs = typeof opts.settleMs === "number" && opts.settleMs > 0 ? opts.settleMs : STEADY_SETTLE_MS;
    var reduced = prefersReducedMotion(win);
    var timers = [];
    var unbinders = [];
    var revealed = false;
    var stopped = false;
    var corrections = 0;
    var expectedY = typeof win.scrollY === "number" ? win.scrollY : null;
    var previousStyle = null;
    var hidden = false;

    // THE ONE WRITE THIS MAKES TO THE PAGE, and why it is not inside an epoch.
    //
    // The epoch rule exists so the library's own DOM writes do not retrigger
    // the observers watching the page. No observer here can see this write:
    // index.js watches body for childList and characterData, protect and inject
    // watch documentElement for the same two, and not one of them asks for
    // attributes. So an inline style on documentElement reaches nothing.
    //
    // Wrapping it anyway costs something real, which is how this was found. The
    // hide happens at the very top of boot, and an epoch's depth only unwinds in
    // a microtask, so the epoch stays OPEN for the whole of the rest of boot,
    // including replay's first scheduled pass. That pass sees a write epoch in
    // progress and declines, and the reviewer's committed edits are never
    // re-applied to the page that just reloaded (caught by
    // test/browser/paragraph_break.spec.js).
    function writeToRoot(reason, fn) {
      return fn();
    }

    function later(fn, ms) {
      if (!win || typeof win.setTimeout !== "function") return null;
      var id = win.setTimeout(fn, ms);
      timers.push(id);
      return id;
    }

    function hide() {
      if (!root || typeof root.setAttribute !== "function") return false;
      if (reduced) return false;
      try {
        previousStyle = root.getAttribute("style");
        writeToRoot("sync.steady-reload-hide", function () {
          root.setAttribute("style", (previousStyle ? previousStyle + ";" : "") + "opacity:0");
        });
        hidden = true;
      } finally {
        // The page is shown again even if the line above threw halfway.
        later(reveal, STEADY_HIDE_MS);
      }
      return hidden;
    }

    function restoreStyle() {
      writeToRoot("sync.steady-reload-show", function () {
        if (previousStyle === null) root.removeAttribute("style");
        else root.setAttribute("style", previousStyle);
      });
    }

    function reveal() {
      if (revealed) return false;
      revealed = true;
      if (!hidden || !root) return true;
      if (reduced) {
        restoreStyle();
        return true;
      }
      writeToRoot("sync.steady-reload-fade", function () {
        root.setAttribute(
          "style",
          (previousStyle ? previousStyle + ";" : "") +
            "opacity:1;transition:opacity " +
            STEADY_FADE_MS +
            "ms linear"
        );
      });
      // The transition property is temporary too: it goes with the rest of the
      // inline style as soon as the fade is over, so the page is left exactly as
      // the page's own stylesheet drew it.
      later(restoreStyle, STEADY_FADE_MS + 20);
      return true;
    }

    /** Re-find the block and correct the scroll if it drifted. */
    function correct() {
      if (stopped || !doc) return false;
      var moved = false;
      try {
        var el = findUniqueBlock(doc, opts.text);
        if (el && typeof el.getBoundingClientRect === "function" && typeof win.scrollY === "number") {
          var delta = el.getBoundingClientRect().top - opts.offset;
          if (Math.abs(delta) > STEADY_DRIFT_PX && typeof win.scrollTo === "function") {
            var top = Math.max(0, Math.round(win.scrollY + delta));
            expectedY = top;
            win.scrollTo({ left: win.scrollX, top: top, behavior: "instant" });
            corrections += 1;
            moved = true;
          }
        }
      } catch (error) {
        // A correction that throws is a correction not made. It must never cost
        // the reviewer a page stuck at opacity 0.
      } finally {
        reveal();
      }
      return moved;
    }

    function stop() {
      if (stopped) return false;
      stopped = true;
      unbinders.splice(0).forEach(function (off) {
        try {
          off();
        } catch (error) {
          // Nothing to do about a listener that will not come off.
        }
      });
      // The corrections are over, so the browser gets its own scroll
      // restoration back. restoreViewportAfterReload held it at manual for
      // exactly this window; see the note there.
      restoreNativeScrollingAfterPageShow(win);
      reveal();
      return true;
    }

    function bind(name, handler, opts2) {
      if (!win || typeof win.addEventListener !== "function") return;
      win.addEventListener(name, handler, opts2 || false);
      unbinders.push(function () {
        if (typeof win.removeEventListener === "function") win.removeEventListener(name, handler);
      });
    }

    // Our own scrollTo fires a scroll event, so "the reviewer scrolled" cannot
    // be "a scroll event happened". A scroll that lands where we just put it is
    // ours; anything else is theirs.
    function onScroll() {
      if (expectedY !== null && typeof win.scrollY === "number" && Math.abs(win.scrollY - expectedY) <= 1) return;
      stop();
    }
    function onReviewer() {
      stop();
    }

    if (typeof opts.text === "string" && opts.text && typeof opts.offset === "number") {
      hide();
      bind("scroll", onScroll, { passive: true });
      bind("keydown", onReviewer, true);
      bind("pointerdown", onReviewer, true);
      bind("wheel", onReviewer, { passive: true });
      bind("touchstart", onReviewer, { passive: true });

      if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(correct);
      else later(correct, 0);

      if (doc.readyState !== "complete") bind("load", correct, { once: true });

      try {
        if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === "function") {
          doc.fonts.ready.then(function () {
            correct();
          }, function () {});
        }
      } catch (error) {
        // A document with no font loading API has nothing to wait for.
      }

      later(function () {
        correct();
        stop();
      }, settleMs + 50);
    } else {
      // No block to hold on to: the pixel restore already happened and there is
      // nothing to correct, so nothing is hidden and nothing is listened for.
      revealed = true;
    }

    handle = {
      correct: correct,
      reveal: reveal,
      stop: stop,
      state: function () {
        return { corrections: corrections, revealed: revealed, stopped: stopped, hidden: hidden, reduced: reduced };
      }
    };
    lastSteadyHandle = handle;
    return handle;
  }

  // The controller the last reload built, so a browser test can ask what it did
  // rather than inferring it from pixels. Nothing in the library reads it.
  var lastSteadyHandle = null;

  function lastSteady() {
    return lastSteadyHandle;
  }

  /**
   * Remember the viewport for the reload LAHE is about to initiate.
   *
   * Manual restoration is enabled only after the marker is durable. If either
   * storage or history refuses us, the marker is removed and the browser keeps
   * its native behaviour.
   */
  function saveViewportForReload(win, review) {
    if (!win || !win.location || !review) return false;

    var storage = null;
    try {
      storage = win.sessionStorage;
    } catch (error) {
      return false;
    }
    if (!storage || typeof storage.setItem !== "function") return false;

    // A fragment is an instruction to the browser. Do not replace anchor
    // navigation with coordinates captured from the old document.
    if (typeof win.location.hash === "string" && win.location.hash) {
      removeViewportMarker(storage);
      setScrollRestoration(win, "auto");
      return false;
    }

    var href = typeof win.location.href === "string" ? win.location.href : "";
    var x = typeof win.scrollX === "number" ? win.scrollX : 0;
    var y = typeof win.scrollY === "number" ? win.scrollY : 0;
    if (!href || !Number.isFinite(x) || !Number.isFinite(y)) return false;

    var marker = { version: VIEWPORT_MARKER_VERSION, exactHref: href, review: review, x: x, y: y };
    // The content anchor, when the page has one to give. Absent rather than
    // null when there is none, so a marker from a page with no visible block is
    // the same shape it always was and the pixel path is the whole story.
    var top = null;
    try {
      top = topBlockAnchor(win);
    } catch (error) {
      top = null;
    }
    if (top && typeof top.offset === "number" && Number.isFinite(top.offset)) {
      marker.blockText = top.text;
      marker.blockOffset = Math.round(top.offset);
    }
    try {
      storage.setItem(VIEWPORT_MARKER_KEY, JSON.stringify(marker));
    } catch (error) {
      return false;
    }

    if (!setScrollRestoration(win, "manual")) {
      removeViewportMarker(storage);
      setScrollRestoration(win, "auto");
      return false;
    }
    return true;
  }

  /**
   * Remember what the rail was showing, for the reload LAHE is about to start.
   *
   * A sibling of saveViewportForReload, deliberately not a change to it. Same
   * moment, same storage, its own key: this one can fail (or be absent, on a
   * page with no rail state worth keeping) without touching the scroll restore,
   * and the scroll restore's own rules about fragments and history mode are
   * none of this one's business.
   *
   * @param {Window} win
   * @param {string} review
   * @param {object} state from overlay's railState()
   */
  function saveRailForReload(win, review, state) {
    if (!win || !win.location || !review || !state) return false;
    var storage = null;
    try {
      storage = win.sessionStorage;
    } catch (error) {
      return false;
    }
    if (!storage || typeof storage.setItem !== "function") return false;

    var href = typeof win.location.href === "string" ? win.location.href : "";
    if (!href) return false;
    try {
      storage.setItem(
        RAIL_MARKER_KEY,
        JSON.stringify({
          version: RAIL_MARKER_VERSION,
          exactHref: href,
          review: review,
          collapsed: state.collapsed === true,
          tab: state.tab || null,
          scroll: typeof state.scroll === "number" && Number.isFinite(state.scroll) ? state.scroll : 0,
          focused: state.focused || null
        })
      );
    } catch (error) {
      return false;
    }
    return true;
  }

  /**
   * Consume the rail marker, once, on the next boot of the same page.
   *
   * Same match rules as the viewport marker for the same reason: a stale marker
   * from another page or another review must not rearrange the rail on a page
   * the reviewer navigated to themselves. Removed on read whatever the verdict,
   * so it can never apply twice.
   *
   * @returns {object|null} the state to hand to overlay's applyRailState
   */
  function restoreRailAfterReload(win, review) {
    if (!win || !win.location || !review) return null;
    var raw = null;
    try {
      var storage = win.sessionStorage;
      if (!storage || typeof storage.getItem !== "function") return null;
      raw = storage.getItem(RAIL_MARKER_KEY);
      if (raw !== null && typeof storage.removeItem === "function") storage.removeItem(RAIL_MARKER_KEY);
    } catch (error) {
      return null;
    }
    if (!raw) return null;

    var marker = null;
    try {
      marker = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    var href = typeof win.location.href === "string" ? win.location.href : "";
    if (!marker || marker.version !== RAIL_MARKER_VERSION) return null;
    if (marker.exactHref !== href || marker.review !== review) return null;
    if (navigationType(win) === "back_forward") return null;
    return {
      collapsed: marker.collapsed === true,
      tab: marker.tab || null,
      scroll: typeof marker.scroll === "number" ? marker.scroll : 0,
      focused: marker.focused || null
    };
  }

  /**
   * Consume LAHE's one-shot viewport marker on the next normal document boot.
   *
   * Exact URL and review matching prevents a stale same-tab marker from moving
   * an unrelated page. A back/forward navigation and a URL with a fragment are
   * explicitly left to the browser. A valid restore keeps native restoration
   * manual through pageshow, then returns it to auto.
   */
  function restoreViewportAfterReload(win, review) {
    if (!win || !win.location || !review) return false;

    var storage = null;
    var raw = null;
    try {
      storage = win.sessionStorage;
      if (!storage || typeof storage.getItem !== "function") return false;
      raw = storage.getItem(VIEWPORT_MARKER_KEY);
      if (raw !== null) removeViewportMarker(storage);
    } catch (error) {
      return false;
    }
    if (!raw) return false;

    var marker = null;
    try {
      marker = JSON.parse(raw);
    } catch (error) {
      setScrollRestoration(win, "auto");
      return false;
    }

    var hash = typeof win.location.hash === "string" ? win.location.hash : "";
    var href = typeof win.location.href === "string" ? win.location.href : "";
    var valid =
      marker &&
      marker.version === VIEWPORT_MARKER_VERSION &&
      marker.exactHref === href &&
      marker.review === review &&
      typeof marker.x === "number" &&
      Number.isFinite(marker.x) &&
      typeof marker.y === "number" &&
      Number.isFinite(marker.y);
    var backForward = navigationType(win) === "back_forward";

    if (hash || backForward || !valid) {
      setScrollRestoration(win, "auto");
      return false;
    }

    // Re-assert manual on the incoming document before the numeric restore so
    // native restoration cannot race it. The old document already requested
    // manual, but browsers differ in how that mode crosses a reload.
    if (!setScrollRestoration(win, "manual")) {
      setScrollRestoration(win, "auto");
      return false;
    }
    var holdManual = false;
    try {
      if (typeof win.scrollTo !== "function") return false;
      var landed = scrollToMarker(win, marker);
      lastRestore = { ok: true, byBlock: landed.byBlock, text: landed.text, offset: landed.offset };
      // A BLOCK RESTORE HAS TO KEEP MANUAL MODE, and this is the bug that
      // taught it. Handing native restoration back at pageshow lets the browser
      // put its own remembered PIXEL offset on the page a moment later, which is
      // the very number the block anchor exists to overrule. Worse, that scroll
      // arrives as a scroll event, which the correction loop reads as the
      // reviewer taking the page back, so it stands down and the page is left on
      // the browser's answer. Manual stays on for the settling window and
      // steadyAfterReload's stop() hands it back.
      holdManual = landed.byBlock;
      return true;
    } catch (error) {
      return false;
    } finally {
      if (holdManual) {
        // The safety net, in case nothing ever builds the controller: native
        // mode comes back on its own a little after the window would have
        // closed. Setting it twice is harmless.
        if (typeof win.setTimeout === "function") {
          win.setTimeout(function () {
            restoreNativeScrollingAfterPageShow(win);
          }, STEADY_SETTLE_MS + 500);
        }
      } else {
        restoreNativeScrollingAfterPageShow(win);
      }
    }
  }

  /**
   * Which failure a refused or failed request really is.
   *
   * Pure, and separate from the client, so the decision can be tested without a
   * browser: it is the difference between a chip that says "start the helper"
   * and one that says "register this origin", and getting it wrong sends a
   * reviewer after the wrong fix for the whole session.
   *
   * @param {{cspRefused?: boolean, status?: number, healthAnswered?: boolean}} facts
   *   `healthAnswered` is the second question the client asks after a
   *   network-level failure: the helper's health route is unauthenticated and
   *   unpreflighted, so an origin no review registered can still reach it. True
   *   means the helper is up and the origin is what is being refused.
   * @returns {string} a failure code from src/shared/failures.js
   */
  function decideFailureCode(facts) {
    var f = facts || {};
    if (f.cspRefused) return "CSP_REFUSED";
    if (f.status === 401) return "SYNC_UNAUTHORIZED";
    if (f.status === 403) return "SYNC_ORIGIN_NOT_ALLOWED";
    if (f.healthAnswered === true) return "SYNC_ORIGIN_NOT_ALLOWED";
    return "HELPER_UNREACHABLE";
  }

  function createSync(options) {
    var opts = options || {};
    var review = opts.review || null;
    var token = opts.token || "";
    var helperOrigin = opts.helperOrigin || protocol.DEFAULT_HELPER_ORIGIN;
    var store = opts.store || null;
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : null) : null);
    var onStatus = opts.onStatus || function () {};
    // The helper's answer to "is an agent listening?", raised on the poll that
    // brought it. It rides the SAME channel target_mtime does (replies.poll),
    // for the same reason: a number that only means anything while the helper is
    // up should come from the helper, on a request the page already makes.
    // Raised only on CHANGE, so a calm rail is not repainted every two seconds.
    var onAgentLiveness = opts.onAgentLiveness || function () {};
    var onFailure = opts.onFailure || function () {};
    // The mirror of onFailure: a standing failure whose condition ENDED. The
    // rail clears that chip (clear, not dismiss, so the next real failure still
    // gets one). Raised with a failure code, the same vocabulary onFailure uses.
    var onRecovered = opts.onRecovered || function () {};
    var onReplies = opts.onReplies || function () {};
    var onLimit = opts.onLimit || function () {};
    // R36's reload. isBusy answers "is the reviewer mid-work right now?" (boot
    // wires it to the edit session and the open comment boxes); onPageChanged is
    // the moment before the reload, where the rail says so in plain words.
    var isBusy = opts.isBusy || function () { return false; };
    var onPageChanged = opts.onPageChanged || function () {};
    // What the rail is showing, asked for at the last possible moment before
    // the document goes away. A caller with no rail simply does not pass it.
    var railState = typeof opts.railState === "function" ? opts.railState : null;
    var reloadDebounceMs = typeof opts.reloadDebounceMs === "number" ? opts.reloadDebounceMs : RELOAD_DEBOUNCE_MS;
    var reloadNoticeMs = typeof opts.reloadNoticeMs === "number" ? opts.reloadNoticeMs : RELOAD_NOTICE_MS;
    // The window-session state machine (D5, findings 1/2/3/12, NEW-2). onRefused
    // fires when this window loses the claim (client lock or helper); the boot
    // layer goes READ-ONLY and shows the refusal panel. onHeld fires only on the
    // TRANSITION out of read-only into holder (a takeover), so boot re-installs
    // the edit and comment handlers it tore down.
    var onRefused = opts.onRefused || function () {};
    var onHeld = opts.onHeld || function () {};

    var state = STATE.IDLE;
    var status = null;
    var started = false;
    var cspRefused = false;
    var lastFailure = null;
    // Whether the helper has answered THIS page. null until it has been heard
    // from either way, and it is learnable without a POST: a page with nothing
    // queued never posts, and before this it read "kept in this browser, it will
    // be stored when the helper is back" forever with a healthy helper.
    var helperReachable = null;
    var backoffIndex = 0;
    var debounceTimer = null;
    var retryTimer = null;
    var pollTimer = null;
    // The window session. readOnly gates every write (finding 1); sessionSecret
    // is what proves this window is the holder on a heartbeat (finding 3); the
    // two timers are the holder's heartbeat (finding 2) and the refused window's
    // liveness poll (NEW-2), both stopped in sync.stop (finding 13).
    var readOnly = false;
    var sessionSecret = null;
    // Consecutive heartbeats that were refused or never arrived. Reset by any
    // answer; read only by the heartbeat path (see CLAIM_MISSES_BEFORE_READ_ONLY).
    var claimMisses = 0;
    var claimRetryTimer = null;
    // When the helper last accepted an authenticated request from this page. 0
    // means it never has, which is a different situation from having lost it.
    var lastAnsweredAt = 0;
    var heartbeatTimer = null;
    var livenessTimer = null;
    var heartbeatMs = 10000;
    var flushing = false;
    // The post that is in flight right now, so a caller who has to know the
    // outbox is EMPTY (End review) can wait on it instead of being told `busy`
    // and posting anyway. Resolved promises are harmless to hold.
    var flushInFlight = null;
    var deliveredOnce = false;
    // True from pagehide/beforeunload until this document is shown again. A post
    // the browser cancels because the document is going away is NOT the helper
    // being unreachable: the record is already in browser storage and it
    // re-posts on the next load. Calling that abort a failure raised a permanent
    // "the local helper is not reachable" chip on every page after a
    // commit-then-click-a-link, with the helper up the whole time (walkers,
    // 2026-08-14).
    var unloading = false;
    var cursor = 0;
    // R36. The mtime this page last saw, the armed-but-not-yet-fired reload, and
    // its debounce timer.
    var targetMtime = null;
    // The last agent_liveness the helper sent, and a key over the fields the
    // rail draws from it. The key is kept separately so the change test is one
    // string comparison rather than a deep one on every poll.
    var agentLiveness = null;
    var agentLivenessKey = null;
    var reloadPending = false;
    var reloadTimer = null;
    var reloadsFired = 0;
    // Every time the debounce window closed and the reload was DECIDED, whether
    // it went ahead or was deferred for a busy reviewer. It is what a test waits
    // on to assert that a reload did not happen, instead of sleeping and hoping.
    var reloadChecks = 0;
    // The replies this page has been handed, newest last, for the browser
    // harness to assert on. It drives NO status: a reply having arrived at some
    // point is not evidence about now. Capped so a long review does not grow it
    // without end.
    var repliesSeen = [];
    var REPLIES_KEPT = 50;
    var seenItems = Object.create(null);
    var lock = { checked: false, acquired: null, holder: null, reason: null, unchecked: false };
    var counters = { posts: 0, postsFailed: 0, polls: 0, acknowledged: 0, timeouts: 0 };

    function requireReview() {
      if (!review) throw new Error("sync: a review id is required; browser storage and the wire are both keyed by it");
      return review;
    }

    // -------------------------------------------------------------------------
    // The status line (R12)
    // -------------------------------------------------------------------------
    //
    // Three states, and the transitions are what a test asserts. STORED means
    // the helper has acknowledged everything this browser holds: while anything
    // is still queued, the honest word is kept-locally, whatever the last
    // request happened to return.
    //
    // THIS LINE SAYS NOTHING ABOUT AGENTS, and that is a fix rather than an
    // omission. It used to promote itself to "Stored · agent reading" as soon as
    // one reply had ever arrived, off a `repliesSeen` list that only ever grew.
    // Nothing aged it out, so the first reply of a session pinned that sentence
    // to the rail for the rest of the session, and it sat directly above a
    // liveness line reading "No agent watching · oldest item 6m" (Ken, live,
    // 2026-08-23). The liveness line is ground truth from files the helper
    // writes; this one is a claim by a page that has no way to know. There is
    // one line about agents on this rail now, and this is not it.

    function setStatus(next) {
      if (next === status) return status;
      status = next;
      onStatus(status);
      return status;
    }

    function recomputeStatus() {
      var pending = store ? store.pendingEvents(requireReview()).length : 0;
      // Anything the helper refused, could not take, or never answered means
      // the reviewer's typing is living in this browser and nowhere else.
      if (lastFailure || cspRefused) return setStatus(overlay.STATUS.KEPT_LOCALLY);
      if (pending === 0 && (deliveredOnce || helperReachable === true)) {
        // Nothing is queued and the helper is there. Everything durable IS
        // stored, whether this page ever had anything of its own to post.
        return setStatus(overlay.STATUS.STORED);
      }
      // Queued and in flight with nothing wrong: HOLD the current reading
      // rather than flickering between every keystroke and its acknowledgement.
      // Before there is any reading to hold, the true one is that the work is in
      // this browser and the helper has not confirmed it YET. It does not claim
      // an outage: nothing has failed, so saying the helper is away would be an
      // invention (walkers, 2026-08-14).
      if (status === null) return setStatus(overlay.STATUS.KEPT_UNCONFIRMED);
      return status;
    }

    function raise(failure) {
      lastFailure = failure;
      var code = failures.canonical(failure.code);
      if (code === "HELPER_UNREACHABLE") helperReachable = false;
      if (code === "SYNC_ORIGIN_NOT_ALLOWED" || code === "SYNC_UNAUTHORIZED") {
        // The helper ANSWERED and refused us, so it is not unreachable. Clear
        // that chip here rather than at one call site, or the page wears both
        // and the wrong one last (review, 2026-08-17).
        onRecovered("HELPER_UNREACHABLE");
        // These two are standing conditions, not occurrences. Re-raising the
        // one already standing would grow a ×N counter that counts our own
        // retries, so a repeat is dropped and the chip stays as it is.
        if (accessRefused === code) return failure;
        accessRefused = code;
      }
      onFailure(failure);
      return failure;
    }

    /**
     * The helper answered something. Any acknowledged exchange counts: a reply
     * poll, a granted claim, a heartbeat. It feeds the status line and it ENDS
     * the standing unreachable chip, which is a condition rather than an
     * occurrence and so has to be cleared by the thing that ended it.
     */
    function markReachable() {
      var was = helperReachable;
      helperReachable = true;
      lastFailure = null;
      lastAnsweredAt = nowMs();
      if (was !== true) onRecovered("HELPER_UNREACHABLE");
      // Every call site of markReachable is an AUTHENTICATED exchange the
      // helper accepted (an append, a reply poll, a claim); the health probe
      // never calls it. So an unregistered origin and a refused token are both
      // over the moment this runs, and their standing chips end here too.
      // Without this, registering the origin fixed the review while the chip
      // kept saying it was broken (Ken, live, 2026-08-17).
      //
      // Only on the STATE CHANGE, though. A healthy page polls every second,
      // and clearing a chip that was never raised still wrote browser storage
      // and rebuilt the whole chip list, which destroyed and recreated any
      // other standing chip's buttons once a second: the "Copy for your agent"
      // button lost its "Copied" confirmation, and a click that straddled a
      // rebuild landed on a detached node (review, 2026-08-17).
      if (accessRefused) {
        accessRefused = null;
        onRecovered("SYNC_ORIGIN_NOT_ALLOWED");
        onRecovered("SYNC_UNAUTHORIZED");
      }
      originDiagnosed = false;
      recomputeStatus();
      return helperReachable;
    }

    // -------------------------------------------------------------------------
    // Minting events
    // -------------------------------------------------------------------------

    function eventTypeFor(item) {
      if (item[record.FIELD.STATE] === record.STATE.READY) return protocol.EVENT.ITEM_READY;
      if (!seenItems[item[record.FIELD.ID]]) return protocol.EVENT.ITEM_CREATED;
      return protocol.EVENT.ITEM_CONTENT;
    }

    function eventFor(item) {
      var type = eventTypeFor(item);
      seenItems[item[record.FIELD.ID]] = true;
      return protocol.newEvent({
        event: type,
        event_id: record.randomId("evt"),
        review: requireReview(),
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_title: item[record.FIELD.PAGE_TITLE],
        page_seq: item[record.FIELD.PAGE_SEQ],
        source_hint: item[record.FIELD.SOURCE_HINT],
        payload: {
          // Drafts flow to the helper marked draft, and never appear as
          // actionable in what the agent reads (D5, R7).
          draft: record.isDraft(item),
          record: item
        }
      });
    }

    /**
     * The reviewer deleted their own item, so the helper's projection has to
     * drop it too. Otherwise a comment deleted in the browser stays in
     * review.json and the agent works on something nobody is asking for.
     *
     * ONLY FOR AN ITEM THE HELPER HAS SEEN. A draft deleted before its first
     * flush was never posted, and a delete naming an item the projection has
     * never heard of is a line in the log that means nothing.
     *
     * @param {Object} item the record as it stood before the delete
     */
    function deleteItem(item) {
      if (readOnly || !item) return null;
      var id = item[record.FIELD.ID];
      if (!id || !seenItems[id]) return null;
      delete seenItems[id];
      var event = protocol.newEvent({
        event: protocol.EVENT.ITEM_DELETED,
        event_id: record.randomId("evt"),
        review: requireReview(),
        item: id,
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_title: item[record.FIELD.PAGE_TITLE],
        page_seq: item[record.FIELD.PAGE_SEQ],
        source_hint: item[record.FIELD.SOURCE_HINT],
        payload: { record: item }
      });
      store.queueEvent(requireReview(), event);
      scheduleFlush(0);
      recomputeStatus();
      return event;
    }

    /**
     * The typing path. SYNCHRONOUS and non-blocking: the event is queued in
     * browser storage in this task, and the network happens later or never.
     *
     * @param {Object} item the record as stored
     * @param {{immediate?: string}} [options] one of protocol.FLUSH.IMMEDIATE_ON
     */
    function recordItem(item, options) {
      // A refused window is READ-ONLY (finding 1): it writes nothing to the
      // shared bucket, so it cannot clobber the holder's work last-keystroke-
      // wins. Boot also tears down the edit/comment handlers, so in practice
      // nothing calls this; the guard is the belt to that suspenders.
      if (readOnly) return null;
      var opts2 = options || {};
      var event = eventFor(item);
      store.queueEvent(requireReview(), event);
      if (opts2.immediate) {
        if (protocol.FLUSH.IMMEDIATE_ON.indexOf(opts2.immediate) === -1) {
          throw new Error(
            "sync.recordItem: immediate must be one of " + protocol.FLUSH.IMMEDIATE_ON.join(", ") + ", got " + opts2.immediate
          );
        }
        scheduleFlush(0);
      } else {
        scheduleFlush(protocol.FLUSH.HELPER_DEBOUNCE_MS);
      }
      recomputeStatus();
      return event;
    }

    // -------------------------------------------------------------------------
    // Posting
    // -------------------------------------------------------------------------

    function url(routeName, query) {
      var base = helperOrigin + protocol.route(routeName).path;
      if (!query) return base;
      var parts = Object.keys(query).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
      });
      return base + "?" + parts.join("&");
    }

    function headersFor(routeName) {
      var out = {};
      out[protocol.HEADER.CLIENT] = protocol.CLIENT_LAYER;
      out[protocol.HEADER.TOKEN] = token;
      if (protocol.route(routeName).mutating) out[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
      return out;
    }

    // One request, with a deadline. Resolves to {ok, status, body} or
    // {ok:false, error}. It never throws: a transport problem is a state the
    // rail reports, not an exception the typing path has to catch.
    function request(routeName, init) {
      if (!fetchImpl) return Promise.resolve({ ok: false, error: new Error("no fetch in this environment") });
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timedOut = false;
      var timer = null;
      if (controller) {
        // harness-allow-timer: the request deadline. A suspended helper accepts
        // the socket and answers nothing, so without this the reviewer's page
        // waits forever on a helper that is never coming back this second.
        timer = setTimeout(function () {
          timedOut = true;
          counters.timeouts += 1;
          controller.abort();
        }, REQUEST_TIMEOUT_MS);
      }
      var config = Object.assign({}, init, { headers: headersFor(routeName) });
      if (controller) config.signal = controller.signal;

      return fetchImpl(url(routeName, init && init.query), config)
        .then(function (response) {
          if (timer) clearTimeout(timer);
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              return { ok: response.ok, status: response.status, body: body };
            });
        })
        .catch(function (error) {
          if (timer) clearTimeout(timer);
          return { ok: false, error: error, timedOut: timedOut };
        });
    }

    /**
     * Drain the outbox. Never throws, never blocks a caller who does not await
     * it, and idempotent: the helper acknowledges by event_id, so a re-post
     * after a timeout cannot double-count.
     */
    function flush(flushOptions) {
      var fo = flushOptions || {};
      if (flushing) return Promise.resolve({ sent: 0, remaining: pendingCount(), busy: true });
      if (cspRefused) return Promise.resolve({ sent: 0, remaining: pendingCount(), refused: true });

      var events = store.pendingEvents(requireReview());
      if (!events.length) {
        recomputeStatus();
        return Promise.resolve({ sent: 0, remaining: 0 });
      }

      var body = JSON.stringify({ review: requireReview(), events: events });

      // The unload path. Keepalive carries the headers D11 requires, which
      // sendBeacon cannot; oversize is a delay, never a loss, because the
      // events are already in browser storage.
      if (fo.unload && !protocol.fitsKeepalive(body)) {
        return Promise.resolve({ sent: 0, remaining: events.length, oversize: true });
      }

      flushing = true;
      state = STATE.IN_FLIGHT;
      counters.posts += 1;

      var init = { method: "POST", body: body };
      if (fo.unload) init.keepalive = true;

      var posted = request("events.append", init).then(function (result) {
        flushing = false;
        if (result.ok) {
          var accepted = (result.body && result.body.accepted) || [];
          store.acknowledge(requireReview(), accepted);
          // Finding 10: beside dropping the accepted events from the outbox,
          // stamp the item acknowledged when the helper named the event carrying
          // its current rev, so merge.js can let the store win at equal rev. The
          // event carries its item id and rev; markAcknowledged guards the rev.
          if (typeof store.markAcknowledged === "function" && accepted.length) {
            var acceptedIds = Object.create(null);
            accepted.forEach(function (id) {
              acceptedIds[id] = true;
            });
            events.forEach(function (ev) {
              if (!acceptedIds[ev.event_id]) return;
              var itemId = ev[protocol.EVENT_FIELD.ITEM];
              var rev = ev[protocol.EVENT_FIELD.REV];
              if (itemId && typeof rev === "number") {
                store.markAcknowledged(requireReview(), itemId, rev);
              }
            });
          }
          deliveredOnce = true;
          counters.acknowledged += accepted.length;
          markReachable();
          backoffIndex = 0;
          state = STATE.IDLE;
          if (typeof (result.body && result.body.seq) === "number" && cursor === 0) {
            cursor = result.body.seq;
          }
          recomputeStatus();
          var remaining = pendingCount();
          if (remaining > 0 && !fo.unload) scheduleFlush(0);
          return { sent: accepted.length, remaining: remaining };
        }

        // The document went away mid-request. Nothing failed and nothing is
        // lost, so nothing is said: the events are in browser storage and the
        // next load posts them.
        if (abortedByTeardown(result)) {
          state = STATE.IDLE;
          recomputeStatus();
          return { sent: 0, remaining: pendingCount(), aborted: true };
        }

        counters.postsFailed += 1;
        state = STATE.RETRYING;
        raise(classify(result.error, { status: result.status, detail: describe(result) }));
        // A failure with no status at all is a network-level one, which is what
        // a refused preflight looks like. Ask the second question.
        if (result.status === undefined) diagnoseUnreachable();
        recomputeStatus();
        if (!fo.unload) scheduleRetry();
        return { sent: 0, remaining: pendingCount(), failed: true };
      });
      flushInFlight = posted;
      return posted;
    }

    /**
     * Drain the outbox to EMPTY, and only then answer.
     *
     * `flush` is the typing path's version: it returns `busy` rather than
     * queueing behind a post that is already going out, because nobody typing
     * needs to wait. End review does need to wait. The reviewer's last
     * keystrokes are still sitting behind the 750ms debounce when they reach
     * for the door, and archiving the review out from under them loses the last
     * thing they wrote (protocol.FLUSH names blur and navigation as immediate
     * for the same reason).
     *
     * A post that fails stops the loop: the helper is not answering, so the end
     * post is about to fail too and the caller reports that instead of spinning.
     */
    function drainOutbox(attempts) {
      var left = typeof attempts === "number" ? attempts : DRAIN_ATTEMPTS;
      // The debounce is about to be redundant, and a timer that fires mid-drain
      // is one more post racing the archive.
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      var settled = flushing && flushInFlight ? flushInFlight : Promise.resolve(null);
      return settled
        .then(function () {
          return flush();
        })
        .then(function (result) {
          var r = result || {};
          if (!r.remaining || r.failed || r.refused || r.aborted) return r;
          if (left <= 1) return r;
          return drainOutbox(left - 1);
        });
    }

    /**
     * True when this request died because the page is being torn down, rather
     * than because anything is wrong with the helper. Two shapes:
     *
     *   - the document is unloading (pagehide/beforeunload has fired), so every
     *     in-flight request is cancelled by the browser
     *   - an AbortError this client did not ask for: our own deadline sets
     *     timedOut, and a timeout IS a real failure, so it is excluded here
     *
     * Either way the queue is untouched and the next load re-posts it.
     */
    function abortedByTeardown(result) {
      if (result.timedOut) return false;
      if (unloading) return true;
      var error = result.error;
      return !!error && error.name === "AbortError";
    }

    function describe(result) {
      if (result.timedOut) return "the helper accepted the connection and did not answer within " + REQUEST_TIMEOUT_MS + "ms";
      if (result.error) return result.error.message || String(result.error);
      if (result.body && result.body.error) return result.body.error.message || result.body.error.code;
      return result.status ? "HTTP " + result.status : null;
    }

    function pendingCount() {
      return store ? store.pendingEvents(requireReview()).length : 0;
    }

    function scheduleFlush(delayMs) {
      if (debounceTimer) clearTimeout(debounceTimer);
      // harness-allow-timer: protocol.FLUSH's 750ms typing-idle debounce. This
      // is the ONLY debounce in the design and it is on the post to the helper,
      // never on the write to browser storage.
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        flush();
      }, delayMs);
    }

    function scheduleRetry() {
      if (retryTimer) return;
      var wait = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
      backoffIndex += 1;
      // harness-allow-timer: the capped retry backoff. It never gives up, which
      // is the promise that a stopped helper costs the reviewer nothing.
      retryTimer = setTimeout(function () {
        retryTimer = null;
        flush();
      }, wait);
    }

    // -------------------------------------------------------------------------
    // The reply poll loop (3A reads this; it never edits this file)
    // -------------------------------------------------------------------------
    //
    // The cursor is a seq from the log (protocol.REPLY_CURSOR_FIELD), never a
    // timestamp: two events in one millisecond are ordinary and a clock that
    // steps backwards silently skips work.

    function poll() {
      counters.polls += 1;
      var query = { review: requireReview(), since: cursor };
      var pagePath =
        win && win.location && typeof win.location.pathname === "string"
          ? win.location.pathname
          : doc && doc.location && typeof doc.location.pathname === "string"
            ? doc.location.pathname
            : null;
      if (pagePath) query.page_path = pagePath;
      return request("replies.poll", { method: "GET", query: query }).then(
        function (result) {
          if (!result.ok) {
            // A poll the navigation cancelled says nothing about the helper.
            if (abortedByTeardown(result)) return { events: [] };
            raise(classify(result.error, { status: result.status, detail: describe(result) }));
            if (result.status === undefined) {
              // Returned rather than fired and forgotten, so one awaited poll
              // is one settled diagnosis and a test can assert the chips.
              return diagnoseUnreachable().then(function () {
                recomputeStatus();
                return { events: [] };
              });
            }
            recomputeStatus();
            return { events: [] };
          }
          // The helper answered. That is proof it is there, and it is the ONLY
          // proof a page with an empty outbox can have: it never posts.
          markReachable();
          var events = (result.body && result.body.events) || [];
          if (typeof (result.body && result.body.seq) === "number") cursor = result.body.seq;
          noteTargetMtime(result.body && result.body.target_mtime);
          noteAgentLiveness(result.body && result.body.agent_liveness);
          if (events.length) {
            repliesSeen = repliesSeen.concat(events).slice(-REPLIES_KEPT);
            onReplies(events);
          }
          recomputeStatus();
          return { events: events, seq: cursor };
        }
      );
    }

    /**
     * The reviewed file's mtime, as this poll reported it (R36).
     *
     * The FIRST value seen is just the baseline: this page is already showing
     * that version of the file, so it arms nothing. Any later value that differs
     * means the agent rebuilt the page underneath the reviewer.
     *
     * A null answers nothing at all: the review has no recorded path, or the
     * file is momentarily absent because a build is writing it. Treating a null
     * as a change would reload the page every time a build was mid-write.
     *
     * @param {string|null} value an ISO string, or null
     * @returns {boolean} true when this call armed a reload
     */
    /**
     * The helper's report on whether an agent is listening.
     *
     * Raised when the payload MATERIALLY CHANGES, not only when the state string
     * does. Raising on the state alone froze the one line that carries a number:
     * "No agent watching, oldest item 1m" stayed at 1m for as long as nothing
     * else changed, because the state was still unattended and the rail was
     * never told again. Every field the line is drawn from is in the key.
     *
     * It is still not "every poll": an unchanged payload raises nothing, so a
     * quiet rail is not repainted once a second. The rail runs its own slow tick
     * for the age between deliveries.
     *
     * @param {object|null} value the agent_liveness object, or null
     * @returns {boolean} true when something changed and the callback fired
     */
    function noteAgentLiveness(value) {
      if (!value || typeof value !== "object") return false;
      agentLiveness = value;
      var next = livenessKey(value);
      if (next === agentLivenessKey) return false;
      agentLivenessKey = next;
      onAgentLiveness(value);
      return true;
    }

    // Every field the rail's agent line is drawn from, in one string. A deep
    // compare would be the same answer for more code; the object is five scalars
    // wide and that is the whole of it.
    function livenessKey(value) {
      var f = protocol.AGENT_LIVENESS.FIELD;
      return [
        value[f.STATE],
        value[f.MONITOR_AT],
        value[f.ACTIVITY_AT],
        value[f.UNANSWERED],
        value[f.OLDEST_UNANSWERED_AT]
      ].join("|");
    }

    function noteTargetMtime(value) {
      if (typeof value !== "string" || !value) return false;
      if (targetMtime === null) {
        targetMtime = value;
        return false;
      }
      if (value === targetMtime) {
        // Nothing changed. If a reload is still waiting on the reviewer to stop
        // typing, this is the tick that gets to ask again.
        if (reloadPending && !reloadTimer) armReload(0);
        return false;
      }
      targetMtime = value;
      reloadPending = true;
      // Restart the window rather than reload now: a rebuild that touches the
      // file three times in a second is one change to the reviewer.
      armReload(reloadDebounceMs);
      return true;
    }

    function armReload(delayMs) {
      if (reloadTimer) clearTimeout(reloadTimer);
      // harness-allow-timer: R36's rebuild debounce, pinned at RELOAD_DEBOUNCE_MS
      // above. One rebuild is one reload.
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        fireReload();
      }, delayMs);
    }

    /**
     * Reload, unless the reviewer is mid-work. A deferral is not a cancellation:
     * reloadPending stays true and the next poll that finds them idle arms it
     * again, so the page catches up the moment they finish.
     */
    function fireReload() {
      if (!reloadPending) return false;
      reloadChecks += 1;
      var busy = false;
      try {
        busy = !!isBusy();
      } catch (error) {
        // A busy check that throws must not cost the reviewer their page. Treat
        // it as busy: a late reload is recoverable, one over a live edit is not.
        busy = true;
      }
      if (busy) return false;
      reloadPending = false;
      reloadsFired += 1;
      onPageChanged();
      // harness-allow-timer: the pause that lets "Page updated. Reloading..."
      // paint before the document goes away.
      setTimeout(function () {
        if (win && win.location && typeof win.location.reload === "function") {
          saveViewportForReload(win, review);
          // What the page says right now, so the page that replaces it can show
          // the reviewer what the agent changed.
          saveBlockSnapshot(win, review, RELOAD_REASON.REBUILT);
          // And what the TOOL was showing, so a card the reviewer was reading
          // is still in front of them afterwards.
          if (typeof railState === "function") {
            try {
              saveRailForReload(win, review, railState());
            } catch (error) {
              // A rail that cannot describe itself must not cost the reload.
            }
          }
          win.location.reload();
        }
      }, reloadNoticeMs);
      return true;
    }

    function startPolling() {
      if (pollTimer) return pollTimer;
      // harness-allow-timer: adaptive reply polling, with both intervals pinned
      // above. A timeout reschedules itself so visibility changes can alter the
      // next cadence without maintaining two timers.
      pollTimer = setTimeout(function () {
        pollTimer = null;
        poll();
        if (pendingCount() > 0 && !retryTimer && !flushing) flush();
        if (started) startPolling();
      }, pollIntervalFor(doc));
      return pollTimer;
    }

    function onVisibilityChange() {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      if (doc && doc.hidden !== true) {
        poll();
        if (pendingCount() > 0 && !retryTimer && !flushing) flush();
      }
      if (started) startPolling();
    }

    // -------------------------------------------------------------------------
    // Telling a CSP refusal from a helper that is down
    // -------------------------------------------------------------------------

    function classify(error, hints) {
      var h = hints || {};
      // A diagnosis already made still holds. classify has no memory of the
      // health probe, so without this every later failing poll re-raised
      // HELPER_UNREACHABLE on a page whose real problem was its origin, and the
      // reviewer wore both chips with the wrong one last (review, 2026-08-17).
      var answered = h.healthAnswered;
      if (answered === undefined && originDiagnosed) answered = true;
      var code = decideFailureCode({ cspRefused: cspRefused, status: h.status, healthAnswered: answered });
      if (code === "SYNC_ORIGIN_NOT_ALLOWED") return failures.failure(code, originRemedy());
      return failures.failure(code, h.detail || (error && error.message) || null);
    }

    // -------------------------------------------------------------------------
    // Telling an unregistered origin from a helper that is down
    // -------------------------------------------------------------------------
    //
    // THE ORIGIN TRAP. A page added as a static file registers the origin "null"
    // and nothing else. Serve that same page over http and the browser sends the
    // server's origin, which no review registered, so the helper refuses every
    // request. The reviewer's page then said "the local helper is not reachable",
    // which blames the one thing that is working, and the fix it suggests
    // (start the helper) does nothing.
    //
    // The refusal is invisible to fetch: every route carries the custom header
    // D11 requires, so the browser preflights, and a refused preflight surfaces
    // as a plain network error rather than a 403 with a code in it. So the page
    // ASKS A SECOND QUESTION when a request fails at the network level: health
    // is unauthenticated, needs no custom header, and therefore no preflight. If
    // health answers, the helper is up and the origin is the problem.
    var originDiagnosed = false;
    // The access refusal currently STANDING, as a canonical code, or null.
    // It is what tells a re-raise from a first raise and a real recovery from a
    // healthy page's every-second poll.
    var accessRefused = null;

    function pageOrigin() {
      if (win && win.location && win.location.origin) return String(win.location.origin);
      if (doc && doc.location && doc.location.origin) return String(doc.location.origin);
      return "this page's origin";
    }

    function originRemedy() {
      // A sentence the reviewer can hand to any agent verbatim, so it carries
      // everything the agent needs: the page URL, the origin to register, and
      // the review id. The chip renders it with a "Copy for your agent" button.
      var href =
        win && win.location && win.location.href
          ? String(win.location.href)
          : doc && doc.location && doc.location.href
            ? String(doc.location.href)
            : "this page";
      return (
        "My lahe review page " +
        href +
        " says its address is not registered. Register the origin " +
        pageOrigin() +
        " for review " +
        (review || "(unknown)") +
        ", then tell me to reload."
      );
    }

    /**
     * Is the helper actually up, asked in the one way an unregistered origin can
     * still ask? Answers null when the question could not be put at all.
     */
    function probeHealth() {
      if (!fetchImpl) return Promise.resolve(null);
      // No custom headers, deliberately: a simple request is not preflighted, so
      // it reaches the handler even from an origin no review registered.
      return fetchImpl(helperOrigin + protocol.route("health").path, { method: "GET" })
        .then(function (response) {
          return !!(response && response.ok);
        })
        .catch(function () {
          return false;
        });
    }

    /**
     * After a network-level failure, work out whether this is really the helper
     * being down or this page's origin being unregistered, and say so once.
     *
     * The probe RE-RUNS on every failing poll rather than stopping at the first
     * diagnosis. A diagnosis is a claim about right now, and a helper that dies
     * an hour after the origin was refused has to surface as unreachable rather
     * than leave the page insisting on an origin problem forever. Re-running
     * costs one unauthenticated local request per failing poll, and a page whose
     * polls are all succeeding never gets here at all.
     */
    function diagnoseUnreachable() {
      if (cspRefused) return Promise.resolve(null);
      // A HELPER BEING REPLACED ANSWERS HEALTH AND REFUSES EVERYTHING ELSE, for
      // a moment, which is indistinguishable from an unregistered origin unless
      // you know the page was working a second ago. So a page that HAS been
      // answered recently keeps the "helper is down" reading, which during a
      // restart is the true one, until the grace runs out. A page that has never
      // been answered has no such history and is diagnosed at once, which is the
      // page whose origin genuinely was never registered.
      if (lastAnsweredAt && nowMs() - lastAnsweredAt < RESTART_GRACE_MS) {
        return Promise.resolve(null);
      }
      return probeHealth().then(function (healthAnswered) {
        if (healthAnswered !== true) {
          if (!originDiagnosed) return null;
          // Health stopped answering. The origin diagnosis is over, and this is
          // now a helper that is genuinely down.
          originDiagnosed = false;
          accessRefused = null;
          onRecovered("SYNC_ORIGIN_NOT_ALLOWED");
          return raise(failures.failure("HELPER_UNREACHABLE", "health stopped answering after an origin refusal"));
        }
        originDiagnosed = true;
        // The helper answers, so it is not unreachable. raise clears that chip
        // before this one lands, and it drops the repeat while it stands.
        return raise(failures.failure("SYNC_ORIGIN_NOT_ALLOWED", originRemedy()));
      });
    }

    function onPolicyViolation(event) {
      var directive = String(event.effectiveDirective || event.violatedDirective || "");
      if (directive.indexOf("connect-src") !== 0) return;
      var blocked = String(event.blockedURI || "");
      if (blocked && helperOrigin && blocked.indexOf(helperOrigin) !== 0) return;
      cspRefused = true;
      state = STATE.REFUSED;
      raise(failures.failure("CSP_REFUSED", "connect-src blocked " + (blocked || helperOrigin)));
      recomputeStatus();
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    // The secret this window kept from a previous page of the same review, if
    // any. Presenting it on the first claim is what turns a same-tab navigation
    // into a recognized heartbeat instead of a refused second window (D5).
    function loadPersistedSecret() {
      if (store && typeof store.sessionSecretFor === "function") {
        sessionSecret = store.sessionSecretFor(requireReview()) || null;
      }
      return sessionSecret;
    }

    // The claims are SEQUENCED. Two claims can be in flight at once (a
    // double-clicked "Review here", a takeover racing the heartbeat), and the
    // answers can come back in either order. Storing the older answer's secret
    // means the next heartbeat presents a secret the helper has already
    // replaced, and the reviewer's own window is refused as a second window.
    // A secret from a claim older than the one already applied is dropped.
    var claimSeq = 0;
    var appliedClaimSeq = 0;

    function rememberSecret(secret, seq) {
      if (typeof seq === "number") {
        if (seq < appliedClaimSeq) return sessionSecret;
        appliedClaimSeq = seq;
      }
      sessionSecret = secret || null;
      if (store && typeof store.rememberSessionSecret === "function") {
        store.rememberSessionSecret(requireReview(), sessionSecret);
      }
      return sessionSecret;
    }

    function start() {
      if (started) return Promise.resolve(lock);
      started = true;
      requireReview();
      loadPersistedSecret();

      if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("securitypolicyviolation", onPolicyViolation);
        doc.addEventListener("visibilitychange", onVisibilityChange);
      }
      if (win && typeof win.addEventListener === "function") {
        // Navigation and unload both commit immediately, with keepalive. R1
        // names navigation, so a link click cannot be a losing move.
        win.addEventListener("pagehide", commitOnUnload);
        win.addEventListener("beforeunload", commitOnUnload);
        win.addEventListener("pageshow", onPageShow);
      }

      startPolling();
      // Anything a previous session left unacknowledged goes out now. This is
      // the whole of "re-posts on the next load".
      flush();

      return store
        .claimWindow(requireReview())
        .then(function (got) {
          lock = {
            checked: true,
            acquired: got.acquired,
            holder: got.holder,
            reason: got.reason,
            refusedBy: got.acquired ? null : "lock",
            unchecked: got.unchecked === true
          };
          if (!got.acquired) {
            raise(got.failure);
            return lock;
          }
          // The client lock is held, so any second-window chip left in storage
          // from an earlier session is stale. Cleared here as well as in
          // parseClaim, because this half works with the helper down and it is
          // the only half a helperless page ever runs.
          onRecovered("SECOND_WINDOW_REFUSED");
          // The two shapes fail differently (D5): the lock above catches two
          // tabs sharing one storage bucket, and only the helper can see two
          // windows that cannot see each other's storage.
          return claimWithHelper();
        })
        .then(function (result) {
          // The uncovered case is said out loud only while it is ACTUAL: with
          // no helper granting claims, separate-storage windows are invisible
          // and the note earns its line. A helper that answered covers that
          // case, and a standing disclaimer under a working session is noise
          // the reviewer learns to ignore (Ken, 2026-08-18). The heartbeat
          // path keeps this current: it re-runs the claim, so the note comes
          // and goes with the helper.
          onLimit(lock.helperGranted ? null : overlay.LIMIT_SEPARATE_STORAGE_NO_HELPER);
          finalizeClaim();
          return result;
        });
    }

    // The window.claim request, in one place, so the initial claim, the
    // heartbeat, the liveness poll and the manual takeover all speak the same
    // wire. `body` decides which: a heartbeat carries the session_secret, a
    // takeover carries takeover:true, a first claim or liveness poll carries
    // neither.
    function claimRequest(body) {
      claimSeq += 1;
      var seq = claimSeq;
      return request("window.claim", { method: "POST", body: JSON.stringify(body) })
        .then(parseClaim)
        .then(function (parsed) {
          // Which claim this answer belongs to, so a late answer cannot overwrite
          // a newer one's secret (see rememberSecret).
          parsed.seq = seq;
          return parsed;
        });
    }

    function parseClaim(result) {
      if (result.ok) {
        // A granted claim or heartbeat is an acknowledged exchange, so it is
        // proof of reachability just like a reply poll is.
        markReachable();
        // AND this window holds the review, so a second-window refusal is over.
        // A chip is restored from browser storage on every load and was trusted
        // as it stood, so a refusal from an earlier session (or from the moment
        // a reload raced its own outgoing page) stayed on the rail while the
        // reviewer was typing happily into the review it claimed was locked
        // (Ken, live, 2026-08-18). Every successful claim re-validates it. The
        // clear is a no-op when no such chip stands, so the heartbeat every ten
        // seconds costs nothing.
        onRecovered("SECOND_WINDOW_REFUSED");
        var b = result.body || {};
        return {
          granted: true,
          refused: false,
          tookOver: b.took_over === true,
          sessionSecret: b.session_secret || null,
          heartbeatSeconds: typeof b.heartbeat_seconds === "number" ? b.heartbeat_seconds : null,
          body: b
        };
      }
      var body = result.body || {};
      var code = body.error && body.error.code;
      // A refusal has a body that SAYS refused. A helper that is simply down is a
      // rejected fetch with no body, and that is NOT a refusal: locking a window
      // out on a check that never ran is the work-losing outcome D5 forbids.
      var refused = body.granted === false || code === "PROTO_SECOND_WINDOW";
      // A REFUSED CLAIM IS STILL AN ANSWER, and it disproves two other chips.
      //
      // The helper replied with a body, so it is up; and this reply came back
      // through CORS carrying a token the origin check and the auth check both
      // let past, so neither the origin nor the token is the problem. Only the
      // ok branch above cleared those, and a refused window has no ok branch:
      // it stops its heartbeat and polls with claims that are answered and
      // refused, over and over, so nothing ever ran markReachable again.
      //
      // What that looked like: the reviewer sat in front of a chip telling them
      // to register an origin that was registered, while their agent worked
      // normally (the agent reaches the helper through the CLI, where there is
      // no origin check at all), and the sentence the chip offered them to hand
      // to that agent was a fix for a problem they did not have. The window
      // refusal underneath it was the real one, and it was saying so two chips
      // away (Ken, live, 2026-08-25).
      //
      // Deliberately only on THIS refusal. A claim refused for the token or the
      // origin is those chips being right, and clearing them would be the same
      // mistake pointed the other way.
      if (refused) {
        if (helperReachable !== true) {
          helperReachable = true;
          onRecovered("HELPER_UNREACHABLE");
        }
        if (accessRefused) {
          accessRefused = null;
          onRecovered("SYNC_ORIGIN_NOT_ALLOWED");
          onRecovered("SYNC_UNAUTHORIZED");
        }
        originDiagnosed = false;
      }
      return {
        granted: false,
        refused: refused,
        // The one refusal the page acts on immediately: a person in another
        // window pressed Review here instead. Everything else is waited out.
        deposed: body.deposed === true,
        body: body,
        error: result.error
      };
    }

    // The refusal, with no holder id to read anymore (finding 3): the server
    // stopped disclosing it, so the reason is the server's own sentence.
    function reasonFromBody(body) {
      body = body || {};
      return (
        "The helper says " +
        (body.reason || (body.error && body.error.detail) || "this review is already open in another window.")
      );
    }

    function claimWithHelper() {
      // The first claim carries any secret this window kept from an earlier page
      // of this review (a same-tab navigation), so the helper recognizes it as
      // the holder's heartbeat rather than refusing it as a second window.
      return claimRequest({
        review: requireReview(),
        window_id: store.windowId,
        session_secret: sessionSecret || undefined,
        takeover: false
      }).then(function (parsed) {
        if (parsed.granted) {
          lock.helperGranted = true;
          rememberSecret(parsed.sessionSecret, parsed.seq);
          if (parsed.heartbeatSeconds) heartbeatMs = parsed.heartbeatSeconds * 1000;
          return lock;
        }
        if (parsed.refused) {
          lock.acquired = false;
          lock.refusedBy = "helper";
          lock.reason = reasonFromBody(parsed.body);
          raise(failures.failure("SECOND_WINDOW_REFUSED", lock.reason));
          return lock;
        }
        // The helper being unreachable is not a refusal. Held optimistically; the
        // heartbeat will claim properly once the helper answers.
        lock.helperGranted = false;
        return lock;
      });
    }

    // -------------------------------------------------------------------------
    // The window-session state machine (D5)
    // -------------------------------------------------------------------------

    function finalizeClaim() {
      if (!lock.acquired) {
        // Refused, by the client lock or the helper. READ-ONLY, and a light
        // liveness poll so the holder going quiet is still noticed here.
        enterReadOnly();
      } else {
        // Held. Start the heartbeat so the helper keeps seeing this window; a
        // holder that never re-posts loses its own review after STALE_AFTER_MS.
        startHeartbeat();
      }
    }

    function enterReadOnly() {
      if (readOnly) return;
      readOnly = true;
      stopHeartbeat();
      onRefused({ reason: lock.reason, refusedBy: lock.refusedBy });
      startLiveness();
    }

    // The read-only window becomes the holder: on auto-takeover (holder went
    // stale, granted by the liveness poll) or on the reviewer's Review-here.
    function becomeHolder(parsed) {
      readOnly = false;
      claimMisses = 0;
      rememberSecret(parsed.sessionSecret, parsed.seq);
      if (parsed.heartbeatSeconds) heartbeatMs = parsed.heartbeatSeconds * 1000;
      lock.acquired = true;
      lock.helperGranted = true;
      lock.refusedBy = null;
      lock.reason = null;
      lastFailure = null;
      stopLiveness();
      // Re-grab the client lock too, for the shared-storage case: the old holder
      // released it when it died or was deposed. Best-effort and unawaited.
      if (store && typeof store.claimWindow === "function") store.claimWindow(requireReview());
      startHeartbeat();
      recomputeStatus();
      onHeld();
    }

    /**
     * The reviewer's "Review here instead" (finding 12). It re-posts the claim
     * with takeover:true, which the helper honors for any token-bearing window
     * (NEW-2's decision: takeover is same-token-trusted, not secret-proven),
     * deposing even a live holder. On success this window becomes the holder.
     *
     * @returns {Promise<{ok: boolean, reason?: string}>}
     */
    function takeover() {
      return claimRequest({ review: requireReview(), window_id: store.windowId, takeover: true }).then(function (parsed) {
        if (parsed.granted) {
          becomeHolder(parsed);
          return { ok: true };
        }
        return { ok: false, reason: parsed.refused ? reasonFromBody(parsed.body) : "the helper could not be reached" };
      });
    }

    /**
     * End review (D10): the reviewer chose the door on the rail.
     *
     * The outbox is drained to empty FIRST. The reviewer's last keystrokes are
     * ordinarily still behind the 750ms debounce at the moment they reach for
     * the door, and a review archived over them loses the last thing they
     * wrote. Everything else here is the ordinary mutating post: the route is
     * declared mutating with a review token, so headersFor already sends what
     * D11 checks.
     *
     * @returns {Promise<{ok: boolean, endedAt: ?string, outstandingKept: ?number, unsent: number, reason: ?string}>}
     */
    function endReview() {
      return drainOutbox().then(function (drained) {
        var unsent = (drained && drained.remaining) || 0;
        return request("review.end", { method: "POST", body: JSON.stringify({ review: requireReview() }) }).then(
          function (result) {
            if (result.ok) {
              markReachable();
              var body = result.body || {};
              return {
                ok: true,
                endedAt: body.ended_at || null,
                outstandingKept: typeof body.outstanding_kept === "number" ? body.outstanding_kept : null,
                // Nothing is lost when this is not zero: those events are in
                // browser storage and the next load posts them. The caller says
                // so rather than letting the reviewer assume everything landed.
                unsent: unsent,
                reason: null
              };
            }
            return {
              ok: false,
              endedAt: null,
              outstandingKept: null,
              unsent: unsent,
              reason: describe(result) || "the helper could not be reached"
            };
          }
        );
      });
    }

    function startHeartbeat() {
      if (heartbeatTimer) return heartbeatTimer;
      // harness-allow-timer: the holder's heartbeat. The helper calls a holder
      // lost after STALE_AFTER_MS of silence, so re-posting the claim on this
      // cadence is what keeps this window the holder (finding 2).
      heartbeatTimer = setInterval(postHeartbeat, heartbeatMs);
      return heartbeatTimer;
    }

    function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (claimRetryTimer) clearTimeout(claimRetryTimer);
      claimRetryTimer = null;
    }

    /**
     * Give up the review, because another window has it.
     *
     * The only path from holding to read-only. It is behind the miss counter for
     * every refusal except an explicit deposition, because closing the
     * reviewer's open comment boxes for a helper that is merely being replaced
     * is the loss this whole debounce exists to stop.
     */
    function loseTheReview(reason) {
      lock.acquired = false;
      lock.refusedBy = "helper";
      lock.reason = reason;
      raise(failures.failure("SECOND_WINDOW_REFUSED", lock.reason));
      recomputeStatus();
      enterReadOnly();
    }

    /** Try the heartbeat again sooner than the next beat, during a bad patch. */
    function retryHeartbeatSoon() {
      if (claimRetryTimer || readOnly || !lock.acquired) return null;
      // harness-allow-timer: the faster retry that makes three consecutive
      // misses take about three seconds instead of thirty.
      claimRetryTimer = setTimeout(function () {
        claimRetryTimer = null;
        postHeartbeat();
      }, CLAIM_RETRY_MS);
      return claimRetryTimer;
    }

    function postHeartbeat() {
      return claimRequest({
        review: requireReview(),
        window_id: store.windowId,
        session_secret: sessionSecret,
        takeover: false
      }).then(function (parsed) {
        if (parsed.granted) {
          lock.helperGranted = true;
          claimMisses = 0;
          if (parsed.sessionSecret) rememberSecret(parsed.sessionSecret, parsed.seq);
          // The helper is covering separate-storage windows again, so the
          // named limit stops being actual and its note comes down.
          onLimit(null);
          return parsed;
        }
        if (parsed.refused && parsed.deposed) {
          // A person in another window pressed Review here instead. Nothing
          // ambiguous about it, and nothing to wait for.
          claimMisses = 0;
          loseTheReview(reasonFromBody(parsed.body));
          return parsed;
        }
        claimMisses += 1;
        if (parsed.refused) {
          if (claimMisses >= CLAIM_MISSES_BEFORE_READ_ONLY) {
            claimMisses = 0;
            loseTheReview(reasonFromBody(parsed.body));
            return parsed;
          }
          // A refusal that may just be a helper that has not read the session
          // table yet. Ask again shortly before believing it.
          retryHeartbeatSoon();
          return parsed;
        }
        // Unreachable: keep the heartbeat running and try again next tick. The
        // uncovered case is actual for as long as this lasts, so the note is up.
        lock.helperGranted = false;
        onLimit(overlay.LIMIT_SEPARATE_STORAGE_NO_HELPER);
        retryHeartbeatSoon();
        return parsed;
      });
    }

    function startLiveness() {
      if (livenessTimer) return livenessTimer;
      // harness-allow-timer: the refused window's liveness poll. It re-attempts
      // the claim with takeover:false; while the holder is alive it is refused
      // and nothing happens, but once the holder goes stale the helper grants it
      // and this becomes D5's 30s auto-takeover (NEW-2).
      livenessTimer = setInterval(pollLiveness, heartbeatMs);
      return livenessTimer;
    }

    function stopLiveness() {
      if (livenessTimer) clearInterval(livenessTimer);
      livenessTimer = null;
    }

    function pollLiveness() {
      claimRequest({ review: requireReview(), window_id: store.windowId, takeover: false }).then(function (parsed) {
        if (parsed.granted) becomeHolder(parsed);
      });
    }

    /**
     * Hand the review back on the way out.
     *
     * A window used to lose the review only by GOING QUIET, and the helper waited
     * out STALE_AFTER_MS before believing it.
     *
     * NOT the same-tab reload, which was already fine: the page that comes back
     * reads the outgoing page's secret out of storage and is recognized as the
     * same holder (see loadPersistedSecret). The paths that were broken are the
     * ones with no shared storage to inherit that secret through, and the one a
     * reviewer actually meets is a served page whose ADDRESS CHANGES under them,
     * because the server that served it restarted on a new port. Different
     * origin, different storage, no secret: a stranger asking for a review that a
     * page which no longer exists still holds, refused until the clock runs out
     * (Ken, live, 2026-08-25).
     *
     * Keepalive, like the flush beside it: the document is going away and an
     * ordinary fetch dies with it. The body is two short strings, so it is never
     * near the keepalive size limit that the flush has to guard against.
     *
     * ONLY WITH THE SECRET. It is what proves this window is the holder, and the
     * helper ignores a release without it. A window that never held the review
     * has no secret and therefore says nothing here, which is right: it has
     * nothing to give back.
     */
    function releaseOnUnload() {
      if (!sessionSecret) return null;
      if (readOnly) return null;
      // THE BEAT STOPS FIRST. A heartbeat is a claim, and a claim that lands
      // after the goodbye finds no holder and is granted: the page that just
      // left takes the review back on its way out the door, and holds it for the
      // full staleness clock because nothing is alive to beat for it again. The
      // release then looks like it did nothing, which is how this was found.
      stopHeartbeat();
      stopLiveness();
      var body = JSON.stringify({ review: requireReview(), session_secret: sessionSecret });
      // The secret dies with the page either way. Dropping it here too means a
      // bfcache restore re-claims from scratch rather than heartbeating with a
      // secret the helper has already forgotten.
      sessionSecret = null;
      return request("window.release", { method: "POST", body: body, keepalive: true });
    }

    function commitOnUnload() {
      unloading = true;
      var flushed = flush({ unload: true });
      // AFTER the flush is started, not before. The reviewer's last keystrokes
      // are the thing that must not be lost; the goodbye is a courtesy to the
      // next window, and a release that beat the flush out the door would hand
      // the review on while this page still had words to send.
      releaseOnUnload();
      return flushed;
    }

    // A page restored from the bfcache, or a beforeunload the reviewer cancelled,
    // is a live document again: real failures have to be audible from here on.
    function onPageShow() {
      unloading = false;
    }

    function stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearTimeout(pollTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = null;
      stopHeartbeat();
      stopLiveness();
      debounceTimer = null;
      retryTimer = null;
      pollTimer = null;
      if (doc && typeof doc.removeEventListener === "function") {
        doc.removeEventListener("securitypolicyviolation", onPolicyViolation);
        doc.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (win && typeof win.removeEventListener === "function") {
        win.removeEventListener("pagehide", commitOnUnload);
        win.removeEventListener("beforeunload", commitOnUnload);
        win.removeEventListener("pageshow", onPageShow);
      }
      if (store) store.releaseWindow(review);
      started = false;
      return true;
    }

    function statusOf() {
      return {
        state: state,
        status: status,
        queued: pendingCount(),
        cursor: cursor,
        targetMtime: targetMtime,
        agentLiveness: agentLiveness,
        reloadPending: reloadPending,
        reloadsFired: reloadsFired,
        reloadChecks: reloadChecks,
        readOnly: readOnly,
        cspRefused: cspRefused,
        lastFailure: lastFailure ? lastFailure.code : null,
        counters: Object.assign({}, counters)
      };
    }

    return {
      STATE: STATE,
      BACKOFF_MS: BACKOFF_MS,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
      POLL_INTERVAL_MS: POLL_INTERVAL_MS,
      HIDDEN_POLL_INTERVAL_MS: HIDDEN_POLL_INTERVAL_MS,
      start: start,
      stop: stop,
      recordItem: recordItem,
      deleteItem: deleteItem,
      eventFor: eventFor,
      flush: flush,
      drainOutbox: drainOutbox,
      commitOnUnload: commitOnUnload,
      takeover: takeover,
      endReview: endReview,
      // Exposed so a test can drive one beat instead of waiting ten seconds for
      // the timer. The harness forbids arbitrary sleeps, and the whole point of
      // the miss counter is what happens across several beats in a row.
      heartbeat: postHeartbeat,
      claimMisses: function () {
        return claimMisses;
      },
      isReadOnly: function () {
        return readOnly;
      },
      poll: poll,
      noteTargetMtime: noteTargetMtime,
      noteAgentLiveness: noteAgentLiveness,
      agentLiveness: function () { return agentLiveness; },
      classify: classify,
      repliesSeen: function () {
        return repliesSeen.slice();
      },
      lockState: function () {
        return lock;
      },
      status: statusOf
    };
  }

  return {
    STATE: STATE,
    BACKOFF_MS: BACKOFF_MS,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    POLL_INTERVAL_MS: POLL_INTERVAL_MS,
    HIDDEN_POLL_INTERVAL_MS: HIDDEN_POLL_INTERVAL_MS,
    pollIntervalFor: pollIntervalFor,
    RELOAD_DEBOUNCE_MS: RELOAD_DEBOUNCE_MS,
    RELOAD_NOTICE_MS: RELOAD_NOTICE_MS,
    VIEWPORT_MARKER_VERSION: VIEWPORT_MARKER_VERSION,
    VIEWPORT_MARKER_KEY: VIEWPORT_MARKER_KEY,
    STEADY_HIDE_MS: STEADY_HIDE_MS,
    STEADY_FADE_MS: STEADY_FADE_MS,
    STEADY_DRIFT_PX: STEADY_DRIFT_PX,
    STEADY_SETTLE_MS: STEADY_SETTLE_MS,
    MAX_BLOCKS_SCANNED: MAX_BLOCKS_SCANNED,
    blockCandidates: blockCandidates,
    blockTextsIn: blockTextsIn,
    BLOCK_SNAPSHOT_KEY: BLOCK_SNAPSHOT_KEY,
    BLOCK_SNAPSHOT_VERSION: BLOCK_SNAPSHOT_VERSION,
    SNAPSHOT_MAX_BLOCKS: SNAPSHOT_MAX_BLOCKS,
    SNAPSHOT_MAX_BYTES: SNAPSHOT_MAX_BYTES,
    RELOAD_REASON: RELOAD_REASON,
    COUNTER_TEXT_MAX: COUNTER_TEXT_MAX,
    looksLikeACounter: looksLikeACounter,
    selfChangingBlocks: selfChangingBlocks,
    isExcludedBlock: isExcludedBlock,
    isInsideMirror: isInsideMirror,
    isVisuallyHidden: isVisuallyHidden,
    blockPath: blockPath,
    noteStableBlocks: noteStableBlocks,
    stableBlocks: stableBlocks,
    snapshotPayload: snapshotPayload,
    saveBlockSnapshot: saveBlockSnapshot,
    takeBlockSnapshot: takeBlockSnapshot,
    diffBlockTexts: diffBlockTexts,
    topBlockAnchor: topBlockAnchor,
    findUniqueBlock: findUniqueBlock,
    saveViewportForReload: saveViewportForReload,
    RAIL_MARKER_KEY: RAIL_MARKER_KEY,
    RAIL_MARKER_VERSION: RAIL_MARKER_VERSION,
    saveRailForReload: saveRailForReload,
    restoreRailAfterReload: restoreRailAfterReload,
    restoreViewportAfterReload: restoreViewportAfterReload,
    lastReloadRestore: lastReloadRestore,
    steadyAfterReload: steadyAfterReload,
    lastSteady: lastSteady,
    decideFailureCode: decideFailureCode,
    createSync: createSync
  };
});
