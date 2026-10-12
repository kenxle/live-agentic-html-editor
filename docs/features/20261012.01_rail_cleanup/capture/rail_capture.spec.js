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
const DOT = require(path.join(REPO, "src", "layer", "overlay.js")).DOT_WORDS;
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

    // A two-round conversation: the agent answers, the reviewer follows up, and
    // the agent answers again with two changed files.
    const talk = await commentOn(page, "#feed-queue p", "Shorten this to the people who need a call today.");
    await fold(page, helper, talk, {
      status: "handled",
      agent: "claude",
      text: "Cut it to Devon, Priya and Sam. The other four moved to tomorrow's list."
    });
    await page.evaluate((id) => window.__lahe.handle.doneTab().followUp(id, "Good. Put Devon first, he has waited longest."), talk.id);
    await pollPage(page, (id) => {
      const it = window.__lahe.itemById(id);
      return it.thread.length === 1 && it.state === "ready" && !it.reply;
    }, talk.id, { message: "follow-up sent" });
    const talk2 = await page.evaluate((id) => window.__lahe.itemById(id), talk.id);
    for (let i = 0; i < 200; i += 1) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(helper.stateDir, "reviews", REVIEW, "review.json"), "utf8"));
        if (p.pages.some((pg) => pg.items.some((it) => it.id === talk2.id && it.rev === talk2.rev))) break;
      } catch (err) {
        // not written yet
      }
      await page.waitForTimeout(50);
    }
    await fold(page, helper, talk2, {
      status: "handled",
      agent: "claude",
      user_needs_to_see_reply: true,
      text: "Moved Devon to the top and added how long he has waited (6 days).",
      files: ["app/views/dashboard/_feed_queue.html.erb", "app/helpers/queue_helper.rb"]
    });
    await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", talk.id, { message: "thread card in done" });

    // A hand edit, waiting for the agent.
    await editAppend(page, "section.focus p:nth-of-type(1)", " Call Devon first.");
    // A comment still being written.
    await draftOn(page, "h1", "Should the heading say whose dashboard this is?");

    await rail(() => window.__lahe.rail.selectTab("active"));
    await snap("Active tab, every state", "A hand edit, an agent question, a draft, a refusal, and a comment waiting for the agent, under the All / Comments / Edits filter and the search box.");


    await rail(() => window.__lahe.rail.selectTab("done"));
    await snap("Done tab", "Two comments the agent handled. The second is a two-round conversation; hover the agent's name to see the files it changed.");

    // Thread cards, redesigned: the same cards one at a time, light and dark,
    // with the conversation card shown open and folded.
    const cardShot = (id) => page.evaluate(snapshotInPage, '.card[data-card-id="' + id + '"]');
    const shootCard = async (id, file) => {
      const rect = await page.evaluate((cid) => {
        const n = window.__lahe.rail.cardNode(cid);
        n.scrollIntoView({ block: "center" });
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, id);
      // Hover the newest agent name, so the picture shows the file list too.
      const who = await page.evaluate((cid) => {
        const all = window.__lahe.rail.cardNode(cid).querySelectorAll(".turn__who--files");
        if (!all.length) return null;
        const r = all[all.length - 1].getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, id);
      if (who) await page.mouse.move(who.x, who.y);
      await page.screenshot({
        path: path.join(__dirname, "..", file),
        clip: { x: rect.x - 12, y: rect.y - 12, width: rect.width + 24, height: rect.height + 24 }
      });
      await page.mouse.move(5, 5);
    };
    const cardSet = async (scheme) => {
      const out = [];
      await rail(() => window.__lahe.rail.selectTab("done"));
      out.push({ label: "Done, open (" + scheme + ")", scheme, html: (await cardShot(talk.id)).html });
      await shootCard(talk.id, "cards_redesign_" + scheme + ".png");
      await rail((id) => window.__lahe.rail.setCardCollapsed(id, true), talk.id);
      out.push({ label: "Done, folded (" + scheme + ")", scheme, html: (await cardShot(talk.id)).html });
      await rail((id) => window.__lahe.rail.setCardCollapsed(id, false), talk.id);
      await rail(() => window.__lahe.rail.selectTab("active"));
      out.push({ label: "Active, a question from the agent (" + scheme + ")", scheme, html: (await cardShot(asked.id)).html });
      return out;
    };
    const lightCards = await cardSet("light");
    await rail(() => {
      document.documentElement.style.background = "#12151a";
      document.body.style.background = "#12151a";
      window.__lahe.rail.refreshScheme();
    });
    const darkCards = await cardSet("dark");
    await rail(() => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
      window.__lahe.rail.refreshScheme();
    });
    shots.push({
      label: "Thread cards, redesigned",
      caption: "Your words sit on the right in a tinted bubble; the agent's sit on the left. Names and times are small captions. Hover the agent's name to see the files it changed. The folded card has no 1 new tag because its reply has been read.",
      cards: lightCards.concat(darkCards),
      css: shots[0].css,
      outside: shots[0].outside,
      hostAttrs: shots[0].hostAttrs
    });

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
      { label: "Stored, agent listening", tip: DOT.connected, attrs: { "data-status": "stored", "data-agent": "connected", "data-loud": "" } },
      { label: "Agent working", tip: DOT.working.replace("{age}", "3m"), attrs: { "data-status": "stored", "data-agent": "working", "data-loud": "" } },
      { label: "Stored, no agent listening", tip: DOT.absent, attrs: { "data-status": "stored", "data-agent": "absent", "data-loud": "" } },
      { label: "Helper down", tip: DOT.helper_down, attrs: { "data-status": "kept_locally", "data-agent": "", "data-loud": "" } },
      { label: "Waited too long", tip: DOT.waiting.replace("{age}", "12m"), attrs: { "data-status": "stored", "data-agent": "waiting", "data-loud": "true" } }
    ];
    const legend = [];
    const realDot = await page.evaluate(() => {
      const dot = window.__lahe.rail.tabBody("active").getRootNode().querySelector(".head .mark");
      return { status: dot.getAttribute("data-status"), agent: dot.getAttribute("data-agent"), loud: dot.getAttribute("data-loud"), tip: dot.parentNode.getAttribute("data-lahe-tip") };
    });
    for (const state of DOT_STATES) {
      await page.evaluate((st) => {
        const dot = window.__lahe.rail.tabBody("active").getRootNode().querySelector(".head .mark");
        Object.keys(st.attrs).forEach((k) => dot.setAttribute(k, st.attrs[k]));
        // Only the first line: the sentences under it are in the Hover text section.
        dot.parentNode.setAttribute("data-lahe-tip", st.tip);
      }, state);
      const s = await page.evaluate(snapshotInPage, ".head");
      legend.push({ label: state.label, tip: state.tip, html: s.html });
    }
    // Put the real reading back, so the views after this one show it.
    await page.evaluate((d) => {
      const dot = window.__lahe.rail.tabBody("active").getRootNode().querySelector(".head .mark");
      dot.setAttribute("data-status", d.status || "");
      dot.setAttribute("data-agent", d.agent || "");
      dot.setAttribute("data-loud", d.loud || "");
      if (d.tip) dot.parentNode.setAttribute("data-lahe-tip", d.tip);
    }, realDot);
    shots.push({ label: "Status dot", caption: "The dot in the header, in each state. Shape and color both change. Under each label is the first line its hover shows; edit it there. The sentences under that first line are in the Hover text section at the bottom of this page.", legend: legend, css: shots[0].css, outside: shots[0].outside, hostAttrs: shots[0].hostAttrs });
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
