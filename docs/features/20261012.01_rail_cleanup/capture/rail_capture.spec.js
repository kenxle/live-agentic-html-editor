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

function fold(page, item, reply, state) {
  return page.evaluate((a) => {
    window.__lahe.handle.doneTab().applyReplies([
      {
        event: "reply.folded",
        item: a.item.id,
        rev: a.item.rev,
        accepted: true,
        state: a.state,
        ts: new Date().toISOString(),
        reply: a.reply
      }
    ]);
  }, { item, reply, state });
}

// Runs in the page. Copies the rail's shadow tree out as light-DOM HTML, plus
// its CSS split into what may sit inside @scope and what may not.
function snapshotInPage() {
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
  const html = kids(root);
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
      const s = await page.evaluate(snapshotInPage);
      shots.push(Object.assign({ label, caption }, s));
    };

    // An empty rail first.
    await rail(() => { window.__lahe.rail.collapse(false); window.__lahe.rail.selectTab("active"); });
    await snap("Empty rail", "The rail before any comment. Active tab.");

    // The comments, one per state.
    const waiting = await commentOn(page, "section.focus p:nth-of-type(2)", "Cut the second sentence. It sounds defensive.");
    const asked = await commentOn(page, "p.lede", "Pick one number and use it twice.");
    await fold(page, asked, {
      status: "question",
      agent: "claude",
      text: "Do you mean nine check-ins, or the four cards below? They count different things."
    }, "ready");
    const refused = await commentOn(page, "#feed-coach-note", "Make this sound warmer.");
    await fold(page, refused, {
      status: "not_handled",
      agent: "claude",
      reason: "This note comes from the coach's own message in the app, so I can't reword it from the page source."
    }, "not_handled");
    const done = await commentOn(page, "#feed-highlight", "Name the lift and the weight.");
    await fold(page, done, {
      status: "handled",
      agent: "claude",
      reason: "Named the lift (back squat) and the weight (225 lb).",
      files: ["app/views/dashboard/_feed_highlight.html.erb"]
    }, "handled");
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
