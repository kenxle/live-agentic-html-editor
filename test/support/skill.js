"use strict";

const fs = require("node:fs");
const installSkills = require("../../scripts/install-skills.js");

// Existing instruction checks apply to the shipped skill, including its
// on-demand references, rather than requiring all prose in the entrypoint.
function readSkillText() {
  return [installSkills.SOURCE, ...installSkills.REFERENCES
    .filter((ref) => ref.to !== "references/components.md")
    .map((ref) => ref.from)]
    .map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

module.exports = { readSkillText };
