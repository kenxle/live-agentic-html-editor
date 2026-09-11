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
var sourceStamp = require("../../service/source_stamp.js");
var stateDirModule = require("../../service/state_dir.js");
var reviewsModule = require("../../service/reviews.js");
var sessionCommand = require("./session.js");

var USAGE = [
  "usage: lahe serve [--restart] [--port <n>] [--state-dir <path>] [--review <id>] [--origin <origin>]",
  "",
  "  --restart    replace a helper that is already answering on the port, even when somebody has a",
  "               review page open on it. This is the deliberate override: every other command leaves",
  "               a helper with a live reviewer alone and tells you to run this when they are done.",
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
        return { ok: false, help: true, message: USAGE };
      }
      if (name === "--restart") {
        options.restart = true;
      } else if (name === "--port") {
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
 * Stop the helper answering on this port so this process can take its place.
 *
 * @returns {Promise<true|number>} true when the port is free (including when
 *   nothing was on it), otherwise the exit code to return
 */
async function replaceRunningHelper(options) {
  var port = options.port === undefined ? protocol.DEFAULT_PORT : options.port;
  var live = await service.probeHealth(protocol.DEFAULT_HOST, port);
  if (!live) return true;
  var dir;
  try {
    dir = options.stateDir
      ? stateDirModule.stateDir({ dir: options.stateDir, allowInsideCheckout: options.allowInsideCheckout })
      : stateDirModule.stateDir();
  } catch (err) {
    process.stderr.write("lahe serve: " + err.message + "\n");
    return 1;
  }
  // Say what is about to be interrupted. The whole reason this flag exists is
  // that the other commands refuse to do this silently, so doing it silently
  // here would put the problem back.
  var holders = reviewsModule.readLiveHolders(dir, reviewsModule.LIVE_WINDOW_MS);
  if (holders.length > 0) {
    process.stdout.write("lahe serve: " + reviewsModule.liveReviewerSentence(holders, { forced: true }) + "\n");
  }
  try {
    var replaced = await sessionCommand.stopVerifiedHelper(dir);
    if (!replaced) {
      process.stderr.write(
        "lahe serve: something is answering on " + protocol.DEFAULT_HOST + ":" + port +
          " that this state directory cannot identify as its own helper. Stop it yourself, then run serve again.\n"
      );
      return 1;
    }
  } catch (err) {
    process.stderr.write("lahe serve: " + err.message + "\n");
    return 1;
  }
  return true;
}

/**
 * @param {string[]} argv the arguments after the command name
 * @returns {Promise<number>} the process exit code
 */
async function run(argv) {
  var parsed = parseArgs(argv);
  if (!parsed.ok) {
    process[parsed.help ? "stdout" : "stderr"].write(parsed.message + "\n");
    return parsed.help ? protocol.CLI_EXIT.OK : protocol.CLI_EXIT.BAD_USAGE;
  }

  // --restart is the one path that replaces a helper a reviewer is using. It
  // happens BEFORE the bind, because the bind is what would fail with the port
  // still held. Everything else about serve is unchanged: without the flag a
  // port a helper already answers on is reported and left alone.
  if (parsed.options.restart) {
    var stopped = await replaceRunningHelper(parsed.options);
    if (stopped !== true) return stopped;
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
        // Say it, do not act on it. `serve` starts the helper; deciding to
        // replace a shared one belongs to the commands that are about to use it
        // (`lahe review` and `lahe session`), which do it with the reviewer told
        // why. Staying quiet here is how a two-day-old helper goes unnoticed.
        if (sourceStamp.helperPredatesSource(already.started_at).stale) {
          process.stdout.write(
            "  " + sourceStamp.reasonSentence(".") + "\n" +
              "  The next `lahe review` replaces it and says so, unless somebody has a review page open on\n" +
              "  it, in which case it is left alone and `lahe serve --restart` is how you replace it anyway.\n"
          );
        }
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
