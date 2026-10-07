// REFERENCE ONLY. Not run by any gate.
//
// The script that reproduced the three brief R14 cases (bold and italic edits)
// on a real `lahe review post.md`, first on the Phase 0 base and again on main
// at 2b6eb96. test/browser/free_writing_r14.spec.js is its runnable port onto
// test/helpers. It is kept so a reader can see what the recorded results in
// README.md came from. Cleaned for the repo: no home path, no fixed waits, and
// output goes to the OS temp folder rather than beside this file.
// R14 reproduction: three formatting cases on the real `lahe review post.md` path.
// Read-only against the repo. Every helper, state dir and source file lives under this folder.
"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO = process.env.LAHE_REPO || path.join(__dirname, "..", "..", "..");
const CLI = path.join(REPO, "bin", "lahe.js");
const { chromium } = require(path.join(REPO, "node_modules", "playwright"));
const HERE = __dirname;
const OUT = path.join(require("node:os").tmpdir(), "lahe-r14-reference-out");
fs.mkdirSync(OUT, { recursive: true });

const ORIGINAL = "Runners come back too fast after a layoff.";
const INTRO_P = "main > section:first-of-type > p";
const INTRO_SECTION = "main > section:first-of-type";

function md(introBlocks) {
  return ["# Debugging hell", "", "## Intro", ""]
    .concat(introBlocks.join("\n\n"))
    .concat(["", "## Premise", "", "All those days are gone.", ""])
    .join("\n");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
function labelled(out, label) {
  const m = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(out);
  return m ? m[1] : null;
}
// The original script waited fixed times here. test/browser/free_writing_r14.spec.js polls instead.
const settle = () => Promise.resolve();

async function makeWorld(name, blocks) {
  const root = path.join(require("node:os").tmpdir(), "lahe-r14-reference-worlds", name + "-" + Date.now());
  const stateDir = path.join(root, "state");
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, "post.md");
  fs.writeFileSync(source, md(blocks));
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
  delete env.XDG_STATE_HOME;
  const port = await freePort();
  const w = { name, root, stateDir, source, env, port };
  w.cli = (args) =>
    execFileSync(process.execPath, [CLI].concat(args), { cwd: REPO, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = w.cli(["review", source, "--port", String(port)]);
  fs.writeFileSync(path.join(root, "review-output.txt"), out);
  w.session = labelled(out, "session");
  w.review = labelled(out, "review");
  w.open = labelled(out, "open");
  w.reviewDir = path.join(stateDir, "reviews", w.review);
  return w;
}
async function closeWorld(w) {
  try {
    w.cli(["session", "close", w.session, "--state-dir", w.stateDir]);
  } catch (e) {
    try { w.cli(["session", "close", w.session]); } catch (e2) { /* already down */ }
  }
  // The close leaves the helper up while the page is open; stop it by its own
  // state dir's records so the script leaves nothing running.
  await require(path.join(REPO, "test", "helpers", "temp_helpers.js")).stopTempHelpers(w.stateDir);
}

async function poll(page, fn, arg, what, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch (e) { /* navigation mid-poll */ }
    if (Date.now() - start > timeoutMs) throw new Error("timed out: " + what);
    await settle(); // was a fixed wait; the spec polls a condition
  }
}
async function booted(page) {
  await poll(page, () => !!(window.__lahe && window.__lahe.booted), undefined, "layer boot");
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}
async function claim(page) {
  if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
    await page.evaluate(() => window.__lahe.handle.sync.takeover());
    await poll(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, "takeover");
  }
}
async function caret(page, selector, offset) {
  await page.evaluate(({ selector, offset }) => {
    const el = document.querySelector(selector);
    el.focus && el.focus();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n = w.nextNode();
    while (n) { nodes.push(n); n = w.nextNode(); }
    let t = nodes[0], at = offset;
    if (offset === "end") { t = nodes[nodes.length - 1]; at = t.data.length; }
    const r = document.createRange();
    r.setStart(t, at);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, { selector, offset });
}
async function openEdit(page, selector) {
  await claim(page);
  await caret(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await poll(page, () => window.__lahe.editState().open === true, undefined, "edit state open");
}
async function escCommit(page) {
  await page.keyboard.press("Escape");
  await poll(page, () => window.__lahe.isEditing() === false, undefined, "commit");
}
function selectAll(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n = w.nextNode();
    while (n) { nodes.push(n); n = w.nextNode(); }
    const r = document.createRange();
    r.setStart(nodes[0], 0);
    const last = nodes[nodes.length - 1];
    r.setEnd(last, last.data.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, selector);
}
/** Select a phrase inside the element currently in edit state (or a selector). */
function selectPhrase(page, selector, phrase) {
  return page.evaluate(({ selector, phrase }) => {
    const el = document.querySelector(selector);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n = w.nextNode();
    while (n) {
      const at = n.data.indexOf(phrase);
      if (at !== -1) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + phrase.length);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        return true;
      }
      n = w.nextNode();
    }
    return false;
  }, { selector, phrase });
}
/** Click the edit frame's own B button at its on-screen rectangle. */
async function pressB(page) {
  const rect = await page.evaluate(() => {
    const node = window.__lahe.handle.editing.buttonNode("bold");
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  if (!rect) throw new Error("no B button on screen");
  await page.mouse.click(rect.cx, rect.cy);
}
function items(page) {
  return page.evaluate(() =>
    window.__lahe.items().map((i) => ({
      id: i.id, kind: i.kind, state: i.state, rev: i.rev,
      before: i.before, after: i.after, before_html: i.before_html, after_html: i.after_html,
      change: i.change, handled_not_on_page: i.handled_not_on_page
    }))
  );
}
function reviewJsonItem(w, id) {
  const j = JSON.parse(fs.readFileSync(path.join(w.reviewDir, "review.json"), "utf8"));
  for (const p of j.pages) for (const it of p.items) if (it.id === id) return it;
  return null;
}
async function helperHas(w, id, rev) {
  const start = Date.now();
  for (;;) {
    try {
      const it = reviewJsonItem(w, id);
      if (it && it.rev === rev) return it;
    } catch (e) { /* mid-write */ }
    if (Date.now() - start > 20000) throw new Error("review.json never held " + id);
    await settle(); // was a fixed wait; the spec polls a condition
  }
}
/** Write the .md the way an agent does, then wait for the page to reload itself. */
async function agentWrites(page, w, blocks) {
  let navs = 0;
  const onNav = (f) => { if (f === page.mainFrame()) navs += 1; };
  page.on("framenavigated", onNav);
  const syncState = () => page.evaluate(() => { const st = window.__lahe.handle.sync.status(); return { t: Date.now(), targetMtime: st.targetMtime, reloadPending: st.reloadPending, reloadsFired: st.reloadsFired, reloadChecks: st.reloadChecks, editing: window.__lahe.isEditing(), since: window.__lahe.sinceInteraction && window.__lahe.sinceInteraction() }; }).catch((e) => String(e));
  // A real agent takes seconds to answer. Wait until the page has its mtime baseline,
  // or a write that lands first becomes the baseline and never reloads the page.
  await poll(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, "page mtime baseline", 20000);
  const trace = [await syncState()];
  fs.writeFileSync(w.source, md(blocks));
  trace.push({ wrote: Date.now() });
  const start = Date.now();
  let reloaded = false;
  while (Date.now() - start < 30000) {
    await settle(); // was a fixed wait; the spec polls a condition
    if (navs > 0) { reloaded = true; break; }
    if (trace.length < 12 && (Date.now() - start) % 3000 < 260) trace.push(await syncState());
  }
  page.off("framenavigated", onNav);
  if (reloaded) await page.waitForLoadState("load");
  if (!reloaded) {
    await page.reload();
  }
  await booted(page);
  await poll(page, () => window.__lahe.counters.revertChecks >= 1, undefined, "settle", 20000);
  await page.evaluate(() => window.__lahe.replayNow && window.__lahe.replayNow());
  await settle(); // was a fixed wait; the spec polls a condition
  global.__lastTrace = trace;
  return (reloaded ? "page reloaded itself" : "no self-reload within 30s; reloaded by hand") + " :: " + JSON.stringify(trace);
}
async function reloadAndSettle(page) {
  await page.reload();
  await booted(page);
  await poll(page, () => window.__lahe.counters.revertChecks >= 1, undefined, "settle", 20000);
  await page.evaluate(() => window.__lahe.replayNow && window.__lahe.replayNow());
  await settle(); // was a fixed wait; the spec polls a condition
}
function sectionHtml(page) {
  return page.evaluate((sel) => {
    const s = document.querySelector(sel);
    // Drop the library's own nodes so the snippet is the page.
    const c = s.cloneNode(true);
    c.querySelectorAll("[data-lahe-tool], lahe-overlay").forEach((n) => n.remove());
    return c.innerHTML.replace(/\s+data-lahe-[a-z-]+="[^"]*"/g, "").trim();
  }, INTRO_SECTION);
}
function count(page, text) {
  return page.evaluate((t) => {
    const words = document.querySelector("main").innerText.replace(/\s+/g, " ");
    let c = 0, at = words.indexOf(t);
    while (at !== -1) { c += 1; at = words.indexOf(t, at + 1); }
    return c;
  }, text);
}
async function shot(page, file) {
  const p = path.join(OUT, file);
  await page.locator(INTRO_SECTION).screenshot({ path: p });
  return p;
}
function reply(w, it, extra = []) {
  try {
    return w.cli(["reply", "--review", w.review, "--item", it.id, "--rev", String(it.rev), "--status", "handled",
      "--agent", "r14", "--file", w.source, "--state-dir", w.stateDir].concat(extra)).trim();
  } catch (e) {
    return "EXIT " + e.status + ": " + (e.stdout || "") + (e.stderr || "");
  }
}
async function afterReply(page, w, id) {
  await settle(); // was a fixed wait; the spec polls a condition
  const rj = reviewJsonItem(w, id);
  const drain = w.cli(["status", "--session", w.session, "--json", "--quiet", "--state-dir", w.stateDir]);
  const pageItem = (await items(page)).find((i) => i.id === id);
  return {
    review_json_state: rj && rj.state,
    review_json_handled_not_on_page: rj && rj.handled_not_on_page,
    on_drain: drain.indexOf(id) !== -1,
    page_state: pageItem && pageItem.state
  };
}
function counters(page) {
  return page.evaluate(() => {
    const c = window.LAHE && window.LAHE.replay && window.LAHE.replay.counters;
    return c ? { passes: c.passes, regionsWritten: c.regionsWritten, regionsWroteMissingPiece: c.regionsWroteMissingPiece,
      regionsRefusedDuplicate: c.regionsRefusedDuplicate, regionsConflicted: c.regionsConflicted,
      regionsSkippedEqual: c.regionsSkippedEqual, regionsLost: c.regionsLost,
      flagged: window.__lahe.flaggedIds ? window.__lahe.flaggedIds() : null } : null;
  });
}

// ---------------------------------------------------------------- case 1
async function case1(browser, variant) {
  const P1 = "First new paragraph has a bold word in it.";
  const P2 = "Second new paragraph is plain.";
  const w = await makeWorld("case1" + variant, [ORIGINAL]);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const r = { variant };
  try {
    await page.goto(w.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    await selectAll(page, INTRO_P);
    if (variant === "bold-in-first") {
      await page.keyboard.type(P1, { delay: 2 });
      await selectPhrase(page, INTRO_P, "bold");
      await pressB(page);
      await caret(page, INTRO_P, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(P2, { delay: 2 });
    } else {
      await page.keyboard.type(P2, { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type(P1, { delay: 2 });
      await selectPhrase(page, INTRO_P, "bold");
      await pressB(page);
      await caret(page, INTRO_P, "end");
    }
    r.page_while_editing = await sectionHtml(page);
    await escCommit(page);
    const it = (await items(page)).find((i) => i.kind === "edit");
    r.record = it;
    const rj = await helperHas(w, it.id, it.rev);
    r.review_json = { after_full: rj.after_full, after_html: rj.after_html, change: rj.change };
    r.before_rebuild = await sectionHtml(page);
    r.shot_before = await shot(page, "case1-" + variant + "-before.png");
    // The agent places only one of the two new paragraphs: the plain one.
    const placed = variant === "bold-in-first" ? [ORIGINAL, P2] : [P2];
    r.agent_md_intro = placed;
    r.reload = await agentWrites(page, w, placed);
    r.after_rebuild = await sectionHtml(page);
    r.replay_counters = await counters(page);
    r.shot_after = await shot(page, "case1-" + variant + "-after.png");
    r.bold_on_page = await page.evaluate((sel) => !!document.querySelector(sel + " strong"), INTRO_SECTION);
  } catch (e) {
    r.error = String(e && e.stack || e);
  } finally {
    await page.close();
    await closeWorld(w);
  }
  r.world = w.root;
  return r;
}

// ---------------------------------------------------------------- case 2
async function case2(browser, leave) {
  const LINE = "A new line";
  const w = await makeWorld("case2" + leave, [ORIGINAL]);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const H2 = "main > section:first-of-type h2";
  const r = { leave };
  try {
    await page.goto(w.open);
    await booted(page);
    r.initial = await sectionHtml(page);
    await openEdit(page, H2);
    await caret(page, H2, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type(LINE, { delay: 5 });
    r.page_while_editing = await sectionHtml(page);
    r.shot_editing = await shot(page, "case2-" + leave + "-editing.png");
    if (leave === "click") {
      // Leave the editor by clicking on the next section's paragraph.
      const box = await page.locator("main > section:nth-of-type(2) > p").boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      await poll(page, () => window.__lahe.isEditing() === false, undefined, "commit by clicking out");
    } else {
      await escCommit(page);
    }
    await settle(); // was a fixed wait; the spec polls a condition
    const all = await items(page);
    r.items = all;
    const it = all.find((i) => i.kind === "edit") || all[0];
    const rj = it ? await helperHas(w, it.id, it.rev) : null;
    r.review_json = rj && { kind: rj.kind, before: rj.before, after: rj.after, after_full: rj.after_full,
      after_html: rj.after_html, change: rj.change, region: rj.region };
    r.before_rebuild = await sectionHtml(page);
    r.count_before = await count(page, LINE);
    r.shot_before = await shot(page, "case2-" + leave + "-before-rebuild.png");
    // A correct agent: the new line as its own paragraph under the header.
    r.reload = await agentWrites(page, w, [LINE, ORIGINAL]);
    r.after_rebuild = await sectionHtml(page);
    r.count_after = await count(page, LINE);
    r.h2_text_after = await page.evaluate((s) => document.querySelector(s).innerText, H2);
    r.replay_counters = await counters(page);
    r.flagged = await page.evaluate(() => window.__lahe.flaggedIds ? window.__lahe.flaggedIds() : null);
    r.shot_after = await shot(page, "case2-" + leave + "-after-rebuild.png");
    if (it) {
      r.reply = reply(w, it);
      r.after_reply = await afterReply(page, w, it.id);
    }
    await reloadAndSettle(page);
    r.after_second_reload = await sectionHtml(page);
    r.count_after_second_reload = await count(page, LINE);
    r.shot_after2 = await shot(page, "case2-" + leave + "-after-reply-reload.png");
  } catch (e) {
    r.error = String(e && e.stack || e);
  } finally {
    await page.close();
    await closeWorld(w);
  }
  r.world = w.root;
  return r;
}

// ---------------------------------------------------------------- case 3
async function case3(browser, agentDoes) {
  const w = await makeWorld("case3" + agentDoes, [ORIGINAL]);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const r = { agentDoes };
  try {
    await page.goto(w.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    const sel = await selectPhrase(page, INTRO_P, "too fast");
    if (!sel) throw new Error("could not select");
    await pressB(page);
    r.page_while_editing = await sectionHtml(page);
    await escCommit(page);
    await settle(); // was a fixed wait; the spec polls a condition
    const all = await items(page);
    r.items = all;
    const it = all[0];
    const rj = await helperHas(w, it.id, it.rev);
    r.review_json = { kind: rj.kind, before: rj.before, after: rj.after, after_full: rj.after_full,
      before_html: rj.before_html, after_html: rj.after_html, change: rj.change };
    r.before_rebuild = await sectionHtml(page);
    r.shot_before = await shot(page, "case3-" + agentDoes + "-before.png");
    if (agentDoes === "wraps") {
      r.reload = await agentWrites(page, w, ["Runners come back **too fast** after a layoff."]);
      r.after_rebuild = await sectionHtml(page);
      r.shot_after = await shot(page, "case3-" + agentDoes + "-after-rebuild.png");
    }
    r.reply = reply(w, it);
    r.after_reply = await afterReply(page, w, it.id);
    await reloadAndSettle(page);
    r.after_reply_reload = await sectionHtml(page);
    r.bold_on_page = await page.evaluate((s) => !!document.querySelector(s + " strong"), INTRO_P);
    r.replay_counters = await counters(page);
    r.shot_after_reply = await shot(page, "case3-" + agentDoes + "-after-reply-reload.png");
    r.md_on_disk = fs.readFileSync(w.source, "utf8").split("\n")[4];
  } catch (e) {
    r.error = String(e && e.stack || e);
  } finally {
    await page.close();
    await closeWorld(w);
  }
  r.world = w.root;
  return r;
}

if (require.main === module) (async () => {
  const which = process.argv[2] || "all";
  const browser = await chromium.launch();
  const results = {};
  try {
    if (which === "all" || which === "1") {
      results.case1a = await case1(browser, "bold-in-first");
      results.case1b = await case1(browser, "bold-in-second");
    }
    if (which === "all" || which === "2") {
      results.case2_click = await case2(browser, "click");
      results.case2_esc = await case2(browser, "escape");
    }
    if (which === "all" || which === "3") {
      results.case3_wraps = await case3(browser, "wraps");
      results.case3_nothing = await case3(browser, "nothing");
    }
  } finally {
    await browser.close();
  }
  const file = path.join(OUT, "results-" + which + ".json");
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})();

module.exports = { chromium, md, makeWorld, closeWorld, booted, openEdit, selectPhrase, pressB, escCommit, INTRO_P, items, sectionHtml };
