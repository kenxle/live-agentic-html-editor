// Installed styles for the switcher specs, on a real review (lahe_world.js).
//
// Two made-up styles under test/fixtures/styles/, never a paid one: `sample`
// (a cream ground and its own face, so a switch shows in colour AND font) and
// `sample-dark` (a dark ground, so the rail's scheme can follow the page).
//
// They are installed the way a reviewer installs one: `lahe style add`, into
// the world's own state directory. The page server then answers
// `.lahe-styles/` from the installed styles and nothing else.
//
// Nothing here deletes a file: "removing" a style is renaming its installed
// folder, which is exactly what the page server sees when a style goes away.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FIXTURE_STYLES = path.join(REPO_ROOT, "test", "fixtures", "styles");

/**
 * Install styles for this world with the real command.
 *
 * @param {object} world   from lahe_world.makeWorld
 * @param {string[]} ids   any of "sample", "sample-dark"; [] installs nothing
 */
function installStyles(world, ids) {
  ids.forEach((id) => world.cli(["style", "add", path.join(FIXTURE_STYLES, id)]));
}

/** Take a style away the way a person does: its folder is no longer there. */
function removeStyle(world, id) {
  const dir = path.join(world.stateDir, "styles", id);
  fs.renameSync(dir, dir + ".removed-by-test");
}

module.exports = { FIXTURE_STYLES, installStyles, removeStyle };
