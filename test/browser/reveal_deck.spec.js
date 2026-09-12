// The real reveal.js deck, not a stand-in for one.
//
// Four collisions with reveal came out of one week of Ken reviewing and
// presenting decks with this tool:
//
//   1. The space bar typed into an anchored comment box advanced the slide.
//   2. The same keys typed into the rail's own fields did the same.
//   3. Pressing S opened the speaker-notes window, which embeds the deck in an
//      iframe, and the embedded copy booted a second library on the same review
//      and fought the real window for the claim.
//   4. The "here is what the agent changed" mark lit up the slide number and a
//      countdown, because a deck rewrites those itself every second.
//
// Each was fixed against a fixture that imitates one of reveal's habits:
// hotkeys-page.html reproduces its activeElement check, frames-parent.html
// reproduces the notes window's iframe, change_highlight.spec.js builds a page
// with a ticker on it. Those fixtures state the condition and they are worth
// keeping, because they fail for one reason and name it.
//
// This file is the other half: the same claims against reveal itself, loaded
// from vendor/reveal.js. If a future reveal release changes how the deck
// listens for keys, or what the notes window embeds, or how often it redraws
// the slide number, that lands here rather than in a live presentation.
//
// Two servers, for two different needs:
//
//   - The plain tests serve the REPO ROOT, because the fixture reaches out of
//     test/fixtures/ into vendor/ for the library.
//   - The notes-window test and the rebuild test each stage a temp directory
//     with the same shape (vendor/, test/fixtures/, a bundle at the root), so
//     the deck can carry a real script tag and, for the rebuild, so the file
//     under review can be rewritten under the reviewer.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startStaticServer, startService } = require("../helpers");
const manifest = require("../../src/shared/manifest.js");
const protocol = require("../../src/shared/protocol.js");
const highlightModule = require("../../src/layer/highlight.js");
const replayModule = require("../../src/layer/replay.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE_REL = "test/fixtures/reveal-deck.html";
const FIXTURE_HTML = fs.readFileSync(path.join(REPO_ROOT, FIXTURE_REL), "utf8");
const REVIEW = "rev_reveal_deck";

const CHANGED_NAMES = [
  highlightModule.NAME.CHANGED,
  highlightModule.NAME.CHANGED_FADING,
  highlightModule.NAME.CHANGED_FAINT
];
const COMMENT_NAMES = [highlightModule.NAME.COMMENT, highlightModule.NAME.ACTIVE];

// The deck's own keys, in the order a reviewer's sentence produces them. Every
// one of these does something in reveal: space advances, s opens the notes
// window, f goes fullscreen, o opens the overview, ArrowRight advances.
const DECK_KEYS = [" ", "s", "f", "o"];

// The bundle, concatenated in the manifest's order, in memory. Builders never
// commit dist/, so reading dist/ would test whoever last ran the build script
// rather than the source in this worktree.
function layerBundle() {
  return manifest
    .builtFiles()
    .map(function (entry) {
      return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
    })
    .join("\n");
}

const BUNDLE = layerBundle();

// ---------------------------------------------------------------------------
// Staging a deck that can carry its own script tag
// ---------------------------------------------------------------------------

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/**
 * Lay out a temp directory with the repo's shape, so the fixture's relative
 * paths into vendor/ resolve exactly as they do in the repo.
 *
 * @returns {{dir: string, pagePath: string, pageUrlPath: string}}
 */
function stageDeckTree(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-reveal-" + label + "-"));
  copyTree(path.join(REPO_ROOT, "vendor", "reveal.js"), path.join(dir, "vendor", "reveal.js"));
  fs.mkdirSync(path.join(dir, "test", "fixtures", "assets"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "test", "fixtures", "assets", "ticking-counter.js"),
    path.join(dir, "test", "fixtures", "assets", "ticking-counter.js")
  );
  fs.writeFileSync(path.join(dir, "lahe-layer.js"), BUNDLE);
  return {
    dir: dir,
    pagePath: path.join(dir, FIXTURE_REL),
    pageUrlPath: "/" + FIXTURE_REL
  };
}

/** The deck, with a real LAHE script tag on it, the way `lahe review` injects one. */
function deckWithScriptTag(html, helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  const tag =
    '<script src="/lahe-layer.js" ' +
    attrs.REVIEW +
    '="' +
    REVIEW +
    '" ' +
    attrs.TOKEN +
    '="' +
    token +
    '" ' +
    attrs.HELPER +
    '="' +
    helperOrigin +
    '"><' +
    "/script>";
  return html.replace("</body>", tag + "\n</body>");
}

// ---------------------------------------------------------------------------
// Booting
// ---------------------------------------------------------------------------

async function deckReady(page) {
  await pollPage(page, () => window.__deckReady === true, undefined, {
    message: "reveal to finish initializing the deck"
  });
}

/** The library on top of the booted deck, with the sync client held back. */
async function bootLayer(page) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (review) {
    window.__h = window.LAHE.layer.boot({
      review: review,
      token: "",
      helper: "http://127.0.0.1:1",
      startSync: false
    });
  }, REVIEW);
}

/** Everything about the deck a stray key would move. */
function deckState(page) {
  return page.evaluate(function () {
    const indices = Reveal.getIndices();
    return {
      h: indices.h,
      v: indices.v,
      hash: location.hash,
      overview: Reveal.isOverview(),
      fullscreen: !!document.fullscreenElement
    };
  });
}

function goToSlide(page, h) {
  return page.evaluate(function (index) {
    Reveal.slide(index, 0);
  }, h);
}

/** Nothing of the library's and nothing of the page's holds focus. */
function blurEverything(page) {
  return page.evaluate(function () {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.focus();
  });
}

function selectElementText(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

function itemsIn(page) {
  return page.evaluate(function (review) {
    return window.__h.store.read(review);
  }, REVIEW);
}

async function commitComment(page, selector, text) {
  await selectElementText(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const items = await itemsIn(page);
  return items[items.length - 1];
}

/**
 * Focus one of the rail's own fields, by name, from inside the closed root.
 * The same way page_hotkeys_fenced.spec.js reaches in: a card node the library
 * hands back is the only door into a closed shadow root.
 */
function focusRailField(page, which, itemId) {
  return page.evaluate(
    function (args) {
      const h = window.__h;
      const node = h.rail.cardNode(args.id);
      const root = node ? node.getRootNode() : null;
      if (!root) return { focused: false, reason: "no card node" };
      let field = null;
      if (args.which === "card-note") {
        field = node.querySelector(".lahe-rail-note");
        if (field) field.focus();
      } else if (args.which === "composer") {
        field = root.querySelector('textarea[aria-label="Add another message to this comment"]');
        if (field) field.focus();
      } else if (args.which === "page-note") {
        const noteHandle = h.tab().ensureNoteBox();
        h.tab().focusNote();
        field = noteHandle ? noteHandle.input : null;
      } else if (args.which === "followup") {
        h.rail.selectTab("done");
        const composer = h.doneTab().followup(args.id);
        field = composer ? composer.querySelector("textarea") : null;
        if (field) field.focus();
      }
      const active = root.activeElement;
      if (!field || active !== field) {
        return { focused: false, wanted: args.which, active: active ? active.tagName : null };
      }
      return { focused: true };
    },
    { which: which, id: itemId }
  );
}

/** Fold an agent reply in, so the Done tab grows its follow-up composer. */
function foldReply(page, itemId) {
  return page.evaluate(
    function (args) {
      const current = window.__h.store.read(args.review).filter(function (row) {
        return row.id === args.id;
      })[0];
      return window.__h.doneTab().applyReplies([
        {
          event: "reply.folded",
          item: current.id,
          rev: current.rev,
          accepted: true,
          state: "handled",
          ts: new Date().toISOString(),
          reply: { status: "handled", agent: "codex", message: "Reworded the third week line." }
        }
      ]);
    },
    { id: itemId, review: REVIEW }
  );
}

// ---------------------------------------------------------------------------
// Reading what is painted
// ---------------------------------------------------------------------------

/**
 * Every element wearing one of the named highlights, labelled the way a person
 * would point at it: "#four-para", ".slide-number".
 *
 * Read out of the browser's own highlight registry rather than out of the
 * library, so this is what the reviewer's screen shows. Labels rather than ids,
 * because reveal's slide number has no id and it is one of the two things this
 * file exists to keep unpainted.
 */
function paintedLabels(page, names) {
  return page.evaluate((wanted) => {
    const labels = [];
    if (typeof CSS === "undefined" || !CSS.highlights) return labels;
    CSS.highlights.forEach((highlight, name) => {
      if (wanted.indexOf(name) === -1) return;
      highlight.forEach((range) => {
        const node = range.commonAncestorContainer;
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return;
        let label = null;
        for (let walk = el; walk && walk !== document.body; walk = walk.parentElement) {
          if (walk.id) {
            label = "#" + walk.id;
            break;
          }
          if (walk.className && typeof walk.className === "string" && walk.className.trim()) {
            label = "." + walk.className.trim().split(/\s+/)[0];
            break;
          }
        }
        if (label && labels.indexOf(label) === -1) labels.push(label);
      });
    });
    return labels.sort();
  }, names);
}

// ---------------------------------------------------------------------------
// The plain tests: the deck served from the repo root, the layer injected
// ---------------------------------------------------------------------------

test.describe("a real reveal.js deck under review", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "reveal-repo" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("the deck's own keys still drive the deck when nothing of the library holds focus", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE_REL));
    await deckReady(page);
    await bootLayer(page);
    await blurEverything(page);

    const before = await deckState(page);
    expect(before.h, "the deck opens on the first slide").toBe(0);

    await page.keyboard.press("ArrowRight");
    await pollPage(page, () => Reveal.getIndices().h === 1, undefined, {
      message: "ArrowRight to advance the real deck"
    });

    const after = await deckState(page);
    expect(after.h, "the deck moved on").toBe(1);

    // reveal writes the URL on its own schedule rather than inside the keydown,
    // so this is a poll and not a read: the hash is the deck's record of where
    // the presenter is, and it catches up a beat later.
    await pollPage(page, (was) => location.hash !== was, before.hash, {
      message: "reveal to write the new slide into the URL, because hash is on"
    });
  });

  test("keys typed into an anchored comment box never reach the deck", async ({ page }) => {
    const popups = [];
    page.on("popup", (popup) => popups.push(popup));

    await page.goto(server.urlFor(FIXTURE_REL));
    await deckReady(page);
    await bootLayer(page);
    await goToSlide(page, 1);

    const before = await deckState(page);

    await selectElementText(page, "#passage-para");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__h.comments.focusedBox(), undefined, {
      message: "the comment box to open on the slide's paragraph"
    });

    // A sentence carrying every one of the deck's keys, then the arrow key.
    const typed = "so fast, and the s and f and o all sit in here";
    await page.keyboard.type(typed);
    await page.keyboard.press("ArrowRight");

    expect(await deckState(page), "the deck did not move, open its overview, or go fullscreen").toEqual(before);
    expect(popups, "and no speaker-notes window opened").toHaveLength(0);

    const inBox = await page.evaluate(function () {
      const box = window.__h.comments.focusedBox();
      return box ? box.input.value : null;
    });
    expect(inBox, "every key landed in the comment box instead").toBe(typed);

    // The box's own commit gesture still works: the fence listens on the way
    // back up, after the target has had the event.
    await page.keyboard.press("ControlOrMeta+Enter");
    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe(typed);
  });

  test("keys typed into each of the rail's four fields never reach the deck", async ({ page }) => {
    const popups = [];
    page.on("popup", (popup) => popups.push(popup));

    await page.goto(server.urlFor(FIXTURE_REL));
    await deckReady(page);
    await bootLayer(page);
    await goToSlide(page, 1);

    const item = await commitComment(page, "#passage-para", "the tendon line needs a number");
    expect(item, "a comment to grow the rail's fields on").toBeTruthy();

    const before = await deckState(page);

    // Three fields live in the Active tab while a comment is open, and the
    // fourth only exists once an agent has answered.
    for (const which of ["card-note", "composer", "page-note"]) {
      const focused = await focusRailField(page, which, item.id);
      expect(focused.focused, "the " + which + " field takes focus").toBe(true);
      for (const key of DECK_KEYS) await page.keyboard.press(key === " " ? "Space" : key);
      await page.keyboard.press("ArrowRight");
      expect(await deckState(page), "keys typed in " + which + " stayed in the rail").toEqual(before);
      expect(popups, "and " + which + " opened no notes window").toHaveLength(0);
    }

    const folded = await foldReply(page, item.id);
    expect(folded.map((entry) => entry.kind)).toEqual(["folded"]);

    const followup = await focusRailField(page, "followup", item.id);
    expect(followup.focused, "the follow-up composer takes focus").toBe(true);
    for (const key of DECK_KEYS) await page.keyboard.press(key === " " ? "Space" : key);
    await page.keyboard.press("ArrowRight");

    expect(await deckState(page), "keys typed in the follow-up stayed in the rail").toEqual(before);
    expect(popups, "and the follow-up opened no notes window").toHaveLength(0);
  });

  test("an upward drag across two lines of a slide does not flip, and the pill arrives on release", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE_REL));
    await deckReady(page);
    await bootLayer(page);
    await goToSlide(page, 1);

    // The lines of the slide's paragraph, as reveal actually lays them out:
    // scaled by its own transform, so these are measured rather than assumed.
    const lines = await page.evaluate(function () {
      const el = document.getElementById("passage-para");
      const range = document.createRange();
      range.selectNodeContents(el);
      return Array.prototype.map.call(range.getClientRects(), function (r) {
        return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
      });
    });
    expect(lines.length, "reveal wrapped the paragraph over at least two lines").toBeGreaterThanOrEqual(2);

    const lower = lines[1];
    const upper = lines[0];
    const from = { x: lower.left + Math.min(120, lower.width * 0.6), y: lower.top + lower.height / 2 };
    const to = { x: upper.left + Math.min(40, upper.width * 0.2), y: upper.top + upper.height / 2 };

    const delay = await page.evaluate(function () {
      return window.LAHE.comments.POPOVER_DELAY_MS;
    });

    // The hand goes UP, pausing past the pill's debounce at the line boundary.
    // That pause is the bug: it is where a pill used to appear under a cursor
    // that was still moving, and where the selection flipped when the cursor
    // crossed it.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.evaluate(function () {
      window.__dragMark = performance.now();
    });
    await pollPage(page, (ms) => performance.now() - window.__dragMark > ms, delay + 80, {
      message: "the pill's debounce window to elapse mid-drag"
    });

    const during = await page.evaluate(function () {
      const el = document.getElementById("passage-para");
      const sel = window.getSelection();
      const node = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
      const holder = node && node.nodeType === 1 ? node : node && node.parentElement;
      return {
        pill: window.__h.comments.selectionPopover().visible,
        inside: !!(holder && el.contains(holder)),
        text: String(sel)
      };
    });
    expect(during.pill, "no pill while the button is held").toBe(false);
    expect(during.inside, "the selection has not escaped the paragraph").toBe(true);
    expect(during.text.length, "the drag really crossed a line boundary").toBeGreaterThan(10);

    await page.mouse.up();
    await pollPage(page, () => window.__h.comments.selectionPopover().visible === true, undefined, {
      message: "the selection pill to appear once the drag finished"
    });

    const after = await page.evaluate(function () {
      const el = document.getElementById("passage-para");
      const sel = window.getSelection();
      const text = String(sel);
      return {
        placement: window.__h.comments.selectionPopover().placement,
        isSubstring: text.length > 0 && el.textContent.indexOf(text) !== -1,
        length: text.length,
        paragraphLength: el.textContent.length
      };
    });
    expect(after.isSubstring, "the selection is still text from that paragraph only").toBe(true);
    expect(after.length, "and it stopped where the reviewer stopped").toBeLessThan(after.paragraphLength);
    expect(after.placement, "the pill sits above an upward drag, away from the cursor").toBe("above");
  });

  test("a comment made on one slide survives navigating away and back", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE_REL));
    await deckReady(page);
    await bootLayer(page);
    await goToSlide(page, 2);

    const item = await commitComment(page, "#three-para", "this is the sentence people quote");
    expect(item).toBeTruthy();

    const painted = () => paintedLabels(page, COMMENT_NAMES);
    expect(await painted(), "the passage is painted where the reviewer left it").toContain("#three-para");
    expect(
      await page.evaluate((id) => !!window.__h.rail.cardNode(id), item.id),
      "and the rail is holding its card"
    ).toBe(true);

    // Away to the next slide and back, with the deck's own keys, because that is
    // how a presenter moves. reveal hides a slide by taking it out of layout,
    // which is exactly the case a highlight bound to a live range has to survive.
    await blurEverything(page);
    await page.keyboard.press("ArrowRight");
    await pollPage(page, () => Reveal.getIndices().h === 3, undefined, {
      message: "the deck to advance past the commented slide"
    });
    await page.keyboard.press("ArrowLeft");
    await pollPage(page, () => Reveal.getIndices().h === 2, undefined, {
      message: "the deck to come back to the commented slide"
    });

    expect(await painted(), "the passage is still painted").toContain("#three-para");
    expect(
      await page.evaluate((id) => !!window.__h.rail.cardNode(id), item.id),
      "and the card is still in the rail"
    ).toBe(true);
    const stored = await itemsIn(page);
    expect(stored.map((row) => row.note)).toContain("this is the sentence people quote");
  });
});

// ---------------------------------------------------------------------------
// The speaker-notes window: reveal's own, opened by reveal's own key
// ---------------------------------------------------------------------------

test.describe("the speaker-notes window does not start a second review", () => {
  let staged;
  let pages;

  test.beforeAll(async () => {
    staged = stageDeckTree("notes");
    fs.writeFileSync(
      staged.pagePath,
      deckWithScriptTag(FIXTURE_HTML, "http://127.0.0.1:1", "notes-token")
    );
    pages = await startStaticServer({ root: staged.dir, label: "reveal-notes" });
  });

  test.afterAll(async () => {
    if (pages) await pages.close();
  });

  test("pressing S embeds the deck in a notes window, and the embedded copy boots nothing", async ({
    page
  }) => {
    await page.goto(pages.origin + staged.pageUrlPath);
    await deckReady(page);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the presented window to boot from its script tag"
    });
    await blurEverything(page);

    // reveal's own key, with nothing of the library's focused. The notes plugin
    // opens a window and embeds THIS SAME PAGE in it with a receiver query, so
    // the deck's script tag runs a second time on the same review.
    const popupPromise = page.waitForEvent("popup", { timeout: 15000 });
    await page.keyboard.press("s");
    const popup = await popupPromise;
    await popup.waitForLoadState();

    // The notes window writes its own markup, shakes hands with the deck over
    // postMessage, and only THEN builds the preview iframes, so the frame is
    // polled for rather than read once.
    const child = await pollUntil(
      () => popup.frames().filter((frame) => /receiver/.test(frame.url()))[0] || null,
      { timeoutMs: 30000, message: "the notes window to embed the deck in a receiver frame" }
    );
    await child.waitForLoadState();

    const inFrame = await pollUntil(
      async () => {
        const reading = await child
          .evaluate(() => {
            if (!(window.LAHE && window.LAHE.layer)) return null;
            return {
              skipped: window.LAHE.layer.skipped,
              hasGlobal: typeof window.__lahe !== "undefined",
              host: !!document.getElementById("lahe-surface-root")
            };
          })
          .catch(() => null);
        return reading;
      },
      { timeoutMs: 30000, message: "the embedded copy's script tag to run and decide" }
    );

    expect(inFrame.skipped, "the embedded copy says why it did not boot").toBe("framed");
    expect(inFrame.hasGlobal, "and publishes no page global, because it is running no review").toBe(false);
    expect(inFrame.host, "and drew none of the library's chrome into the notes window").toBe(false);

    // The window the presenter is looking at still holds the review. This is the
    // symptom Ken saw: a refusal panel and a read-only rail the moment the notes
    // window came up.
    await page.evaluate(() => window.__lahe.startSync());
    await pollPage(page, () => window.__lahe.rail.isMounted(), undefined, {
      message: "the rail to mount in the presented window"
    });
    const holder = await page.evaluate(() => ({
      refusal: window.__lahe.rail.refusalShown(),
      failures: window.__lahe.failures().map((f) => f.code)
    }));
    expect(holder.refusal, "the presented window is still the holder").toBe(false);
    expect(holder.failures, "nothing was refused as a second window").not.toContain("SECOND_WINDOW_REFUSED");

    await popup.close();
  });
});

// ---------------------------------------------------------------------------
// The rebuild: what the agent changed, and what the deck changes by itself
// ---------------------------------------------------------------------------

const REBUILT_PARA = "Measure the days you ran. The miles take care of themselves once the days are steady, and they will be.";
const ADDED_HEADING = "One more thing";
const ADDED_PARA = "A slide the agent added in answer to the comment, which makes this deck seven slides long instead of six.";

test.describe("a rebuilt deck paints the agent's paragraph and nothing the deck redraws itself", () => {
  let staged;
  let pages;
  let service;
  let token;

  // The rebuild marker is the document TITLE, not anything on a slide.
  //
  // The first version of this test marked the editions on the deck's subtitle,
  // and reveal painted two extra things: the subtitle itself, correctly, and
  // reveal's own `.aria-status` live region, which mirrors the text of whatever
  // slide the presenter is on. Both are honest answers to a changed subtitle,
  // and neither is what this test is asking about. Marking the title keeps the
  // question to one paragraph, and the paragraph is on slide four while the
  // deck sits on slide one, so the announcer is not carrying it either.
  function edition(html, marker, paragraph) {
    const withEdition = html.replace(
      "<title>A real reveal.js deck, under review</title>",
      "<title>" + marker + "</title>"
    );
    if (!paragraph) return withEdition;
    // The agent's rebuild does two things a reviewer would recognize: it rewords
    // a paragraph and it adds a slide. The added slide is what moves reveal's
    // slide number, because the number is current over total.
    return withEdition
      .replace(/<p id="four-para">[^<]*<\/p>/, '<p id="four-para">' + paragraph + "</p>")
      .replace(
        "    </div>\n  </div>",
        '      <section id="slide-seven">\n' +
          '        <h2 id="seven-heading">' +
          ADDED_HEADING +
          "</h2>\n" +
          '        <p id="seven-para">' +
          ADDED_PARA +
          "</p>\n" +
          "      </section>\n\n    </div>\n  </div>"
      );
  }

  function write(filePath, html) {
    fs.writeFileSync(filePath, html);
    // A coarse filesystem clock can give two quick writes the same mtime, and
    // the mtime is the signal the helper watches.
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(filePath, later, later);
  }

  test.beforeAll(async () => {
    staged = stageDeckTree("rebuild");
    pages = await startStaticServer({ root: staged.dir, label: "reveal-rebuild" });
    service = await startService({
      reviews: [REVIEW],
      allowedOrigins: [pages.origin],
      env: { LAHE_PORT: "0" }
    });
    token = service.tokenFor(REVIEW);

    const written = await fetch(service.url + protocol.route("review.write").path, {
      method: "POST",
      headers: {
        "Content-Type": protocol.JSON_CONTENT_TYPE,
        "x-lahe-client": protocol.CLIENT_CLI,
        "x-lahe-token": token,
        Origin: pages.origin
      },
      body: JSON.stringify({ review: REVIEW, origins: [pages.origin], target_path: staged.pagePath })
    });
    expect(written.status, "the helper recorded the reviewed deck's path").toBe(200);
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("one reworded paragraph is marked; the slide number and the countdown never are", async ({ page }) => {
    const tagged = deckWithScriptTag(FIXTURE_HTML, service.url, token);
    write(staged.pagePath, edition(tagged, "First edition", null));

    await page.goto(pages.origin + staged.pageUrlPath);
    await deckReady(page);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from the deck's script tag"
    });
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    // The page has to be read TWICE before the rebuild: once at boot, once when
    // the settling window closes. The second reading is what gives the deck's
    // own moving parts away, and there are three of them here: the countdown,
    // the status line, and reveal's own slide number.
    await pollPage(page, () => window.LAHE.sync.stableBlocks() !== null, undefined, {
      message: "the deck to be read once at boot"
    });
    const firstReading = await page.evaluate(() => window.LAHE.sync.stableBlocks().join("|"));
    await pollPage(
      page,
      (was) => {
        const now = window.LAHE.sync.stableBlocks();
        return !!now && now.join("|") !== was;
      },
      firstReading,
      {
        message: "the settled reading to catch the deck moving on its own",
        timeoutMs: replayModule.SETTLE_MS + 10000
      }
    );

    write(staged.pagePath, edition(tagged, "Second edition", REBUILT_PARA));
    await pollPage(page, () => document.title === "Second edition", undefined, {
      message: "the deck to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await deckReady(page);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await pollPage(page, () => window.__lahe.handle.changedBlocks().length > 0, undefined, {
      message: "the changed block to be marked",
      timeoutMs: replayModule.SETTLE_MS + 10000
    });

    const labels = await paintedLabels(page, CHANGED_NAMES);
    expect(labels, "the reworded paragraph and the added slide, and nothing else").toEqual([
      "#four-para",
      "#seven-heading",
      "#seven-para"
    ]);
    expect(labels, "never the countdown").not.toContain("#clock");
    expect(labels, "never the status line").not.toContain("#status");
    expect(labels, "never reveal's slide number").not.toContain(".slide-number");

    // The exclusions above are earned, not lucky. The slide number really did
    // change across the reload, because the deck grew a slide and the number is
    // current over total, and the countdown really was running the whole time.
    const stillMoving = await page.evaluate(() => ({
      slideNumber: document.querySelector(".slide-number")
        ? document.querySelector(".slide-number").textContent.replace(/\s+/g, " ").trim()
        : null,
      clock: document.querySelector("#clock").textContent
    }));
    expect(stillMoving.slideNumber, "the deck is seven slides long after the rebuild").toContain("7");
    expect(stillMoving.clock, "and the countdown is still counting").not.toBe("0:00");
  });
});
