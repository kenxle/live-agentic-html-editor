// AC1, the built-document case, as a script. Ranked test 39, first of three.
//
// The criterion, word for word:
//
//   "The evaluator is handed a file of five prepared strings. They add the
//    library to a built HTML report, fix three sentences by typing the prepared
//    strings, comment on a diagram, leave an untethered note, and mark all five
//    ready. With no agent ever running, they copy the review out and diff it
//    against the prepared file. Then they start the helper and all five appear
//    in review.json. Fails if: any item is missing, the diff against the
//    prepared strings is non-empty, or the cropped screenshot diff is non-zero."
//
// The layout half is ranked test 18's, in comments_highlights.spec.js, and is
// not re-scored here.
//
// THE PREPARED FILE IS A FILE. test/fixtures/ac1-prepared-strings.txt is byte
// for byte the file the evaluator was handed. This spec reads it, types what it
// says, and diffs the export against it. Nothing here restates a prepared
// string in JavaScript: a test that retypes the expectation cannot tell a fix
// that landed from one the library normalized on the way through.
//
// What is real here:
//
//   REAL  the document: a built HTML report, served over http, with no
//         framework, no poll, and nothing that re-renders
//   REAL  the arrival: one script tag, appended to the built file the way a
//         person adds it, with protocol.js's three attributes
//   REAL  the helper and the token: the helper minted the review, and it is
//         then KILLED, so the whole review is made with nothing running
//   REAL  the records: five, made by the reviewer's own gestures
//   REAL  the way the review comes out: a click on the rail's own Export
//         button, read back off the downloaded file, and (on Chromium) a click
//         on Copy read back off the system clipboard
//
// NO AGENT EVER RUNS. Asserted rather than assumed: no reply file is ever
// written, and every item in review.json comes back with a null reply.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  startStaticServer,
  startService,
  SERVICE_ENTRY
} = require("../helpers");

const protocol = require("../../src/shared/protocol.js");
const exporter = require("../../src/layer/export.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "dist", "lahe-layer.js");
const REPORT_SRC = path.join(REPO_ROOT, "test", "fixtures", "ac1-report.html");
const PREPARED_FILE = path.join(REPO_ROOT, "test", "fixtures", "ac1-prepared-strings.txt");

const REVIEW = "ac1-built-document";

// The three sentences the prepared fixes replace, and where each one lives.
// Only the SELECTORS are named here. The words come out of the prepared file.
const FIX_TARGETS = ["#fix-summary", "#fix-rest", "#fix-checkin"];
const DIAGRAM = "#adherence-chart";

/**
 * The prepared file, parsed. One entry per line, in the file's own order.
 * The kind is read from the file too, so a reordered file reorders the walk
 * rather than silently typing the wrong string into the wrong place.
 */
function readPrepared() {
  const raw = fs.readFileSync(PREPARED_FILE, "utf8");
  const entries = [];
  raw.split("\n").forEach(function (line) {
    const match = /^STRING (\d+) \(([^)]+)\): (.*)$/.exec(line);
    if (!match) return;
    entries.push({ n: Number(match[1]), kind: match[2].split(",")[0].trim(), text: match[3] });
  });
  return entries;
}

// --- the reviewer's gestures, all real ---------------------------------------

async function enterEdit(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

/** Select the whole sentence and type the prepared one over it. */
async function replaceSentence(page, selector, text) {
  await enterEdit(page, selector);
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit the fix on " + selector
  });
  return page.evaluate((sel) => window.__lahe.itemForElement(sel), selector);
}

/** Cmd-Shift-C with nothing selected, then a click on the diagram. */
async function commentOnElement(page, selector, text) {
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => window.__lahe.pickMode() === true, undefined, {
    message: "Cmd-Shift-C with nothing selected to open element-pick mode"
  });
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(12, box.height / 2));
  await pollPage(page, () => window.__lahe.pickMode() === false, undefined, {
    message: "the diagram to be picked"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

async function untetheredNote(page, text) {
  await page.evaluate(() => window.__lahe.handle.tab().focusNote());
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

// --- the real controls -------------------------------------------------------

/** Click the rail's own button, by its label, inside the closed shadow root. */
function clickRailButton(page, label) {
  return page.evaluate(function (wanted) {
    var pane = window.__lahe.rail.tabBody("active");
    if (!pane) throw new Error("the rail is not mounted, so it has no buttons");
    var root = pane.getRootNode();
    var buttons = Array.prototype.slice.call(root.querySelectorAll("button"));
    var button = buttons.filter(function (node) {
      return (node.textContent || "").trim() === wanted;
    })[0];
    if (!button) {
      throw new Error(
        "no button labelled " +
          wanted +
          " in the rail. It holds: " +
          buttons
            .map(function (n) {
              return JSON.stringify((n.textContent || "").trim());
            })
            .join(", ")
      );
    }
    button.click();
    return true;
  }, label);
}

const SENTINEL = "clipboard has not been written yet";

async function copyThroughTheButton(page) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
  await clickRailButton(page, "Copy");
  return pollUntil(
    async () => {
      const got = await page.evaluate(() => navigator.clipboard.readText());
      return got && got !== SENTINEL ? got : null;
    },
    {
      message: "the Copy button to put the review on the clipboard",
      describe: async () => ({ last: await page.evaluate(() => window.__lahe.exporter.last()) })
    }
  );
}

async function exportThroughTheButton(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), clickRailButton(page, "Export")]);
  const file = await download.path();
  return { text: fs.readFileSync(file, "utf8"), filename: download.suggestedFilename() };
}

// --- reading the export ------------------------------------------------------

/**
 * The reviewer's own words, pulled back out of the exported text.
 *
 * The two fields the format carries the reviewer's intent in are `Note (the
 * reviewer's words)` and, for a fix, the region's `After`. Nothing else in the
 * export is the reviewer's, so those are the only lines read.
 */
function reviewerStringsIn(text) {
  const out = [];
  text.split("\n").forEach(function (line) {
    const note = /^ {2}Note \(the reviewer's words\): (.*)$/.exec(line);
    if (note) {
      out.push(note[1]);
      return;
    }
    const after = /^ {2}After \(page text, with the edit\): (.*)$/.exec(line);
    if (after) out.push(after[1]);
  });
  return out;
}

function projectedItems(projection) {
  if (!projection) return [];
  return projection.pages.reduce((all, page) => all.concat(page.items), []);
}

function reviewJson(stateDir) {
  const file = path.join(stateDir, "reviews", REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null; // caught mid-rename, which the atomic write makes vanishingly rare
  }
}

test.describe("AC1: the built-document case", () => {
  test("five prepared strings typed into a built report come back out byte-identical, with nothing running", async ({
    page,
    browserName
  }) => {
    const prepared = readPrepared();
    expect(prepared, "the prepared file holds five strings").toHaveLength(5);

    const clipboardLane = browserName === "chromium";
    if (clipboardLane) {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    }

    expect(fs.existsSync(BUNDLE_PATH), "dist/lahe-layer.js is built").toBe(true);

    // A copy of the built report, in a directory of its own, with the bundle
    // beside it: which is what adding the library to a built document means.
    // Nothing is deleted afterwards; the directory is on the cleanup list.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-ac1-"));
    const reportPath = path.join(workDir, "report.html");
    fs.copyFileSync(REPORT_SRC, reportPath);
    fs.copyFileSync(BUNDLE_PATH, path.join(workDir, "lahe-layer.js"));

    const site = await startStaticServer({ root: workDir, label: "ac1-report" });

    // The helper mints the review and its token. It is the only thing it does
    // in this walk: the moment the script line is written, it is killed.
    let helper = await startService({
      entry: SERVICE_ENTRY,
      args: ["--port", "0"],
      reviews: [REVIEW],
      allowedOrigins: [site.origin]
    });
    const port = helper.port;
    const stateDir = helper.stateDir;
    const token = helper.tokenFor(REVIEW);
    expect(token, "the helper minted a per-review token").toBeTruthy();

    try {
      // THE ONE LINE. protocol.scriptTag's pinned form, appended to the built
      // file, which is the whole of "add the library to a built HTML report".
      const built = fs.readFileSync(reportPath, "utf8");
      fs.writeFileSync(
        reportPath,
        built.replace(
          "</body>",
          protocol.scriptTag({
            src: "/lahe-layer.js",
            review: REVIEW,
            token: token,
            helper: helper.url
          }) + "\n</body>"
        )
      );

      // Nothing is running. Not the helper, and never an agent.
      await helper.kill9();
      expect(helper.alive(), "the helper is down before the reviewer starts").toBe(false);

      await page.goto(site.urlFor("report.html"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from the script line added to the built report"
      });

      // --- the five gestures --------------------------------------------------

      const fixes = prepared.filter((entry) => entry.kind === "fix");
      const comment = prepared.filter((entry) => entry.kind === "comment")[0];
      const note = prepared.filter((entry) => /note$/.test(entry.kind))[0];
      expect(fixes, "three prepared fixes").toHaveLength(3);
      expect(comment && note, "a prepared comment and a prepared note").toBeTruthy();

      for (let i = 0; i < fixes.length; i += 1) {
        const record = await replaceSentence(page, FIX_TARGETS[i], fixes[i].text);
        expect(record.kind, FIX_TARGETS[i] + " is an edit").toBe("edit");
        expect(
          Buffer.compare(Buffer.from(record.after, "utf8"), Buffer.from(fixes[i].text, "utf8")),
          "the sentence on the page is the prepared string, byte for byte: " + FIX_TARGETS[i]
        ).toBe(0);
      }

      await commentOnElement(page, DIAGRAM, comment.text);
      await untetheredNote(page, note.text);

      // All five, all ready. An edit the reviewer left is ready; a comment
      // finished with Cmd-Enter is ready.
      const items = await page.evaluate(() => window.__lahe.items());
      expect(items, "five records").toHaveLength(5);
      expect(
        items.map((item) => item.state),
        "every one of the five is ready"
      ).toEqual(["ready", "ready", "ready", "ready", "ready"]);
      expect(items.filter((item) => item.kind === "edit")).toHaveLength(3);
      expect(items.filter((item) => item.kind === "comment")).toHaveLength(1);
      expect(items.filter((item) => item.kind === "note")).toHaveLength(1);

      // --- the review comes out, with nothing running -------------------------

      expect(helper.alive(), "still nothing running when the review is copied out").toBe(false);

      const exported = await exportThroughTheButton(page);
      expect(exported.text.length, "the export is not empty").toBeGreaterThan(0);
      expect(exported.text, "and it says what it is, because nothing is running").toContain(
        exporter.SLICE_LABEL
      );

      if (clipboardLane) {
        const copied = await copyThroughTheButton(page);
        expect(
          Buffer.compare(Buffer.from(copied, "utf8"), Buffer.from(exported.text, "utf8")),
          "Copy and Export produce the same bytes"
        ).toBe(0);
      }

      // --- THE DIFF AGAINST THE PREPARED FILE ---------------------------------
      //
      // Every reviewer-authored string in the export, sorted, against every
      // prepared string, sorted. Sorted rather than in order because the export
      // groups by page and orders items its own way, and unsorted comparison
      // would fail on ordering rather than on content. Nothing else is lost by
      // sorting: a missing string, an extra string, and a single changed byte
      // all still fail.
      const observed = reviewerStringsIn(exported.text).slice().sort();
      const expectedStrings = prepared.map((entry) => entry.text).slice().sort();

      expect(observed, "five reviewer strings in the export, no more and no fewer").toHaveLength(5);
      expect(
        Buffer.compare(
          Buffer.from(observed.join("\n"), "utf8"),
          Buffer.from(expectedStrings.join("\n"), "utf8")
        ),
        "the diff against the prepared file is empty:\n  export:   " +
          JSON.stringify(observed) +
          "\n  prepared: " +
          JSON.stringify(expectedStrings)
      ).toBe(0);

      // --- then they start the helper ------------------------------------------

      helper = await startService({
        entry: SERVICE_ENTRY,
        args: ["--port", String(port)],
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [site.origin]
      });

      const projection = await pollUntil(
        () => {
          const got = reviewJson(stateDir);
          return got && projectedItems(got).length === 5 ? got : null;
        },
        {
          message: "all five items to reach review.json once the helper is started",
          describe: async () => ({
            inFile: projectedItems(reviewJson(stateDir)).length,
            status: await page.evaluate(() => window.__lahe.status()),
            pending: await page.evaluate(() =>
              window.__lahe.store().pendingEvents(window.__lahe.review).length
            ),
            helperLog: fs
              .readFileSync(path.join(stateDir, "helper.log"), "utf8")
              .slice(-1200)
          })
        }
      );

      const projected = projectedItems(projection);
      expect(projected, "all five are in the file the agent reads").toHaveLength(5);

      // The same five strings, in the file, byte for byte.
      const inFile = projected
        .map((item) => (item.kind === "edit" ? item.after_full : item.note))
        .slice()
        .sort();
      expect(
        Buffer.compare(
          Buffer.from(inFile.join("\n"), "utf8"),
          Buffer.from(expectedStrings.join("\n"), "utf8")
        ),
        "review.json carries the prepared strings unchanged:\n  file:     " +
          JSON.stringify(inFile) +
          "\n  prepared: " +
          JSON.stringify(expectedStrings)
      ).toBe(0);

      // NO AGENT EVER RAN. Two readings: no reply file was ever created, and
      // every item comes back with a null reply.
      const reviewDir = path.join(stateDir, "reviews", REVIEW);
      const replyFiles = fs.readdirSync(reviewDir).filter((name) => /^replies.*\.jsonl$/.test(name));
      const nonEmptyReplies = replyFiles.filter(
        (name) => fs.statSync(path.join(reviewDir, name)).size > 0
      );
      expect(nonEmptyReplies, "no agent ever wrote a reply line").toEqual([]);
      projected.forEach(function (item) {
        expect(item.reply, "no item carries an answer: " + item.id).toBeNull();
      });
    } finally {
      if (helper.alive()) await helper.kill9();
      await site.close();
    }
  });
});
