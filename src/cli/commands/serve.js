// `lahe serve`: run the helper until something stops it.
//
// Owner: 1A.
//
//   lahe serve [--port <n>] [--state-dir <path>] [--review <id>]... [--origin <origin>]...
//
// SERVE IS IDEMPOTENT. `add` (3B) starts the helper when it is not already up,
// which is what makes the install one command rather than two, so a second
// `serve` against a port a helper is already answering on reports that and exits
// 0 rather than dying on EADDRINUSE. A port answering with something that is NOT
// a lahe helper is a different thing entirely and exits non-zero, because
// silently doing nothing there would leave the reviewer waiting on a helper that
// never arrives.
//
// Node-only.

"use strict";

var protocol = require("../../shared/protocol.js");
var service = require("../../service/index.js");

var USAGE = [
  "usage: lahe serve [--port <n>] [--state-dir <path>] [--review <id>] [--origin <origin>]",
  "",
  "  --port       the port to bind on 127.0.0.1. Default " + protocol.DEFAULT_PORT + ", which is fixed on",
  "               purpose: the page has the port in its script tag and no way to learn a new one.",
  "  --state-dir  where the helper keeps its data. Default $LAHE_STATE_DIR, then",
  "               $XDG_STATE_HOME/lahe, then ~/.local/state/lahe. It must sit outside any checkout.",
  "  --review     a review id to open before the listener answers. Repeatable.",
  "  --origin     an origin to register on those reviews. Repeatable. One review may hold several,",
  "               which is how localhost and 127.0.0.1 stay one review."
].join("\n");

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {{ok: true, options: object} | {ok: false, message: string}}
 */
function parseArgs(argv) {
  var list = argv || [];
  var options = { reviews: [], origins: [] };
  var index = 0;

  function takeValue(name, inline) {
    if (inline !== null) return inline;
    index += 1;
    var value = list[index];
    if (value === undefined) throw new Error(name + " takes a value");
    return value;
  }

  try {
    for (; index < list.length; index += 1) {
      var arg = list[index];
      var name = arg;
      var inline = null;
      var eq = arg.indexOf("=");
      if (arg.indexOf("--") === 0 && eq !== -1) {
        name = arg.slice(0, eq);
        inline = arg.slice(eq + 1);
      }

      if (name === "--help" || name === "-h") {
        return { ok: false, message: USAGE };
      }
      if (name === "--port") {
        var port = Number(takeValue("--port", inline));
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          return { ok: false, message: "--port takes a port number" };
        }
        options.port = port;
      } else if (name === "--state-dir") {
        options.stateDir = takeValue("--state-dir", inline);
      } else if (name === "--review") {
        var id = takeValue("--review", inline);
        if (!protocol.isSafeId(id)) {
          return {
            ok: false,
            message:
              "--review takes a safe id, because a review id is a path component. The rule is " +
              String(protocol.SAFE_ID) +
              " and the value was " +
              JSON.stringify(id)
          };
        }
        options.reviews.push(id);
      } else if (name === "--origin") {
        options.origins.push(takeValue("--origin", inline));
      } else {
        return { ok: false, message: "unknown option " + arg + "\n\n" + USAGE };
      }
    }
  } catch (err) {
    return { ok: false, message: err.message + "\n\n" + USAGE };
  }
  return { ok: true, options: options };
}

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {Promise<number>} the process exit code
 */
async function run(argv) {
  var parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(parsed.message + "\n");
    return protocol.WAIT.EXIT.BAD_USAGE;
  }

  var helper;
  try {
    helper = await service.serve(parsed.options);
  } catch (err) {
    if (err && err.code === "EADDRINUSE") {
      var port = parsed.options.port === undefined ? protocol.DEFAULT_PORT : parsed.options.port;
      var already = await service.probeHealth(protocol.DEFAULT_HOST, port);
      if (already) {
        process.stdout.write(
          "lahe serve: a helper is already answering on " +
            protocol.DEFAULT_HOST +
            ":" +
            port +
            " (api " +
            already.api +
            "). Nothing to do.\n"
        );
        return 0;
      }
      process.stderr.write(
        "lahe serve: port " +
          port +
          " is taken by something that is not a lahe helper. Free it, or run with --port <n> and put that port on the script tag.\n"
      );
      return 1;
    }
    process.stderr.write("lahe serve: " + (err && err.message ? err.message : String(err)) + "\n");
    return 1;
  }

  // Nothing left to do here. The listener keeps the event loop alive; SIGTERM
  // closes it politely and a kill -9 does not, and the log survives either.
  return new Promise(function (resolve) {
    process.on("SIGTERM", function () {
      helper.close().then(function () {
        resolve(0);
      });
    });
  });
}

module.exports = { USAGE: USAGE, parseArgs: parseArgs, run: run };
