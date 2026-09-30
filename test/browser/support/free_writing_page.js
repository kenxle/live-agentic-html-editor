// Shared set-up for the free-writing editing specs (plan Tasks 2.1 to 2.4).
//
// The layer arrives the way it does on a reviewed page: one script tag, the
// built bundle, a review id and a token. The helper is deliberately down
// (127.0.0.1:1): every decision these specs check is made in the browser, and
// records live in browser storage. Run `npm run build:layer` first.

"use strict";

const path = require("node:path");

const { pollPage, placeCaret } = require("../../helpers");
const { withLayer } = require("./with_layer");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FIXTURE_DIR = "test/fixtures/free_writing/";
const HELPER = "http://127.0.0.1:1";

let reviewSeq = 0;

/**
 * Open a free-writing fixture with the layer on it. `options.notes: true` marks
 * the review as a notes review, the way `lahe write` does: only a notes review
 * opens an empty page ready to type.
 */
async function openFixture(page, server, file, options) {
  const opts = options || {};
  reviewSeq += 1;
  const review = opts.review || "fw-" + process.pid + "-" + reviewSeq + "-" + Date.now();
  await withLayer(page, { review: review, token: "fw-token", helper: HELPER, notes: opts.notes === true });
  const url = file.indexOf("/") === -1 ? server.urlFor(FIXTURE_DIR + file) : server.urlFor(file);
  await page.goto(url);
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot on " + file
  });
  if (opts.collapseRail !== false) await page.evaluate(() => window.__lahe.rail.collapse(true));
  return review;
}

/** Cmd-Shift-E with the caret at `offset` in `selector` (end when omitted). */
async function openEdit(page, selector, offset) {
  const at =
    typeof offset === "number"
      ? offset
      : await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing() === true, undefined, {
    message: "Cmd-Shift-E to open " + selector
  });
  await caretAt(page, selector, at);
}

/** Put the caret at a character offset inside an element, across its text nodes. */
async function caretAt(page, selector, offset) {
  await page.evaluate(
    ([sel, at]) => {
      const el = typeof sel === "string" ? document.querySelector(sel) : sel;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let left = at;
      let node = walker.nextNode();
      let last = null;
      while (node) {
        last = node;
        if (left <= node.data.length) break;
        left -= node.data.length;
        node = walker.nextNode();
      }
      const range = document.createRange();
      if (node) range.setStart(node, left);
      else if (last) range.setStart(last, last.data.length);
      else range.setStart(el, 0);
      range.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    },
    [selector, offset]
  );
}

/**
 * Save each session block's markup as the engine left it, one JSON line per
 * block, to the running test's output folder (raw-blocks.jsonl). This is the
 * "before cleaning" markup: what the browser's own editing engine built, which
 * cleanBlock has not yet seen (testing review I15). Read every
 * raw-blocks.jsonl under test-results after a run, and add any sample the corpus
 * lacks to test/fixtures/free_writing/corpus.js (ENGINE). A failure to save
 * never fails a test.
 */
async function saveRawBlocks(page) {
  try {
    const blocks = await page.evaluate(() =>
      window.__lahe.handle.editing.sessionElements().map((el) => ({ tag: el.tagName.toLowerCase(), html: el.innerHTML }))
    );
    const info = require("@playwright/test").test.info();
    const file = info.outputPath("raw-blocks.jsonl");
    require("node:fs").appendFileSync(
      file,
      blocks.map((b) => JSON.stringify(Object.assign({ browser: info.project.name }, b))).join("\n") + "\n"
    );
  } catch (err) {
    // Not in a test, or no session open: nothing to save.
  }
}

async function commitByEsc(page) {
  await saveRawBlocks(page);
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "Esc to commit" });
}

/** Select a phrase inside an element and run the bar's bold (or italic). */
async function formatPhrase(page, selector, phrase, command) {
  return page.evaluate(
    ([sel, words, cmd]) => {
      const el = document.querySelector(sel);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node && node.data.indexOf(words) === -1) node = walker.nextNode();
      if (!node) return false;
      const at = node.data.indexOf(words);
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + words.length);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      const got = window.__lahe.handle.editing.format(cmd).applied;
      const after = document.createRange();
      after.setStart(s.focusNode, s.focusOffset);
      after.collapse(true);
      s.removeAllRanges();
      s.addRange(after);
      return got;
    },
    [selector, phrase, command || "bold"]
  );
}

/** Move the caret to the very end of the session's last block. */
async function caretToEndOfSession(page) {
  await page.evaluate(() => {
    const blocks = window.__lahe.handle.editing.sessionElements();
    const host = blocks[blocks.length - 1];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n;
    const range = document.createRange();
    if (last) range.setStart(last, last.data.length);
    else range.setStart(host, 0);
    range.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
}

/**
 * What stands in for Meta+V where Playwright cannot write a rich clipboard
 * (Firefox and WebKit): a paste event carrying both types. Firefox hands a
 * synthetic paste event an empty clipboard, so there the stand-in is the
 * beforeinput insertFromPaste the real paste would send, carrying the same
 * DataTransfer.
 */
async function pasteText(page, text, html) {
  await page.evaluate(
    ([t, h]) => {
      const make = () => {
        const dt = new DataTransfer();
        if (h) dt.setData("text/html", h);
        dt.setData("text/plain", t);
        return dt;
      };
      const node = window.getSelection().focusNode;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: make() });
      if (ev.clipboardData && ev.clipboardData.getData("text/plain") === t) {
        el.dispatchEvent(ev);
        return;
      }
      el.dispatchEvent(
        new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromPaste", dataTransfer: make() })
      );
    },
    [text, html || null]
  );
}

/** The caret's session block and character offset in it, or null when it is outside the session. */
function caretSpot(page) {
  return page.evaluate(() => {
    const els = window.__lahe.handle.editing.sessionElements();
    const s = window.getSelection();
    const i = els.findIndex((el) => el.contains(s.focusNode));
    if (i === -1) return null;
    const r = document.createRange();
    r.selectNodeContents(els[i]);
    r.setEnd(s.focusNode, s.focusOffset);
    return { block: i, offset: r.toString().length };
  });
}

function items(page) {
  return page.evaluate(() => window.__lahe.items());
}

async function onlyEdit(page) {
  const list = (await items(page)).filter((it) => it.kind === "edit" || it.kind === "format_only");
  if (list.length !== 1) throw new Error("expected one edit record, found " + list.length + ": " + JSON.stringify(list));
  return list[0];
}

// The record fields a run fixture pins, ids and times aside.
const RUN_FIELDS = [
  "kind",
  "before",
  "before_html",
  "after",
  "after_html",
  "anchor_after_html",
  "anchor_tag_after",
  "new_blocks",
  "placement",
  "change"
];

function runShape(item) {
  const out = {};
  RUN_FIELDS.forEach((k) => {
    out[k] = item[k] === undefined ? null : item[k];
  });
  return out;
}

/** outerHTML of every page block outside the host's session, for the "untouched" checks. */
function outsideSnapshot(page, selectors) {
  return page.evaluate((sels) => sels.map((s) => document.querySelector(s).outerHTML), selectors);
}

module.exports = {
  caretSpot,
  REPO_ROOT,
  FIXTURE_DIR,
  openFixture,
  openEdit,
  caretAt,
  commitByEsc,
  formatPhrase,
  caretToEndOfSession,
  items,
  onlyEdit,
  runShape,
  RUN_FIELDS,
  outsideSnapshot,
  pasteText
};
