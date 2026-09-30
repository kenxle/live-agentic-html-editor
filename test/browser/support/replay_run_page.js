// A page with replay loaded straight from src/, for the free-writing replay
// specs (plan Tasks 2.5 to 2.7).
//
// Owner: free-writing replay (2B). The layer files load in manifest order up to
// and including replay.js, and nothing boots: no rail, no sync, no helper. Each
// spec builds its records in Node from record_fixtures.js, puts them in the
// page as the replay context's items (the store's cache, as index.js hands
// them over), and runs passes by hand. So the specs test the source and need
// no bundle rebuild.
//
// The card is a small recorder with the rail's in-place mutator names
// (setCardBadge, setCardNotice, attachCardNode ...). An attached node is put
// into the document, so a test clicks the conflict card's real buttons.

"use strict";

const path = require("node:path");
const manifest = require("../../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function layerScripts() {
  const out = [];
  for (const entry of manifest.LAYER_FILES) {
    out.push(entry.path);
    if (entry.path === "src/layer/replay.js") break;
  }
  return out;
}

/** Open a fixture page and load the layer files up to replay, then wire a context. */
async function openReplayPage(page, server, fixture) {
  await page.goto(server.urlFor(fixture));
  for (const file of layerScripts()) await page.addScriptTag({ path: path.join(REPO_ROOT, file) });
  await page.evaluate(() => {
    const cards = { badges: {}, notices: {}, nodes: {}, removed: [] };
    const tray = document.createElement("div");
    tray.id = "test-card-tray";
    tray.setAttribute("data-lahe", "chrome");
    document.body.appendChild(tray);
    window.__cards = cards;
    window.__items = [];
    window.__persisted = [];
    const rail = {
      setCardBadge(id, failure) {
        (cards.badges[id] = cards.badges[id] || {})[failure.code] = failure;
      },
      clearCardBadge(id, code) {
        if (cards.badges[id]) delete cards.badges[id][code];
      },
      setCardNotice(id, text) {
        cards.notices[id] = text;
      },
      attachCardNode(id, node) {
        cards.nodes[id] = node;
        if (node.parentNode !== tray) tray.appendChild(node);
      },
      detachCardNode(id, node) {
        if (node.parentNode) node.parentNode.removeChild(node);
        delete cards.nodes[id];
        return true;
      },
      holdsFocus() {
        return false;
      },
      removeCard(id) {
        cards.removed.push(id);
      }
    };
    window.LAHE.replay.configure({
      root: document.body,
      document: document,
      items: () => window.__items,
      cards: rail,
      persist(item) {
        window.__persisted.push(item.id);
        window.__items = window.__items.map((i) => (i.id === item.id ? item : i));
      },
      editing: {
        retire(id) {
          window.__items = window.__items.filter((i) => i.id !== id);
          return { retired: true };
        }
      },
      hasItem: (id) => window.__items.some((i) => i.id === id)
    });
    window.__pass = () => {
      const s = window.LAHE.replay.runPass("manual");
      return s.results.map((r) => ({ id: r.item && r.item.id, wrote: r.wrote, branch: r.branch, lost: r.lost, reason: r.reason }));
    };
    window.__main = () => document.querySelector("main") || document.getElementById("post") || document.body;
    window.__count = (text) => {
      const words = window.__main().innerText.replace(/\s+/g, " ");
      let n = 0;
      let at = words.indexOf(text);
      while (at !== -1) {
        n += 1;
        at = words.indexOf(text, at + 1);
      }
      return n;
    };
    window.__check = (item) => {
      const body = document.body;
      const replay = window.LAHE.replay;
      return replay.pageCheckReasonFor(item, replay.pageTextOf(body), replay.pageCheckOptions(body, {}));
    };
  });
}

/** Put these records in the page as replay's items. */
function setItems(page, items) {
  return page.evaluate((list) => {
    window.__items = list;
  }, items);
}

module.exports = { openReplayPage, setItems, layerScripts };
