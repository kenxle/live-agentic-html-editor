/*
 * read-when: Changing the Node minimum or the message an old Node sees, in bin/lahe.js or scripts/install-cli.js.
 */

// Written in plain ES5 with `var`, on purpose: this file and bin/lahe.js must
// parse and run on a Node far older than the floor, because the whole job is to
// tell that user what to do instead of crashing on syntax.

"use strict";

var FLOOR_TEXT = "24.12.0";
var FLOOR = [24, 12, 0];

/** "v24.12.0" or "24.12.0" as three numbers, or null when it is not that. */
function parseVersion(text) {
  if (typeof text !== "string") return null;
  var match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Is this version at or above the floor? A string that cannot be read is not. */
function meetsFloor(text) {
  var parts = parseVersion(text);
  if (!parts) return false;
  for (var i = 0; i < FLOOR.length; i++) {
    if (parts[i] > FLOOR[i]) return true;
    if (parts[i] < FLOOR[i]) return false;
  }
  return true;
}

/** The first half of every refusal: what is needed and what was found. */
function describe(found) {
  var parts = parseVersion(found);
  var seen = parts ? "this is Node " + String(found).replace(/^v/, "") : 'its version could not be read ("' + String(found) + '")';
  return "Lahe needs Node 24.12 or newer, and " + seen + ".";
}

/**
 * The message for the lahe command, or null when the Node is new enough.
 *
 * @param {string} found the running Node's version, as process.versions.node spells it
 * @param {string} cloneDir the clone's absolute path
 */
function problem(found, cloneDir) {
  if (meetsFloor(found)) return null;
  return (
    describe(found) +
    " Install Node 24.12 or newer, then run `npm run install-cli` and `lahe install` in " +
    cloneDir +
    "."
  );
}

module.exports = {
  FLOOR_TEXT: FLOOR_TEXT,
  parseVersion: parseVersion,
  meetsFloor: meetsFloor,
  describe: describe,
  problem: problem
};
