// Read-only: time the Library list build against the real state folder.
var r = require(process.argv[2] + "/src/service/catalog_reader.js");
var reader = r.createReader({ dir: process.env.HOME + "/.local/state/lahe" });
var fn = reader.list || reader.read || reader.build;
console.log("methods:", Object.keys(reader).join(","));
(async function () {
  for (var i = 0; i < 4; i++) {
    var t = process.hrtime.bigint();
    var out = await fn.call(reader, Date.now());
    var ms = Number(process.hrtime.bigint() - t) / 1e6;
    console.log("run", i, "ms", ms.toFixed(1), "keys", Object.keys(out || {}).join(","));
  }
})();
