// Installed styles for the switcher specs, on a real review (lahe_world.js).
//
// Two made-up styles, never a paid one: `sample` (a light, warm ground and a
// monospace body face, so a switch is visible in colour AND font) and
// `sample-dark` (a dark ground, so the rail's scheme can follow the page).
//
// HOW THEY REACH THE PAGE depends on what is merged:
//
//   - With pull request A (the service: `lahe style add`, and page servers
//     that answer `.lahe-styles/` from the installed styles) the fixture
//     folders under test/fixtures/styles/ are installed into the world's own
//     state directory with the real command. This is the shape the switcher
//     specs are written for, and the orchestrator re-runs them on it.
//   - Before it, the page server has no reserved segment and serves files from
//     the reviewed folder, so the same three shapes the architecture defines
//     (index.json, <id>/style.css, <id>/fonts/<file>.woff2) are written beside
//     the page. That exercises the layer honestly: it only ever asks for those
//     three URLs.
//
// Everything goes under the OS temp folder the world made. Nothing here
// deletes a file: "removing" a style is renaming its folder, which is exactly
// what the page server sees when a style goes away.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FIXTURE_STYLES = path.join(REPO_ROOT, "test", "fixtures", "styles");
const FONT = path.join(REPO_ROOT, "vendor", "stclair-doc-style", "fonts", "jetbrains-mono-variable.woff2");

// The stub styles, for a page server with no reserved segment yet. Each resets
// a few of the house tokens' effects directly, which is all a test needs to see
// a restyle in computed colour and font.
const STUB = {
  sample: {
    name: "Sample",
    description: "A made-up light style for tests.",
    palette: ["#fbf3e4", "#2b2118", "#b8461b", "#2f6b4f", "#d9c7a7", "#7a5c3e"],
    css: [
      '@font-face{font-family:"Sample Mono";src:url("./fonts/sample-mono.woff2") format("woff2");font-weight:100 900}',
      "html,body{background:#fbf3e4;color:#2b2118}",
      'body{font-family:"Sample Mono",monospace}',
      "h1,h2,h3{color:#b8461b}",
      // A page that reflows under the switch, so the reading position matters.
      "p{line-height:2.1}"
    ].join("\n"),
    font: true
  },
  "sample-dark": {
    name: "Sample Dark",
    description: "A made-up dark-ground style for tests.",
    palette: ["#14161b", "#e8e6e1", "#7fb4ff", "#f2b66d"],
    css: [
      "html,body{background:#14161b;color:#e8e6e1}",
      "h1,h2,h3{color:#7fb4ff}",
      "a{color:#f2b66d}"
    ].join("\n"),
    font: false
  }
};

/** Is the service half merged: the command, and the fixture folders it installs? */
function serviceMerged(world) {
  if (!fs.existsSync(path.join(FIXTURE_STYLES, "sample", "style.css"))) return false;
  try {
    world.cli(["style", "list"]);
    return true;
  } catch (err) {
    return false;
  }
}

function stubRoot(world) {
  return path.join(path.dirname(world.source), ".lahe-styles");
}

function writeStubIndex(world, ids) {
  const root = stubRoot(world);
  fs.mkdirSync(root, { recursive: true });
  const styles = ids
    .filter((id) => fs.existsSync(path.join(root, id, "style.css")))
    .map((id) => ({ id, name: STUB[id].name, description: STUB[id].description, palette: STUB[id].palette }));
  fs.writeFileSync(path.join(root, "index.json"), JSON.stringify({ styles }));
}

/**
 * Install styles for this world, by the real command when it exists.
 *
 * @param {object} world   from lahe_world.makeWorld
 * @param {string[]} ids   any of "sample", "sample-dark"; [] installs nothing
 * @returns {{mode: "service"|"stub"}}
 */
function installStyles(world, ids) {
  if (serviceMerged(world)) {
    ids.forEach((id) => world.cli(["style", "add", path.join(FIXTURE_STYLES, id)]));
    world.styleMode = "service";
    return { mode: "service" };
  }
  const root = stubRoot(world);
  ids.forEach((id) => {
    const dir = path.join(root, id);
    fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "style.css"), STUB[id].css);
    if (STUB[id].font) fs.copyFileSync(FONT, path.join(dir, "fonts", "sample-mono.woff2"));
  });
  writeStubIndex(world, ids);
  world.styleMode = "stub";
  world.stubIds = ids.slice();
  return { mode: "stub" };
}

/** Take a style away the way a person does: its folder is no longer there. */
function removeStyle(world, id) {
  if (world.styleMode === "service") {
    const dir = path.join(world.stateDir, "styles", id);
    fs.renameSync(dir, dir + ".removed-by-test");
    return;
  }
  const dir = path.join(stubRoot(world), id);
  fs.renameSync(dir, dir + ".removed-by-test");
  writeStubIndex(world, world.stubIds || []);
}

module.exports = { STUB, FIXTURE_STYLES, serviceMerged, installStyles, removeStyle };
