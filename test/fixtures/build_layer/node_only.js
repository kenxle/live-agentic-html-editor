var fs = require("node:fs");
module.exports = {
  marker: "NODE_ONLY_MARKER",
  greet: function () {
    return fs.existsSync("/") ? "from node" : "";
  }
};
