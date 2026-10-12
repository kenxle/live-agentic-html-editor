// Capture the real rail, in several states, as plain HTML a reviewer can
// comment on with LAHE itself.
//
// The rail lives in a closed shadow root, so LAHE cannot review its own rail.
// This boots the real built bundle on the app fixture, drives real gestures
// into each state, then copies the rail's markup and stylesheet out into
// ordinary page DOM. The copy is scoped with @scope so its styles do not leak.
//
// Run from the repo root:
//   npx playwright test --config docs/features/20261012.01_rail_cleanup/capture/capture.config.js
//
// Writes ../rail_mockup.html beside this folder.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..", "..", "..", "..");
const { test, expect, pollPage, placeCaret, startService, SERVICE_ENTRY } = require(path.join(REPO, "test", "helpers"));
const { startAppServer } = require(path.join(REPO, "test", "fixtures", "app", "server"));

const REVIEW = "rail-mockup";
const OUT = path.join(__dirname, "..", "rail_mockup.html");

// Every shadow root opens, so the copy can reach the nested ones too.
const OPEN_SHADOWS = `
  (function () {
    var real = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return real.call(this, Object.assign({}, init, { mode: "open" }));
    };
  })();
`;

async function selectAll(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

async function commentOn(page, selector, text) {
  const before = await page.evaluate(() => window.__lahe.items().filter((i) => i.state === "ready").length);
  await selectAll(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, { message: "comment box" });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, (n) => window.__lahe.items().filter((i) => i.state === "ready").length > n, before, {
    message: "comment ready"
  });
  const items = await page.evaluate(() => window.__lahe.items());
  return items.filter((i) => i.state === "ready").slice(-1)[0];
}

async function draftOn(page, selector, text) {
  await selectAll(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, { message: "comment box" });
  await page.keyboard.type(text);
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "draft"), undefined, {
    message: "draft"
  });
}

async function editAppend(page, selector, text) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open, undefined, { message: "edit state" });
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.editState().open === false, undefined, { message: "edit commit" });
}

// The real agent path: one reply line, folded by the helper and delivered by
// the poll loop, so every tab hears about it the way it does in a review.
async function fold(page, helper, item, reply) {
  const dir = path.join(helper.stateDir, "reviews", REVIEW);
  for (let i = 0; i < 200; i += 1) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8"));
      if (p.pages.some((pg) => pg.items.some((it) => it.id === item.id))) break;
    } catch (err) {
      // not written yet
    }
    await page.waitForTimeout(50);
  }
  fs.appendFileSync(
    path.join(dir, "replies-claude.jsonl"),
    JSON.stringify(Object.assign({ item: item.id, rev: item.rev }, reply)) + "\n"
  );
  await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, { message: "reply folded" });
}

// Runs in the page. Copies the rail's shadow tree out as light-DOM HTML, plus
// its CSS split into what may sit inside @scope and what may not.
function snapshotInPage(only) {
  const tabBody = window.__lahe.rail.tabBody("active");
  const root = tabBody.getRootNode();
  const host = root.host;
  const css = [];
  const outside = [];
  const seen = new Set();

  function takeSheet(sheet) {
    if (!sheet || seen.has(sheet)) return;
    seen.add(sheet);
    for (const rule of sheet.cssRules) {
      const text = rule.cssText;
      if (/^@(keyframes|font-face|property|import)/.test(text)) outside.push(text);
      else css.push(text);
    }
  }

  const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attrEsc(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }
  function attrs(el) {
    let out = "";
    for (const a of el.attributes) {
      if (a.name === "contenteditable" || a.name === "tabindex" || a.name === "id") continue;
      out += " " + a.name.replace(/^data-lahe-/, "data-mock-") + '="' + attrEsc(a.value) + '"';
    }
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.value && !el.hasAttribute("value")) {
      out += ' value="' + attrEsc(el.value) + '"';
    }
    return out;
  }
  function kids(node) {
    let out = "";
    for (const child of node.childNodes) out += ser(child);
    return out;
  }
  function ser(node) {
    if (node.nodeType === 3) return esc(node.nodeValue);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "style") {
      takeSheet(node.sheet);
      return "";
    }
    if (tag === "script") return "";
    let inner;
    if (node.shadowRoot) {
      for (const s of node.shadowRoot.adoptedStyleSheets || []) takeSheet(s);
      inner = kids(node.shadowRoot);
    } else if (tag === "textarea") {
      inner = esc(node.value || "");
    } else {
      inner = kids(node);
    }
    if (VOID.has(tag)) return "<" + tag + attrs(node) + ">";
    return "<" + tag + attrs(node) + ">" + inner + "</" + tag + ">";
  }

  for (const s of root.adoptedStyleSheets || []) takeSheet(s);
  root.querySelectorAll("style").forEach((st) => takeSheet(st.sheet));
  const html = only ? ser(root.querySelector(only)) : kids(root);
  const hostAttrs = attrs(host);
  return { html, css, outside, hostAttrs };
}

test("capture the rail as a reviewable mockup", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(OPEN_SHADOWS);

  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
    reviews: [REVIEW],
    allowedOrigins: [app.origin]
  });
  const shots = [];
  try {
    app.useLayer({ review: REVIEW, token: helper.tokenFor(REVIEW), helper: helper.url });
    await page.goto(app.urlFor("/?morph=off"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "boot" });

    const rail = (fn, arg) => page.evaluate(fn, arg);
    const snap = async (label, caption) => {
      // The fixture page has no document style, so boot hides the style
      // button. Real documents show it, so the mockup does too.
      await page.evaluate(() => window.__lahe.rail.setStyleAvailable(true));
      const s = await page.evaluate(snapshotInPage);
      shots.push(Object.assign({ label, caption }, s));
    };

    // An empty rail first.
    await rail(() => { window.__lahe.rail.collapse(false); window.__lahe.rail.selectTab("active"); });
    await snap("Empty rail", "The rail before any comment. Active tab.");

    // The head's menu, open, and the shortcuts panel it opens.
    await page.evaluate(() => window.__lahe.rail.openMenu(0));
    await page.evaluate(() => {
      const root = window.__lahe.rail.tabBody("active").getRootNode();
      root.querySelector('.menuitem[data-action="export-review"]').click();
    });
    await snap("More actions menu", "The menu behind the three dots, open, with the pointer on Export review. View flies out the same way.");
    await page.evaluate(() => {
      const root = window.__lahe.rail.tabBody("active").getRootNode();
      root.querySelector('.menuitem[data-action="shortcuts"]').click();
    });
    await snap("Keyboard shortcuts", "What the Keyboard shortcuts item in that menu opens.");
    await page.keyboard.press("Escape");
    // Focus back on the page, so the comment hotkey reaches it.
    await page.mouse.click(40, 600);

    // The comments, one per state.
    const waiting = await commentOn(page, "section.focus p:nth-of-type(2)", "Cut the second sentence. It sounds defensive.");
    const asked = await commentOn(page, "p.lede", "Pick one number and use it twice.");
    await fold(page, helper, asked, {
      status: "question",
      agent: "claude",
      text: "Do you mean nine check-ins, or the four cards below? They count different things."
    });
    const refused = await commentOn(page, "#feed-coach-note", "Make this sound warmer.");
    await fold(page, helper, refused, {
      status: "not_handled",
      agent: "claude",
      reason: "This note comes from the coach's own message in the app, so I can't reword it from the page source."
    });
    const done = await commentOn(page, "#feed-highlight", "Name the lift and the weight.");
    await fold(page, helper, done, {
      status: "handled",
      agent: "claude",
      reason: "Named the lift (back squat) and the weight (225 lb).",
      files: ["app/views/dashboard/_feed_highlight.html.erb"]
    });
    await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", done.id, { message: "done pane" });

    // A hand edit, waiting for the agent.
    await editAppend(page, "section.focus p:nth-of-type(1)", " Call Devon first.");
    // A comment still being written.
    await draftOn(page, "h1", "Should the heading say whose dashboard this is?");

    await rail(() => window.__lahe.rail.selectTab("active"));
    await snap("Active tab, every state", "An agent question, a draft, a refusal, and a comment waiting for the agent. The hand edit is on the Edits tab.");

    await rail(() => window.__lahe.rail.selectTab("edits"));
    await snap("Edits tab", "The hand edit, as a before and after.");

    await rail(() => window.__lahe.rail.selectTab("done"));
    await snap("Done tab", "A comment the agent handled, with the file it changed.");

    // Hold on: every send button says Send to queue.
    const clickHold = () =>
      page.evaluate(() => window.__lahe.rail.tabBody("active").getRootNode().querySelector(".holdbtn").click());
    await clickHold();
    await rail(() => window.__lahe.rail.selectTab("active"));
    await snap("Hold on", "Hold sending switched on. Every send button says Send to queue; hovering one explains why.");
    await clickHold();

    // Dark, Active tab.
    await rail(() => {
      document.documentElement.style.background = "#12151a";
      document.body.style.background = "#12151a";
      window.__lahe.rail.refreshScheme();
      window.__lahe.rail.selectTab("active");
    });
    await snap("Active tab, dark", "The same Active tab on a dark page.");
    await rail(() => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      window.__lahe.rail.refreshScheme();
    });

    // The status dot, one copy of the head per state. The attributes are the
    // ones renderStatus sets; the shapes come from the rail's own CSS.
    const DOT_STATES = [
      { label: "Stored, agent listening", tip: "Stored · agent listening", attrs: { "data-status": "stored", "data-agent": "connected", "data-loud": "" } },
      { label: "Agent working", tip: "Stored · agent is working, 3m", attrs: { "data-status": "stored", "data-agent": "working", "data-loud": "" } },
      { label: "Stored, no agent listening", tip: "Stored · no agent listening", attrs: { "data-status": "stored", "data-agent": "absent", "data-loud": "" } },
      { label: "Kept in this browser (helper down)", tip: "Kept in this browser", attrs: { "data-status": "kept_locally", "data-agent": "", "data-loud": "" } },
      { label: "Waited too long", tip: "Stored · nothing back yet, 12m", attrs: { "data-status": "stored", "data-agent": "waiting", "data-loud": "true" } }
    ];
    const legend = [];
    for (const state of DOT_STATES) {
      await page.evaluate((st) => {
        const dot = window.__lahe.rail.tabBody("active").getRootNode().querySelector(".head .mark");
        Object.keys(st.attrs).forEach((k) => dot.setAttribute(k, st.attrs[k]));
        // Only the first line: the sentences under it are in the Hover text section.
        dot.parentNode.setAttribute("data-lahe-tip", st.tip);
      }, state);
      const s = await page.evaluate(snapshotInPage, ".head");
      legend.push({ label: state.label, html: s.html });
    }
    shots.push({ label: "Status dot", caption: "The dot in the header, in each state. Shape and color both change.", legend: legend, css: shots[0].css, outside: shots[0].outside, hostAttrs: shots[0].hostAttrs });
    await page.evaluate(() => window.__lahe.rail.refreshScheme());

    // Collapsed.
    await rail(() => window.__lahe.rail.collapse(true));
    await snap("Collapsed", "The rail folded down to its pill.");

    await page.screenshot({ path: path.join(__dirname, "..", "capture_reference.png") });
    await rail(() => window.__lahe.rail.collapse(false));
    await page.screenshot({ path: path.join(__dirname, "..", "capture_reference_open.png") });

    fs.writeFileSync(path.join(__dirname, "..", "capture.json"), JSON.stringify(shots, null, 1));
    expect(shots.length).toBeGreaterThan(0);
  } finally {
    await helper.stop().catch(() => {});
    await app.close();
  }
});
