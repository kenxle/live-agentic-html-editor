// Choice buttons, the kernel half (docs/features/20261013.01_choice_buttons,
// plan Step 1).
//
// The record and its checker at the helper's door and in the projection (V18),
// the lifecycle helpers that need no change (Task 1.1), the drain line and the
// export text (V9), the page check standing down (V13), the merge rule (V19),
// the gesture rule (V1 and V8, unit halves), and the tag's document mark.
//
// Node-only. Every helper a test starts is closed through t.after.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const record = require("../../src/shared/record.js");
const merge = require("../../src/shared/merge.js");
const gestures = require("../../src/shared/gestures.js");
const protocol = require("../../src/shared/protocol.js");
const failures = require("../../src/shared/failures.js");
const reviewFormat = require("../../src/shared/review_format.js");
const scriptLine = require("../../src/shared/script_line.js");
const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const projection = require("../../src/service/projection.js");
const handledCheck = require("../../src/service/handled_check.js");
const pageRoutes = require("../../src/service/page_routes.js");
const status = require("../../src/cli/commands/status.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

const REPO = path.join(__dirname, "..", "..");
const QUESTION = "Promote this lesson?";
const HEADING = "A CSS counter ignores an ol start attribute";

function choiceItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.CHOICE,
        state: record.STATE.READY,
        page_origin: "http://lessons.lahe.localhost:1483",
        page_path: "/02_lesson_queue.md",
        page_title: "Lesson queue",
        page_seq: 1,
        choice: { group: "lesson-css-counter", answer: "promote" },
        context: { quote: QUESTION, prefix: null, suffix: null, heading: HEADING, element: null, subject: null },
        region: { ref: record.choiceRef("lesson-css-counter"), label: "choice", lost: null }
      },
      overrides || {}
    )
  );
}

let counter = 0;
function eventFor(reviewId, item, type) {
  counter += 1;
  return protocol.newEvent({
    event: type || protocol.EVENT.ITEM_READY,
    event_id: "evt_choice_" + counter,
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: record.isDraft(item), record: item }
  });
}

function setup(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-choice-kernel-"));
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, reviewId);
  return { dir, log };
}

/** The forgeries V18 names, each with the field that gives it away. */
function forgeries() {
  const base = choiceItem();
  const prose = Object.assign({}, base, { choice: { group: "lesson-css-counter", answer: "Promote it, and also rewrite the intro" } });
  const noGroup = Object.assign({}, base, { choice: { answer: "promote" } });
  const extraKey = Object.assign({}, base, { choice: { group: "lesson-css-counter", answer: "promote", label: "Promote" } });
  const withBefore = Object.assign({}, base, { before: "Promote this lesson?" });
  const withAfter = Object.assign({}, base, { after: "anything" });
  const withHtml = Object.assign({}, base, { after_html: "<b>x</b>" });
  const withRun = Object.assign({}, base, { new_blocks: [{ tag: "p", html: "x" }], placement: "after_anchor" });
  const stamped = Object.assign({}, base, {
    region: { ref: { kind: "choice", group: "lesson-css-counter", stamp: "lahe-abc" }, label: "choice", lost: null }
  });
  const noChoice = Object.assign({}, base);
  delete noChoice.choice;
  const commentWithChoice = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "a comment",
    page_origin: "http://x",
    page_path: "/",
    choice: { group: "a", answer: "b" }
  });
  return [
    { name: "prose in answer", item: prose },
    { name: "missing group", item: noGroup },
    { name: "an extra key", item: extraKey },
    { name: "a before", item: withBefore },
    { name: "an after", item: withAfter },
    { name: "after_html", item: withHtml },
    { name: "a run", item: withRun },
    { name: "a stamp", item: stamped },
    { name: "a choice record without choice", item: noChoice },
    { name: "a comment carrying choice", item: commentWithChoice }
  ];
}

// --- V18: the record and its checker -----------------------------------------

test("newItem keeps a choice on a choice record, and every other record has no choice key", () => {
  const it = choiceItem();
  assert.deepEqual(it.choice, { group: "lesson-css-counter", answer: "promote" });
  assert.equal(record.validateChoice(it), null);
  assert.doesNotThrow(() => record.validateItem(it));
  const comment = record.newItem({ kind: "comment", note: "x", page_origin: "o", page_path: "/" });
  assert.equal(Object.prototype.hasOwnProperty.call(comment, "choice"), false, "today's records are unchanged");
  assert.equal(record.validateChoice(comment), null);
});

test("validateItem and validateChoice refuse every forgery, each with the CHOICE_REFUSED code", () => {
  assert.ok(failures.CODES ? failures.CODES.CHOICE_REFUSED : failures.CHOICE_REFUSED, "the code is in the failure table");
  forgeries().forEach((f) => {
    const refusal = record.validateChoice(f.item);
    assert.ok(refusal, f.name + " is refused");
    assert.equal(refusal.code, "CHOICE_REFUSED", f.name);
    assert.equal(typeof refusal.reason, "string");
    assert.throws(() => record.validateItem(f.item), /choice/, f.name + ": validateItem throws");
  });
});

test("the grammar is bounded: 1 to 64 letters, digits, hyphens, underscores, dots or colons, starting with a letter or digit", () => {
  // Agents name answers after the keys they already hold (A_jev, optionB,
  // v1.2, step:3), so case and the usual key punctuation are accepted as
  // written. No space, quote or bracket: still never a sentence, and still
  // safe inside a quoted attribute selector.
  ["a", "promote", "lesson-css-counter", "9", "A", "A_jev", "optionB", "v1.2", "step:3", "a".repeat(64)].forEach((v) =>
    assert.equal(record.isChoiceToken(v), true, v)
  );
  ["", "-a", "_a", ".a", "has space", "a".repeat(65), "<b>", 'a"b', "a\\b", "a/b", "a\nb", null, 3].forEach((v) =>
    assert.equal(record.isChoiceToken(v), false, String(v))
  );
});

test("the helper's door refuses each forgery, reports it, and stores nothing", () => {
  forgeries().forEach((f, i) => {
    const reviewId = "rchoicedoor" + i;
    const { log } = setup(reviewId);
    const event = eventFor(reviewId, f.item);
    const result = log.append(reviewId, [event]);
    assert.deepEqual(result.accepted, [], f.name);
    assert.equal(result.rejected.length, 1, f.name);
    assert.equal(result.rejected[0].code, "CHOICE_REFUSED", f.name);
    assert.equal(result.rejected[0].event_id, event.event_id);
    assert.deepEqual(log.read(reviewId), [], f.name + ": events.jsonl holds nothing");
  });
});

test("a valid choice passes the door and projects", () => {
  const reviewId = "rchoicedoorok";
  const { log } = setup(reviewId);
  const it = choiceItem();
  const result = log.append(reviewId, [eventFor(reviewId, it)]);
  assert.equal(result.accepted.length, 1);
  const projected = projection.project(reviewId, log.read(reviewId));
  const items = projected.pages.reduce((out, p) => out.concat(p.items), []);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].choice, { group: "lesson-css-counter", answer: "promote" });
});

test("a press named as an agent wrote its keys (Closest_21, A_jev) passes the door, projects and drains unchanged", () => {
  const reviewId = "rchoicedoorkeys";
  const { log } = setup(reviewId);
  const press = { group: "Closest_21", answer: "A_jev" };
  const it = choiceItem({ choice: press, region: { ref: record.choiceRef(press.group), label: "choice", lost: null } });
  assert.equal(record.validateChoice(it), null);
  const result = log.append(reviewId, [eventFor(reviewId, it)]);
  assert.equal(result.accepted.length, 1);
  const projected = projection.project(reviewId, log.read(reviewId));
  const items = projected.pages.reduce((out, p) => out.concat(p.items), []);
  assert.deepEqual(items[0].choice, press);
  const line = status.drainLine({ review: reviewId, page: { path: it.page_path } }, reviewFormat.projectItem(it), true);
  assert.deepEqual(line.choice, press, "the agent reads its own key back, not a rewritten one");
});

test("the projection refuses the same forgeries from a hand-edited log, and reports each drop", () => {
  forgeries().forEach((f) => {
    const dropped = [];
    const projected = projection.project("rhand", [Object.assign(eventFor("rhand", f.item), { seq: 1 })], {
      onDropped: (event, reason) => dropped.push(reason)
    });
    const items = projected.pages.reduce((out, p) => out.concat(p.items), []);
    assert.equal(items.length, 0, f.name + ": nothing projected");
    assert.equal(dropped.length, 1, f.name + ": the drop is reported");
    assert.match(dropped[0], /^CHOICE_REFUSED: /, f.name);
  });
});

test("isHandEdit, isReplayable and isOutstanding need no change for a choice", () => {
  const ready = choiceItem();
  assert.equal(record.isHandEdit(ready), false, "a press is not a hand edit");
  assert.equal(record.isReplayable(ready), true, "a ready press is replayed, so replay can paint its state");
  assert.equal(record.isOutstanding(ready), true);
  const notHandled = Object.assign({}, ready, { state: record.STATE.NOT_HANDLED });
  assert.equal(record.isReplayable(notHandled), false);
  assert.equal(record.isOutstanding(notHandled), true);
  const handled = Object.assign({}, ready, { state: record.STATE.HANDLED });
  assert.equal(record.isReplayable(handled), false);
  assert.equal(record.isOutstanding(handled), false);
  assert.equal(record.isUnansweredReady(ready), true, "a press is on the drain like any ready item");
});

test("a reword keeps the choice record valid at the next revision, and a follow-up keeps the press", () => {
  const first = choiceItem();
  const reworded = record.bumpRev(first, { choice: { group: "lesson-css-counter", answer: "discard" } });
  assert.equal(reworded.rev, 2);
  assert.equal(record.validateChoice(reworded), null);
  assert.deepEqual(reworded.after_history, [], "a press never grows an after history");
  const asked = Object.assign({}, reworded, { reply: { status: "question", text: "why?", at: "2026-10-17T00:00:00Z" } });
  const followed = record.followUp(asked, "Because the fix is in both stylesheets.");
  assert.equal(followed.rev, 3);
  assert.equal(followed.note, "Because the fix is in both stylesheets.");
  assert.deepEqual(followed.choice, { group: "lesson-css-counter", answer: "discard" }, "the answer is unchanged");
  assert.equal(record.validateChoice(followed), null);
});

// --- V9: the drain line and the export text ----------------------------------

test("the field classes name choice.group and choice.answer as intent, and only on a choice does the key appear", () => {
  assert.equal(reviewFormat.PROJECTED_FIELD_CLASS["choice.group"], record.CLASS_INSTRUCTION);
  assert.equal(reviewFormat.PROJECTED_FIELD_CLASS["choice.answer"], record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass("choice.group"), record.CLASS_INSTRUCTION);
  const comment = record.newItem({ kind: "comment", state: "ready", note: "x", page_origin: "o", page_path: "/" });
  assert.equal(Object.prototype.hasOwnProperty.call(reviewFormat.projectItem(comment), "choice"), false);
});

test("projectItem leaves before, after_full, html, region_label, subject and the region null for a choice", () => {
  const out = reviewFormat.projectItem(choiceItem());
  assert.deepEqual(out.choice, { group: "lesson-css-counter", answer: "promote" });
  assert.equal(out.quote, QUESTION);
  assert.equal(out.context.heading, HEADING);
  ["before", "after_full", "before_html", "after_html", "region_label", "subject", "region"].forEach((k) =>
    assert.equal(out[k], null, k)
  );
  assert.deepEqual(out.after_history, []);
});

test("the drain line for a choice: choice at the top, only path, quote and context.heading under page", () => {
  const it = choiceItem();
  const line = status.drainLine({ review: "rlessons", page: { path: it.page_path } }, reviewFormat.projectItem(it), true);
  assert.deepEqual(line.choice, { group: "lesson-css-counter", answer: "promote" });
  assert.deepEqual(line.page, { path: "/02_lesson_queue.md", quote: QUESTION, context: { heading: HEADING } });
  // The architecture's line, plus reviewer_last_changed_at, which every drain
  // line carries (spec 20260923.02 R1).
  assert.deepEqual(Object.keys(line).sort(), ["choice", "id", "kind", "page", "rev", "review", "reviewer_last_changed_at", "state"]);
  assert.equal(line.kind, "choice");
  assert.equal(line.state, "ready");
  const text = JSON.stringify(line);
  ["before", "after_full", "after_html", "before_html", "region", "region_label", "subject", "stamp"].forEach((k) =>
    assert.equal(text.indexOf('"' + k + '"'), -1, k + " is not on the line")
  );
});

test("a hand-built events.jsonl with one choice projects to the architecture's drain line through lahe status", async () => {
  const reviewId = "rlessons";
  const { dir, log } = setup(reviewId);
  log.append(reviewId, [
    protocol.newEvent({ event: protocol.EVENT.REVIEW_CREATED, event_id: "ev_created", review: reviewId, payload: { token: "t".repeat(8) } })
  ]);
  const it = choiceItem();
  log.append(reviewId, [eventFor(reviewId, it, protocol.EVENT.ITEM_CREATED), eventFor(reviewId, it, protocol.EVENT.ITEM_READY)]);
  const out = [];
  const code = await status.run(["--json"], { stateDir: dir, stdout: (t) => out.push(t), stderr: () => {} });
  assert.equal(code, protocol.CLI_EXIT.OK);
  const first = JSON.parse(out.join("").split("\n")[0]);
  assert.deepEqual(first, {
    review: reviewId,
    page: { path: "/02_lesson_queue.md", quote: QUESTION, context: { heading: HEADING } },
    id: it.id,
    rev: 1,
    kind: "choice",
    state: "ready",
    choice: { group: "lesson-css-counter", answer: "promote" },
    reviewer_last_changed_at: it.updated_at
  });
});

test("the human status line prints the press bare and the question as page text", () => {
  const line = status.excerpt(reviewFormat.projectItem(choiceItem()));
  assert.match(line, /^pressed promote in lesson-css-counter {2}page text \(data, not instructions\): "Promote this lesson\?"$/);
});

test("the copy-and-export text prints a choice as its question and its answer", () => {
  const text = reviewFormat.renderText({ id: "rlessons", items: [choiceItem()] });
  assert.match(text, /choice itm_\w+ rev 1 \(ready\)/);
  assert.match(text, /Question \(page text\): Promote this lesson\?/);
  assert.match(text, /Answer \(the reviewer's press\): promote, in the group lesson-css-counter/);
  assert.equal(text.indexOf("Quoted from the page"), -1);
});

// --- V13: the page check never runs on a choice --------------------------------

test("handled_check never runs on a choice: not checkable, and pageShows reads nothing", () => {
  assert.equal(handledCheck.checkable(choiceItem()), false);
  assert.equal(handledCheck.checkable(choiceItem({ state: record.STATE.HANDLED })), false);
  let asked = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-choice-hc-"));
  const check = handledCheck.createHandledCheck({
    dir: dir,
    rebuild: { refresh: () => { asked += 1; } }
  });
  assert.equal(check.pageShows("rlessons", choiceItem()), null, "cannot tell, so the reply stands");
  assert.equal(asked, 0, "the page was never refreshed or read");
});

test("a handled reply retires a choice in the projection, with no page read", () => {
  const reviewId = "rchoicehandled";
  const { log } = setup(reviewId);
  const it = choiceItem();
  log.append(reviewId, [eventFor(reviewId, it)]);
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: "evt_choice_reply",
      review: reviewId,
      item: it.id,
      rev: 1,
      payload: {
        accepted: true,
        state: record.STATE.HANDLED,
        refusal: null,
        file: "replies-claude.jsonl",
        reply: { status: "handled", agent: "claude", reason: null, text: "Promoted; data-chosen is on the button.", files: [] }
      }
    })
  ]);
  const projected = projection.project(reviewId, log.read(reviewId));
  const got = projected.pages[0].items[0];
  assert.equal(got.state, "handled");
  assert.equal(got.handled_not_on_page, false);
  assert.equal(record.isUnansweredReady(Object.assign({}, it, { state: "handled" })), false);
});

// --- V19: the merge rule -------------------------------------------------------

test("an offline re-press (rev 2 in the browser, rev 1 handled in the store) merges to rev 2 ready", () => {
  const store = choiceItem({ state: record.STATE.HANDLED, reply: { status: "handled", at: "2026-10-17T00:00:00Z" } });
  const browser = Object.assign(record.bumpRev(choiceItem({ id: store.id }), { choice: { group: "lesson-css-counter", answer: "discard" } }), {
    state: record.STATE.READY,
    acknowledged: false
  });
  const merged = merge.mergeItem(browser, store);
  assert.equal(merged.item.rev, 2);
  assert.equal(merged.item.state, "ready");
  assert.deepEqual(merged.item.choice, { group: "lesson-css-counter", answer: "discard" });
});

test("choice is a browser-owned content field: an unacknowledged press wins at the same revision", () => {
  assert.ok(merge.CONTENT_FIELDS.indexOf("choice") !== -1);
  const store = choiceItem();
  const browser = Object.assign({}, store, { choice: { group: "lesson-css-counter", answer: "merge" }, acknowledged: false });
  const merged = merge.mergeItem(browser, store);
  assert.deepEqual(merged.item.choice, { group: "lesson-css-counter", answer: "merge" });
  // A comment, which has no choice, stays without the key after a merge.
  const comment = record.newItem({ kind: "comment", state: "ready", note: "x", page_origin: "o", page_path: "/", id: "itm_c" });
  const cm = merge.mergeItem(Object.assign({}, comment, { acknowledged: false }), comment);
  assert.equal(Object.prototype.hasOwnProperty.call(cm.item, "choice"), false);
});

// --- V1 and V8, unit halves: the gesture rule ------------------------------------

function press(overrides) {
  return gestures.gestureFor(
    Object.assign({ type: "click", inArmedChoice: true, documentPage: true, mayWrite: true }, overrides || {})
  );
}

test("a click on an armed button on a document page, in browse, is a press, and it prevents the default", () => {
  const g = press();
  assert.equal(g.gesture, gestures.GESTURE.PRESS_CHOICE);
  assert.equal(g.passThrough, false);
  assert.equal(g.preventDefault, true, "so a group inside a form submits nothing");
});

test("V8: pick mode, an open edit, edit state, a read-only window and present mode each refuse the press", () => {
  assert.equal(press({ pickMode: true }).gesture, gestures.GESTURE.PICK_ELEMENT);
  assert.equal(press({ editing: true, inEditedBlock: false }).gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(press({ editing: true, inEditedBlock: true }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(press({ editState: true }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(press({ mayWrite: false }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(press({ mayWrite: undefined }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(press({ presenting: true }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(press({ inOverlay: true }).gesture, gestures.GESTURE.NONE);
  [{ editState: true }, { mayWrite: false }, { presenting: true }].forEach((o) => {
    const g = press(o);
    assert.equal(g.passThrough, true);
    assert.equal(g.preventDefault, false);
  });
});

test("V1: off a document page, or on a button outside an armed group, the click is the page's own", () => {
  const offDocument = press({ documentPage: false });
  assert.equal(offDocument.gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(offDocument.passThrough, true);
  assert.equal(offDocument.preventDefault, false);
  assert.equal(press({ inArmedChoice: false }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(gestures.gestureFor({ type: "click" }).gesture, gestures.GESTURE.PAGE_DEFAULT);
  // A keydown or a pointerdown is never a press: Enter and Space on a focused
  // button arrive as the button's own click.
  assert.notEqual(press({ type: "keydown", key: "Enter" }).gesture, gestures.GESTURE.PRESS_CHOICE);
  assert.notEqual(press({ type: "pointerdown" }).gesture, gestures.GESTURE.PRESS_CHOICE);
});

test("V1: PRESS_CHOICE has no hint row, so a page with no groups shows the same rail hints as before", () => {
  assert.equal(gestures.hintFor(gestures.GESTURE.PRESS_CHOICE), null);
  assert.equal(gestures.TABLE.some((row) => row.gesture === gestures.GESTURE.PRESS_CHOICE), false);
  // The rail's hint list, pinned on purpose: eleven lines, none of them about
  // choices. A new row here is a new line on every page's rail.
  assert.equal(gestures.hintLines().length, 11);
  assert.equal(gestures.panelLines().length, 9);
  assert.equal(gestures.hintLines().some((line) => /choice/i.test(line.hint)), false);
});

// --- the tag's document mark ----------------------------------------------------

test("scriptTag writes data-lahe-document only when asked, and add's tag finder still matches it", () => {
  const plain = protocol.scriptTag({ src: "/x.js", review: "rev_a", token: "tok" });
  assert.equal(plain.indexOf(protocol.SCRIPT_ATTR.DOCUMENT), -1);
  const doc = protocol.scriptTag({ src: "/x.js", review: "rev_a", token: "tok", document: true });
  assert.match(doc, /data-lahe-document="true"/);
  assert.equal(protocol.DOCUMENT_ON, "true");
  const page = "<html><body><p>x</p></body></html>";
  const placed = scriptLine.placeScriptLine(page, doc).html;
  assert.equal(scriptLine.reviewAlreadyInFile(placed), "rev_a");
  assert.equal(scriptLine.removeScriptLine(placed).html, page);
});

test("add.js and heal.js never pass the document opt-in; page_routes passes it", () => {
  const add = fs.readFileSync(path.join(REPO, "src", "cli", "commands", "add.js"), "utf8");
  const heal = fs.readFileSync(path.join(REPO, "src", "service", "heal.js"), "utf8");
  const routes = fs.readFileSync(path.join(REPO, "src", "service", "page_routes.js"), "utf8");
  [add, heal].forEach((src) => {
    assert.equal(/document:\s*true/.test(src), false);
    assert.equal(src.indexOf("SCRIPT_ATTR.DOCUMENT"), -1);
  });
  assert.match(routes, /document:\s*true/);
});

test("markServedAsDocument adds the mark to this review's tag once, and leaves a marked tag alone", () => {
  const tag = protocol.scriptTag({ src: "/x.js", review: "rev_a", token: "tok" });
  const html = scriptLine.placeScriptLine("<html><body><p>x</p></body></html>", tag).html;
  const marked = pageRoutes.markServedAsDocument(html);
  assert.match(marked, /<script data-lahe-document="true" src="\/x\.js"/);
  assert.equal((marked.match(/data-lahe-document/g) || []).length, 1);
  assert.equal(pageRoutes.markServedAsDocument(marked), null);
  assert.equal(pageRoutes.markServedAsDocument("<html><body></body></html>"), null);
});

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>words</p></body></html>";

async function site(t, files, entry) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  Object.keys(files).forEach((rel) => writeFile(folder, rel, files[rel]));
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: entry || Object.keys(files)[0] });
  return Object.assign(w, { folder: fs.realpathSync(folder), name: bound.name });
}

function review(w, spec) {
  return w.helper.reviews.create(Object.assign({ agent_session_id: "s1", origins: ["null"] }, spec));
}

test("a page the helper serves itself carries the document mark: an HTML page and a rendered Markdown page", async (t) => {
  const w = await site(t, { "page.html": PAGE, "doc.md": "# Title\n\nWords.\n" });
  review(w, { target_path: w.folder });
  const html = (await getPage(w, w.name, "/page.html")).text;
  assert.equal((html.match(/data-lahe-document="true"/g) || []).length, 1);
  const md = (await getPage(w, w.name, "/doc.md")).text;
  assert.equal((md.match(/data-lahe-document="true"/g) || []).length, 1);
});

test("a file already carrying this review's tag is served with the mark, and the file on disk never gets it", async (t) => {
  const w = await site(t, { "page.html": PAGE });
  const r = review(w, { target_path: path.join(w.folder, "page.html") });
  const tag = protocol.scriptTag({ src: "/x.js", review: r.id, token: r.token });
  const onDisk = scriptLine.placeScriptLine(PAGE, tag).html;
  fs.writeFileSync(path.join(w.folder, "page.html"), onDisk);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal((res.text.match(/data-lahe-review=/g) || []).length, 1);
  assert.equal((res.text.match(/data-lahe-document="true"/g) || []).length, 1);
  assert.equal(fs.readFileSync(path.join(w.folder, "page.html"), "utf8"), onDisk, "nothing written to disk");
});

test("a page carrying another review's tag is served as it is, with no mark", async (t) => {
  const w = await site(t, { "page.html": PAGE });
  review(w, { target_path: path.join(w.folder, "page.html") });
  const tag = protocol.scriptTag({ src: "/x.js", review: "someone-else", token: "t" });
  fs.writeFileSync(path.join(w.folder, "page.html"), scriptLine.placeScriptLine(PAGE, tag).html);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal(res.text.indexOf("data-lahe-document"), -1);
});
