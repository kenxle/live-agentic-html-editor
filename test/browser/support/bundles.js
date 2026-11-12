/*
read-when: Writing or debugging a spec that loads the review layer or the Library page script straight into a page, without a helper serving dist/.
*/

// The browser bundles, built in memory from this worktree's source.
//
// Builders never commit dist/, so a spec that read dist/ would test whoever
// last ran the build script rather than the source in front of it. These come
// from scripts/build-layer.js's own buildAll(), so they are the same bytes
// npm run build:layer would write: the same entry, the same registrations for
// converted modules, the same version stamp.
//
// One build per Playwright worker, shared by every spec in it. esbuild's
// helper process is stopped once the build is done, so nothing is left
// running.

"use strict";

const build = require("../../../scripts/build-layer.js");
const manifest = require("../../../src/shared/manifest.js");

let built = null;

function buildOnce() {
  if (!built) {
    built = build.buildAll().then(
      async function (outputs) {
        await build.stop();
        return outputs;
      },
      async function (err) {
        built = null;
        await build.stop();
        throw err;
      }
    );
  }
  return built;
}

async function contentsOf(output) {
  const outputs = await buildOnce();
  const file = outputs.find(function (candidate) {
    return candidate.output === output;
  });
  if (!file) throw new Error("bundles: the build wrote no " + output);
  return file.contents;
}

/** dist/lahe-layer.js as this worktree's source builds it. */
function layerBundle() {
  return contentsOf(manifest.BUNDLE_OUTPUT);
}

/** dist/lahe-library.js as this worktree's source builds it. */
function libraryBundle() {
  return contentsOf(manifest.LIBRARY_OUTPUT);
}

module.exports = { layerBundle, libraryBundle };
