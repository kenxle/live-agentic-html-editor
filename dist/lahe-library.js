/*
 * live-agentic-html-editor Library page
 * version 0.4.0+de514863c063
 *
 * GENERATED FILE. Do not edit. Edit the sources under src/ and run
 *   npm run build:layer
 *
 * Bundled by esbuild in the order given by src/shared/manifest.js.
 */
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/shared/protocol.js
  var require_protocol = __commonJS({
    "src/shared/protocol.js"(exports, module) {
      (function(root, factory) {
        "use strict";
        var browser = typeof window !== "undefined" && !!window.document;
        if (browser) {
          root.LAHE = root.LAHE || {};
          root.LAHE.protocol = factory(root.LAHE.failures);
        } else {
          module.exports = factory(__require("./failures.js"));
        }
      })(typeof globalThis !== "undefined" ? globalThis : exports, function(failures) {
        "use strict";
        var API_VERSION = "v1";
        var SERVICE_CONTRACT = 17;
        var CONTRACT_VERDICT = { CURRENT: "current", OLDER: "older", NEWER: "newer" };
        function helperContractVerdict(health) {
          var live = health && Number.isInteger(health.service_contract) ? health.service_contract : 0;
          if (live > SERVICE_CONTRACT) return CONTRACT_VERDICT.NEWER;
          if (live < SERVICE_CONTRACT) return CONTRACT_VERDICT.OLDER;
          return CONTRACT_VERDICT.CURRENT;
        }
        var BASE = "/lahe/" + API_VERSION;
        var DEFAULT_PORT = 7817;
        var DEFAULT_HOST = "127.0.0.1";
        var DEFAULT_HELPER_ORIGIN = "http://" + DEFAULT_HOST + ":" + DEFAULT_PORT;
        var ALLOWED_HOST_NAMES = ["127.0.0.1", "localhost", "[::1]", "::1"];
        var LOOPBACK_ORIGIN_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
        var ORIGIN_LIMIT = 16;
        function isRegisterableOrigin(origin) {
          if (typeof origin !== "string" || !origin) return false;
          if (origin === "null") return true;
          var parsed;
          try {
            parsed = new URL(origin);
          } catch (err) {
            return false;
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
          if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
          if (origin !== parsed.origin) return false;
          return LOOPBACK_ORIGIN_HOSTS.indexOf(parsed.hostname) !== -1;
        }
        var HEADER = {
          // The required custom header. Its only job is to be non-simple: a form or
          // an img tag on a hostile page cannot set it, so a CORS-simple request can
          // never reach a handler. Value is CLIENT_LAYER or CLIENT_CLI.
          CLIENT: "x-lahe-client",
          // The per-review token (D11). Minted by the add step, embedded on the
          // script tag, and readable by anything running on the reviewed page, which
          // is exactly why it is scoped to one review and never to the machine.
          TOKEN: "x-lahe-token",
          // Echoed on every response so a chip in the rail can be matched to a line
          // in the helper log.
          REQUEST_ID: "x-lahe-request-id",
          CONTENT_TYPE: "content-type",
          ORIGIN: "origin",
          HOST: "host",
          // Set by the browser, never by a script. The Library's routes read it to
          // tell their own page apart from a document on another loopback port,
          // which sends "same-site" (see CATALOG_ROUTES).
          SEC_FETCH_SITE: "sec-fetch-site",
          SEC_FETCH_MODE: "sec-fetch-mode",
          SEC_FETCH_DEST: "sec-fetch-dest",
          // The CLI secret (stable addresses): read from an owner-only file in the
          // state folder and sent only by the CLI on site.bind. A page can never read
          // it, so a page holding a review token still cannot name a file to serve.
          CLI_SECRET: "x-lahe-cli-secret",
          // The signed-request wire (AUTH.CLI_PROOF): the menu bar app proves it can
          // read the CLI secret without ever sending it. See PROOF below.
          PROOF_TS: "x-lahe-proof-ts",
          PROOF_NONCE: "x-lahe-proof-nonce",
          PROOF: "x-lahe-proof",
          PROOF_REPLY: "x-lahe-proof-reply"
        };
        var CLIENT_LAYER = "layer";
        var CLIENT_CLI = "cli";
        var CLIENTS = [CLIENT_LAYER, CLIENT_CLI];
        var CLIENT_CATALOG = "catalog";
        var JSON_CONTENT_TYPE = "application/json";
        var AUTH = {
          // Liveness only. Carries no review data, so it needs no credential.
          NONE: "none",
          // A valid token for the review named in the request.
          REVIEW_TOKEN: "review_token",
          // The Library token (a D11 amendment): minted in memory at each helper
          // start, carried only by the served Library page. It can list, open
          // (restart recorded servers only), star, and queue a request. It cannot
          // post to a review, read comment text, or name a file to serve. Which
          // checks each catalog route runs is the per-route table in CATALOG_ROUTES.
          CATALOG_TOKEN: "catalog_token",
          // The CLI secret (stable addresses). Only site.bind takes it, and that
          // route also refuses any request carrying an Origin header, so only a
          // process that can read the state folder's owner-only file can bind.
          CLI_SECRET: "cli_secret",
          // The CLI proof (the menu bar app): a request signed with HMAC-SHA256
          // keyed by the CLI secret, within PROOF.WINDOW_MS, with a nonce never seen
          // before, and an answer signed back. The secret itself never travels, so
          // a program squatting on the port learns one used proof and nothing else.
          // No browser can send one: the routes refuse any Sec-Fetch header.
          CLI_PROOF: "cli_proof"
        };
        var PROOF = {
          REQUEST_PREFIX: "lahe-proof-v1",
          REPLY_PREFIX: "lahe-proof-reply-v1",
          // A timestamp this far from the helper's clock, either way, is refused.
          WINDOW_MS: 30 * 1e3,
          TS_PATTERN: /^[0-9]{1,16}$/,
          // 16 random bytes, as lowercase hex.
          NONCE_PATTERN: /^[0-9a-f]{32}$/,
          // A lowercase hex HMAC-SHA256.
          MAC_PATTERN: /^[0-9a-f]{64}$/
        };
        var SUMMARY_VERSION = 1;
        var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
        function isSafeId(value) {
          return typeof value === "string" && SAFE_ID.test(value);
        }
        var ROUTES = [
          {
            name: "health",
            method: "GET",
            path: BASE + "/health",
            auth: AUTH.NONE,
            mutating: false,
            why: "liveness and version only, so `add` can tell a helper that is up from one that is not",
            response: "{ok, version, api, service_contract, started_at, catalog_seen_at}"
          },
          {
            name: "events.append",
            method: "POST",
            path: BASE + "/events",
            auth: AUTH.REVIEW_TOKEN,
            mutating: true,
            why: "the library posts each event as it happens and re-posts anything unacknowledged on reconnect",
            request: "{review, events: [event...]}",
            response: "{accepted: [event_id...], seq}"
          },
          {
            name: "library.get",
            method: "GET",
            path: "/lahe-layer.js",
            auth: AUTH.NONE,
            mutating: false,
            why: "the helper serves the built library, so the script line can be an absolute URL that works from any folder. Unauthenticated on purpose: these are the tool's own public bytes, the same file that ships in the repo, with no review data and no token in them. It is exempt the same visible way health is, through AUTH.NONE",
            response: "the built library, as application/javascript"
          },
          {
            name: "review.write",
            method: "POST",
            path: BASE + "/review",
            auth: AUTH.REVIEW_TOKEN,
            mutating: true,
            why: "what `add` calls for a review the helper already holds: the helper applies the writes itself, so `add` never has to stop a helper that is holding somebody's live review. Its origins are DELIBERATELY NARROWER than what `add` may write to disk: only \"null\" and loopback http/https pass (isRegisterableOrigin), capped at ORIGIN_LIMIT per review. A body-supplied origin is the one way a script on an allowed page could widen the allowlist with a token it read off the script tag, which would leave the token as the only factor guarding the review. only_recorded_pages is accepted as true and never as false, for the same reason: narrowing a review to the pages it recorded is the reviewer's `--only`, and widening one back out is what a leaked token would ask for. notes is accepted as true and never as false, the same way: it marks a `lahe write` notes review, whose long sittings are not proofread (acceptsNotesFlag)",
            request: "{review, origins: [origin...], target_path?, source_path?, source_hint?, page_path?, only_recorded_pages?: true, notes?: true}",
            response: "{origins, recorded_source, recorded_paths, only_recorded_pages, seq}"
          },
          {
            name: "review.read",
            method: "GET",
            path: BASE + "/review",
            auth: AUTH.REVIEW_TOKEN,
            mutating: false,
            why: "the projection the library reconciles against on load and on every reconnect",
            request: "?review=<id>",
            response: "the review.json projection, plus {seq}"
          },
          {
            name: "records.read",
            method: "GET",
            path: BASE + "/records",
            auth: AUTH.REVIEW_TOKEN,
            mutating: false,
            why: "stable addresses, V31: the records this review holds for the asking page, whole, so a comment made at the page's old 127.0.0.1:<port> address shows at its new one. review.read is the projection, which drops the anchor fields a card needs. Only this review, only this page (its own address, the old origins of its site, and for a Markdown review the rendered file's old path), and never a draft. The page's Origin must be a site address; any other gets an empty list",
            request: "?review=<id>&page_path=<location.pathname>",
            response: "{records: [record...], seq}"
          },
          {
            name: "replies.poll",
            method: "GET",
            path: BASE + "/replies",
            auth: AUTH.REVIEW_TOKEN,
            mutating: false,
            why: "the library's reply poll loop. The cursor is a seq, never a timestamp and never an offset. It also carries the reviewed file's mtime, which is R36's refresh trigger for a static page: a changed value means the agent rebuilt the page and the library reloads it",
            request: "?review=<id>&since=<seq>&page_path=<location.pathname>",
            response: "{events: [event...], seq, target_mtime, stamp_carriable, agent_liveness}; target_mtime is the requesting page's ISO mtime, or null when its retained target cannot be identified or the file is missing. stamp_carriable says whether the SOURCE behind this page could hold a data-lahe-id attribute at all: false for a Markdown or plain-text source, which is what stops the page check asking an agent for an id that source cannot carry. agent_liveness is {state, unanswered, oldest_unanswered_at, last_reply_at, listening, monitor_at, activity_at}: how long it has been since the agent answered, read off the review's own replies and the owning session's files rather than taken from anything the agent said"
          },
          {
            name: "window.claim",
            method: "POST",
            path: BASE + "/window",
            auth: AUTH.REVIEW_TOKEN,
            mutating: true,
            why: "D5's second-window refusal for windows that cannot see each other's storage, plus the takeover",
            request: "{review, window_id, session_secret?, takeover?, quiet?}",
            response: "grant {granted:true, since, heartbeat_seconds, quiet_heartbeat_seconds, took_over, session_secret}; refusal {granted:false, since, heartbeat_seconds, quiet_heartbeat_seconds, reason, deposed} (no holder id, no secret). quiet:true on a claim says nobody is looking at that window, so it beats every quiet_heartbeat_seconds and the helper holds it for a longer window. deposed is true only when the refused window is the one an explicit Review-here-instead threw out, which is the one refusal the page acts on immediately; every other refusal it waits out, because a helper being replaced looks the same from there"
          },
          {
            name: "window.release",
            method: "POST",
            path: BASE + "/window/release",
            auth: AUTH.REVIEW_TOKEN,
            mutating: true,
            why: "the holder saying goodbye on its way out, so a reload does not have to wait out the staleness clock against its own outgoing page and tell the reviewer their review is open in another window",
            request: "{review, session_secret}",
            // The secret is the proof, exactly as it is on a heartbeat: without it
            // this would let any window that can name a review evict the real holder.
            response: "{released}"
          },
          {
            name: "review.end",
            method: "POST",
            path: BASE + "/end",
            auth: AUTH.REVIEW_TOKEN,
            mutating: true,
            why: "the reviewer chooses End review on the rail; the review is archived, never truncated",
            request: "{review}",
            // outstanding_kept is how many items are still READY, counted through the
            // projection. It used to be the length of the event log, which made a
            // ten-comment review report hundreds.
            response: "{ended_at, outstanding_kept}"
          }
        ];
        var CATALOG_PAGE_PATH = "/catalog";
        var CATALOG_API_BASE = BASE + "/catalog";
        var CATALOG_ROUTES = [
          {
            name: "catalog.page",
            method: "GET",
            path: CATALOG_PAGE_PATH,
            auth: AUTH.CATALOG_TOKEN,
            mutating: false,
            // top_level_navigation: any top-level navigation opens the page, from any
            // site: a link in a document or an email, a bookmark, a typed address.
            // That is Sec-Fetch-Mode navigate with Sec-Fetch-Dest document, whatever
            // Sec-Fetch-Site says, or a request with no Sec-Fetch headers at all. A
            // cross-site navigation cannot read the page it loads. The page sends
            // X-Frame-Options DENY, frame-ancestors 'none' and a same-origin
            // Cross-Origin-Opener-Policy, so it can be neither framed nor scripted by
            // its opener, and no script on it reads its own URL. A fetch or an
            // iframe asking for it is still refused.
            checks: { sec_fetch_site: ["none", "same-origin"], top_level_navigation: true, token: false, json_body: false, origin: null },
            why: "the Library page itself, with the Library token in its meta tag",
            response: "text/html"
          },
          {
            name: "catalog.asset",
            method: "GET",
            path: CATALOG_PAGE_PATH + "/assets/",
            prefix: true,
            auth: AUTH.CATALOG_TOKEN,
            mutating: false,
            checks: { sec_fetch_site: ["none", "same-origin"], token: false, json_body: false, origin: null },
            why: "the page's script, view model, protocol.js, the style bundle and the fonts, served raw from src/ from a fixed allowlist. Any other name is a 404 with no file bytes",
            request: "<allowlisted name> after the path",
            response: "the file"
          },
          {
            name: "catalog.list",
            method: "GET",
            path: CATALOG_API_BASE + "/list",
            auth: AUTH.CATALOG_TOKEN,
            mutating: false,
            checks: { sec_fetch_site: ["same-origin"], token: true, json_body: false, origin: null },
            why: "every review, grouped by session. Only an authenticated list updates catalog_seen_at",
            response: "{attached, sessions: [...]}"
          },
          {
            name: "catalog.open",
            method: "POST",
            path: CATALOG_API_BASE + "/open",
            auth: AUTH.CATALOG_TOKEN,
            mutating: true,
            checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" },
            why: "restart a review's recorded server and return its URL; never serves a path the helper did not serve before",
            request: "{review, handoff, confirmed}",
            response: "{url, request_id, not_asked}"
          },
          {
            name: "catalog.star",
            method: "POST",
            path: CATALOG_API_BASE + "/star",
            auth: AUTH.CATALOG_TOKEN,
            mutating: true,
            checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" },
            why: "star or unstar a review in catalog.json",
            request: "{review, starred}",
            response: "{review, starred}"
          },
          {
            name: "catalog.rename",
            method: "POST",
            path: CATALOG_API_BASE + "/rename",
            auth: AUTH.CATALOG_TOKEN,
            mutating: true,
            checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" },
            why: "the reviewer's own name for a review, in catalog.json; empty clears it. Display text for the Library only, never in an agent's input",
            request: "{review, name}",
            response: "{review, name}"
          },
          {
            name: "catalog.request",
            method: "POST",
            path: CATALOG_API_BASE + "/request",
            auth: AUTH.CATALOG_TOKEN,
            mutating: true,
            checks: { sec_fetch_site: ["same-origin"], token: true, json_body: true, origin: "exact" },
            why: "queue a pick-up or a launch for the attached agent. Ids only; extra body fields are dropped",
            request: "{review, action, confirmed}",
            response: "{request_id}"
          }
        ];
        var CATALOG_TOKEN_META = "lahe-catalog-token";
        var PAGES = {
          PORT: 1483,
          // Tests (and a person who needs another port) set this; 0 means any.
          PORT_ENV: "LAHE_PAGES_PORT",
          SUFFIX: "lahe.localhost",
          PRINTED_ENDING: "lahe.localhost",
          // Why: what `lahe status` and the start log line say about the ending.
          PRINTED_ENDING_REASON: "every browser treats .localhost names as this computer and as secure, with no setup",
          PORT_FREE_OFF_REASON: "the port-80 forward is not set up",
          LAHE_NAMES_OFF_REASON: "the .lahe option is not set up",
          LIBRARY_NAME: "library",
          MAX_LABELS: 4,
          LABEL_MAX: 63,
          NAME_MAX: 150,
          RESERVED_NAMES: ["library", "lahe", "www", "api"],
          // service.json's pages.mode: the helper serves pages itself. The only mode.
          MODE_SITES: "sites",
          // Every page response carries this, so another website cannot embed it.
          CORP: "same-origin"
        };
        function isSiteLabel(value) {
          if (typeof value !== "string" || !value || value.length > PAGES.LABEL_MAX) return false;
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return false;
          if (value.slice(0, 4) === "xn--" || value.slice(2, 4) === "--") return false;
          return true;
        }
        function isSiteName(value) {
          if (typeof value !== "string" || !value || value.length > PAGES.NAME_MAX) return false;
          var labels = value.split(".");
          if (labels.length > PAGES.MAX_LABELS) return false;
          return labels.every(isSiteLabel);
        }
        var HOST_FAMILY = { API: "api", LIBRARY: "library", PAGE: "page", BAD: "bad" };
        var SITE_HOST = /^([a-z0-9.-]+)\.lahe\.localhost(?::(\d{1,5}))?$/;
        var SHORT_HOST = /^([a-z0-9.-]+)\.lahe(?::(\d{1,5}))?$/;
        function classifyHost(hostHeader, options) {
          var opts = options || {};
          if (typeof hostHeader !== "string" || !hostHeader) return { family: HOST_FAMILY.BAD };
          if (hostAllowed(hostHeader)) return { family: HOST_FAMILY.API };
          var match = SITE_HOST.exec(hostHeader);
          if (!match) {
            var short = opts.laheNames === true ? SHORT_HOST.exec(hostHeader) : null;
            if (!short || short[1] === PAGES.LIBRARY_NAME || !isSiteName(short[1])) return { family: HOST_FAMILY.BAD };
            if (short[2] !== void 0 && Number(short[2]) !== opts.pagesPort) return { family: HOST_FAMILY.BAD };
            return { family: HOST_FAMILY.PAGE, name: short[1] };
          }
          var name = match[1];
          if (match[2] !== void 0 && Number(match[2]) !== opts.pagesPort) return { family: HOST_FAMILY.BAD };
          if (name === PAGES.LIBRARY_NAME) return { family: HOST_FAMILY.LIBRARY, name };
          if (!isSiteName(name)) return { family: HOST_FAMILY.BAD };
          return { family: HOST_FAMILY.PAGE, name };
        }
        function siteOrigin(name, port) {
          return "http://" + name + "." + PAGES.SUFFIX + (port === 80 ? "" : ":" + port);
        }
        function siteNameFromOrigin(origin, pagesPort, laheNames) {
          if (typeof origin !== "string") return null;
          var match = /^http:\/\/([a-z0-9.-]+)\.lahe\.localhost(?::(\d{1,5}))?$/.exec(origin) || (laheNames === true ? /^http:\/\/([a-z0-9.-]+)\.lahe(?::(\d{1,5}))?$/.exec(origin) : null);
          if (!match || !isSiteName(match[1]) || match[1] === PAGES.LIBRARY_NAME) return null;
          return match[2] === void 0 || Number(match[2]) === pagesPort ? match[1] : null;
        }
        var SITE_ROUTES = [
          {
            name: "site.bind",
            method: "POST",
            path: BASE + "/site/bind",
            auth: AUTH.CLI_SECRET,
            mutating: true,
            why: "lahe review and lahe write bind a review to a site: find or make the site's name for a root the CLI names, record its mounts and linked files, stamp the review as re-served, and drop the review's old loopback origins. CLI-only: the CLI secret, and any request carrying an Origin header is refused, so a page holding a review token can neither name a file nor move a rail",
            request: '{review, root, mode: "folder"|"page-only", entry, mounts?: {prefix: dir}, linked?: [file]}',
            response: "{name, origin, url, printed_ending}"
          },
          {
            name: "review.retire",
            method: "POST",
            path: BASE + "/review/retire",
            auth: AUTH.CLI_SECRET,
            mutating: true,
            why: "lahe review retire ends a review on purpose, so `lahe review` of its file makes a new one. Only the owning agent session may retire its review. A retired review no longer answers on any page, fails the Origin check, and takes no events. CLI-only, like site.bind",
            request: "{review, session}",
            response: "{review, retired_at}"
          }
        ];
        var SUMMARY_ROUTES = [
          {
            name: "summary.read",
            method: "GET",
            path: BASE + "/summary",
            auth: AUTH.CLI_PROOF,
            mutating: false,
            why: "the menu bar app's poll: what is waiting on the reviewer, what is waiting on agents, open documents, connected sessions and recent documents, with titles and ~ paths and never comment text. ?v=<summary_version>",
            response: "docs/CONTRACTS.md, the summary.read table; test/fixtures/menubar/summary.json"
          },
          {
            name: "summary.open",
            method: "POST",
            path: BASE + "/summary/open",
            auth: AUTH.CLI_PROOF,
            mutating: true,
            refuse_origin: true,
            why: "a click on a menu row: the address catalog Open would use, found with no hand-off, so it never queues a request for an agent",
            request: "{review, summary_version}",
            response: "{url} or {url: null} for a row only an agent can serve"
          }
        ];
        function route(name) {
          var lists = [ROUTES, CATALOG_ROUTES, SITE_ROUTES, SUMMARY_ROUTES];
          for (var l = 0; l < lists.length; l += 1) {
            for (var i = 0; i < lists[l].length; i += 1) {
              if (lists[l][i].name === name) return lists[l][i];
            }
          }
          throw new Error("unknown route: " + String(name) + ". Routes are listed in src/shared/protocol.js");
        }
        var HEALTH_FIELD = {
          // The time of the last authenticated catalog.list, or null. `lahe session
          // close` reads it to decide whether the Library keeps the helper up.
          CATALOG_SEEN_AT: "catalog_seen_at"
        };
        function requiredHeaders(routeName) {
          var r = route(routeName);
          var out = [];
          if (r.auth === AUTH.NONE) return out;
          out.push({ header: HEADER.CLIENT, value: "layer or cli", why: "a custom header cannot ride on a CORS-simple request" });
          out.push({ header: HEADER.TOKEN, value: "<per-review token>", why: "the per-review credential (D11)" });
          if (r.mutating) {
            out.push({ header: HEADER.CONTENT_TYPE, value: JSON_CONTENT_TYPE, why: "a JSON content type forces a preflight" });
          }
          return out;
        }
        var CHECK = {
          HOST: "host",
          CUSTOM_HEADER: "custom_header",
          CONTENT_TYPE: "content_type",
          REVIEW_KNOWN: "review_known",
          TOKEN: "token",
          ORIGIN: "origin",
          // Catalog routes only (see CATALOG_ROUTES[].checks.sec_fetch_site).
          SEC_FETCH_SITE: "sec_fetch_site",
          // The summary routes only (AUTH.CLI_PROOF).
          SEC_FETCH: "sec_fetch",
          PROOF: "proof"
        };
        var CHECKS = [
          {
            name: CHECK.HOST,
            code: "PROTO_BAD_HOST",
            why: "the Host header must name the helper itself, or a rebound DNS name reaches a handler with the browser's help"
          },
          {
            name: CHECK.CUSTOM_HEADER,
            code: "PROTO_MISSING_CUSTOM_HEADER",
            why: "a form post or an img tag cannot set a custom header, so requiring one refuses every CORS-simple write"
          },
          {
            name: CHECK.CONTENT_TYPE,
            code: "PROTO_UNSUPPORTED_MEDIA_TYPE",
            why: "mutating routes take JSON only, which is not a content type a simple request can send"
          },
          {
            name: CHECK.REVIEW_KNOWN,
            code: "PROTO_UNKNOWN_REVIEW",
            why: "an unknown review id has no token to check against, so it is refused rather than defaulted"
          },
          {
            name: CHECK.TOKEN,
            code: "PROTO_UNAUTHORIZED",
            why: "the per-review token, compared in full. Absent configuration fails closed"
          },
          {
            name: CHECK.ORIGIN,
            code: "PROTO_FORBIDDEN_ORIGIN",
            why: "the origin comes from the request's own header, never from its body, and must be one the add step registered"
          },
          {
            name: CHECK.SEC_FETCH_SITE,
            code: "PROTO_CROSS_SITE",
            why: "catalog routes only. A document under review on another loopback port sends same-site, and it is the page most likely to run a script the reviewer did not write, so the Library's API takes exactly same-origin"
          },
          {
            name: CHECK.SEC_FETCH,
            code: "AUTH_REFUSED",
            why: "summary routes only. Current browsers send Sec-Fetch-Site, -Mode or -Dest on every request to a loopback address and the menu bar app sends none, so any of them means a page is asking"
          },
          {
            name: CHECK.PROOF,
            code: "AUTH_REFUSED",
            why: "summary routes only. A request signed with the CLI secret, within the window, with a nonce not seen in it, compared in constant time. The raw secret header is refused: it must never travel"
          }
        ];
        function checkNamed(name) {
          for (var i = 0; i < CHECKS.length; i += 1) {
            if (CHECKS[i].name === name) return CHECKS[i];
          }
          throw new Error("unknown check: " + String(name));
        }
        function tokensEqual(a, b) {
          var max = Math.max(a.length, b.length);
          var diff = a.length === b.length ? 0 : 1;
          for (var i = 0; i < max; i += 1) {
            diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
          }
          return diff === 0;
        }
        function headerOf(headers, name) {
          if (!headers) return null;
          if (Object.prototype.hasOwnProperty.call(headers, name)) return headers[name];
          var lower = String(name).toLowerCase();
          var keys = Object.keys(headers);
          for (var i = 0; i < keys.length; i += 1) {
            if (keys[i].toLowerCase() === lower) return headers[keys[i]];
          }
          return null;
        }
        function hostAllowed(hostHeader) {
          if (typeof hostHeader !== "string" || !hostHeader) return false;
          var name = hostHeader.replace(/:\d+$/, "");
          return ALLOWED_HOST_NAMES.indexOf(name) !== -1;
        }
        function checkRequest(request, config) {
          var req = request || {};
          var r = route(req.routeName);
          var headers = req.headers || {};
          function refuse(name, detail) {
            var c = checkNamed(name);
            return {
              ok: false,
              check: name,
              code: c.code,
              log: "refused " + r.name + ": check " + name + " failed" + (detail ? " (" + detail + ")" : "")
            };
          }
          if (!hostAllowed(headerOf(headers, HEADER.HOST))) {
            return refuse(CHECK.HOST, String(headerOf(headers, HEADER.HOST)));
          }
          if (r.auth === AUTH.NONE) {
            return { ok: true, review: null, origin: headerOf(headers, HEADER.ORIGIN) || null };
          }
          if (CLIENTS.indexOf(headerOf(headers, HEADER.CLIENT)) === -1) {
            return refuse(CHECK.CUSTOM_HEADER, null);
          }
          if (r.mutating) {
            var ct = String(headerOf(headers, HEADER.CONTENT_TYPE) || "").split(";")[0].trim().toLowerCase();
            if (ct !== JSON_CONTENT_TYPE) return refuse(CHECK.CONTENT_TYPE, ct || "none");
          }
          var reviews = config && config.reviews || null;
          var reviewId = req.review;
          if (!reviews || !isSafeId(reviewId) || !Object.prototype.hasOwnProperty.call(reviews, reviewId)) {
            return refuse(CHECK.REVIEW_KNOWN, String(reviewId));
          }
          var registered = reviews[reviewId];
          var presented = headerOf(headers, HEADER.TOKEN);
          if (!registered.token || typeof presented !== "string" || !tokensEqual(presented, registered.token)) {
            return refuse(CHECK.TOKEN, null);
          }
          var origin = headerOf(headers, HEADER.ORIGIN);
          var allowed = registered.origins || [];
          var effective = origin === null || origin === void 0 || origin === "" ? "null" : String(origin);
          if (allowed.indexOf(effective) === -1) return refuse(CHECK.ORIGIN, effective);
          return { ok: true, review: reviewId, origin: effective };
        }
        var STATUS_FOR_CODE = {
          PROTO_BAD_REQUEST: 400,
          PROTO_BAD_HOST: 400,
          PROTO_MISSING_CUSTOM_HEADER: 400,
          PROTO_UNSUPPORTED_MEDIA_TYPE: 415,
          PROTO_UNAUTHORIZED: 401,
          PROTO_FORBIDDEN_ORIGIN: 403,
          PROTO_UNKNOWN_REVIEW: 404,
          PROTO_UNKNOWN_ITEM: 404,
          PROTO_STALE_REV: 409,
          // A review retired on purpose (`lahe review retire`) takes no events.
          PROTO_REVIEW_RETIRED: 410,
          // `lahe review retire` of a review another agent session owns.
          PROTO_NOT_OWNER: 403,
          PROTO_SECOND_WINDOW: 409,
          PROTO_SECOND_INSTANCE: 409,
          // The Library's codes. Messages and remedies are in failures.js, like every
          // other code; the page shows the remedy.
          PROTO_CROSS_SITE: 403,
          PROTO_NOT_OPENABLE: 409,
          PROTO_REQUEST_PENDING: 409,
          PROTO_QUEUE_FULL: 429,
          PROTO_NO_AGENT: 409,
          PROTO_CONFIRM_NEEDED: 409,
          PROTO_NO_LAUNCH: 409,
          PROTO_CATALOG_UNREADABLE: 500,
          // The summary routes' two refusals, both signed.
          AUTH_REFUSED: 401,
          SUMMARY_VERSION: 409
        };
        function statusFor(code) {
          return Object.prototype.hasOwnProperty.call(STATUS_FOR_CODE, code) ? STATUS_FOR_CODE[code] : 500;
        }
        function errorBody(code, detail, requestId, check) {
          var f = failures.failure(code, detail);
          return {
            error: {
              code: f.code,
              message: f.message,
              remedy: f.remedy,
              detail: f.detail,
              check: check || null,
              request_id: requestId || null
            }
          };
        }
        var CATALOG = {
          // An unanswered request expires.
          REQUEST_EXPIRY_MS: 30 * 60 * 1e3,
          // A Library poll this recent keeps the helper up when the last session closes.
          LIBRARY_SEEN_MS: 2 * 60 * 1e3,
          // The Library calls an agent "working" when its monitor is not live but it
          // ran a lahe command this recently. Past it, and with no live monitor, the
          // card says only when the agent was last active, and Open does not ask
          // before a hand-over. Much shorter than AGENT_LIVENESS.RECENT_COMMAND_MS on
          // purpose: that window only withholds an accusation on the rail, while
          // this one decides whether a person is told another agent has the session.
          WORKING_MS: 2 * 60 * 1e3,
          // A session bare `lahe library` started closes once it owns no reviews and
          // its agent has been quiet this long (no live monitor, no lahe command).
          LIBRARY_SESSION_IDLE_MS: 30 * 60 * 1e3,
          // session.json's `created_by` on a session bare `lahe library` started.
          // Written by the CLI when it creates the session; the helper only reads it.
          CREATED_BY_LIBRARY: "library",
          // Pending requests across the whole Library.
          QUEUE_CAP: 5,
          // The largest review log the reader will re-project.
          REPROJECT_MAX_BYTES: 5 * 1024 * 1024,
          // The page's poll, and how long a server probe is cached.
          POLL_MS: 15e3,
          // How long an answer stays on its row.
          ANSWER_SHOWN_MS: 24 * 60 * 60 * 1e3,
          // The longest answer `lahe library answer` accepts, in characters.
          ANSWER_TEXT_MAX: 500,
          // Sessions active this recently are open in the default view.
          DEFAULT_VIEW_DAYS: 7,
          // Reviews created before this instant (midnight US Eastern, 2026-09-17)
          // can fold into one row per folder.
          FOLD_CUTOFF: "2026-09-17T04:00:00Z"
        };
        function CATALOG_LEGACY_NOTE(reviewId) {
          return "It belongs to no session. Serving it takes review " + reviewId + " into your session, with its old comments; drain it for any still waiting.";
        }
        var CATALOG_LOG = {
          PREFIX: "catalog",
          ACTION: { OPEN: "open", STAR: "star", UNSTAR: "unstar", PICKUP: "pickup", LAUNCH: "launch" },
          FORMAT: "catalog <action> review=<id> age_days=<n>"
        };
        function catalogLogLine(action, reviewId, ageDays) {
          return CATALOG_LOG.PREFIX + " " + String(action) + " review=" + String(reviewId) + " age_days=" + String(ageDays);
        }
        var EVENT = {
          REVIEW_CREATED: "review.created",
          ORIGIN_REGISTERED: "origin.registered",
          // {origin}. A restarted static server's earlier loopback origins, and only
          // those, are removed. Recovery applies it in order with origin.registered,
          // so a removed origin stays removed after a helper restart.
          ORIGIN_REMOVED: "origin.removed",
          PAGE_VISITED: "page.visited",
          ITEM_CREATED: "item.created",
          // Every content change, INCLUDING every draft keystroke batch. This is the
          // event the flush policy below governs.
          ITEM_CONTENT: "item.content",
          ITEM_READY: "item.ready",
          ITEM_DELETED: "item.deleted",
          ITEM_REOPENED: "item.reopened",
          // {item, rev}. The reviewer marked the item done themselves ("Mark as
          // done"). An explicit act at one revision, never a state claim: it carries
          // no record, and the projection applies it only when the item is still
          // outstanding at exactly that revision (lifecycle.canClose).
          ITEM_CLOSED: "item.closed",
          // {item, stamp}. The rail marked an agent reply read (its card was
          // opened), naming the reply by record.replyStamp. No record, and not a
          // lifecycle move: the projection records it on the item as reply_seen only
          // when it names the item's current reply, and no agent acts on it.
          REPLY_SEEN: "reply.seen",
          REPLY_FOLDED: "reply.folded",
          REPLY_REJECTED: "reply.rejected",
          REVIEW_ARCHIVED: "review.archived",
          // {agent_session_id}. A review from before sessions (owner "legacy") was
          // taken into an agent session, once, by a Library pick-up. It belongs to
          // that session from here on. A review with a real session is never adopted.
          REVIEW_ADOPTED: "review.adopted"
        };
        CATALOG.NOT_WORK_EVENTS = [
          EVENT.ORIGIN_REGISTERED,
          EVENT.ORIGIN_REMOVED,
          EVENT.PAGE_VISITED,
          EVENT.REVIEW_ADOPTED,
          EVENT.REPLY_SEEN
        ];
        var EVENT_TYPES = Object.keys(EVENT).map(function(k) {
          return EVENT[k];
        });
        var EVENT_FIELD = {
          EVENT: "event",
          EVENT_ID: "event_id",
          TS: "ts",
          SEQ: "seq",
          REVIEW: "review",
          ITEM: "item",
          REV: "rev",
          PAGE_PATH: "page_path",
          PAGE_TITLE: "page_title",
          PAGE_SEQ: "page_seq",
          SOURCE_HINT: "source_hint",
          // WHEN THE HELPER TOOK THE EVENT IN, by the helper's own clock. The helper
          // stamps it at append and overwrites anything a client sent under this
          // name, so it is the one time on an event a page cannot choose. `ts` is
          // when the browser made the event, which for a held comment can be most of
          // an hour before anyone could have seen it (Hold queues the event in the
          // browser, docs/features/20260917.01_hold_toggle); the waiting clock on the
          // rail starts here instead, so releasing Hold never trips the overdue alert
          // at once (board row LAHE-held-release-waiting-clock).
          RECEIVED_AT: "received_at"
        };
        var IDEMPOTENCE_KEY = EVENT_FIELD.EVENT_ID;
        function newEvent(input) {
          var src = input || {};
          if (EVENT_TYPES.indexOf(src.event) === -1) {
            throw new Error("newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got " + String(src.event));
          }
          if (typeof src.event_id !== "string" || !src.event_id) {
            throw new Error("newEvent: event_id is required and is client-minted; idempotence is by event_id");
          }
          if (!isSafeId(src.review)) {
            throw new Error("newEvent: review must be a safe id, got " + String(src.review));
          }
          var e = {};
          e[EVENT_FIELD.EVENT] = src.event;
          e[EVENT_FIELD.EVENT_ID] = src.event_id;
          e[EVENT_FIELD.TS] = src.ts || (/* @__PURE__ */ new Date()).toISOString();
          e[EVENT_FIELD.SEQ] = typeof src.seq === "number" ? src.seq : null;
          e[EVENT_FIELD.REVIEW] = src.review;
          e[EVENT_FIELD.ITEM] = src.item || null;
          e[EVENT_FIELD.REV] = typeof src.rev === "number" ? src.rev : null;
          e[EVENT_FIELD.PAGE_PATH] = src.page_path || null;
          e[EVENT_FIELD.PAGE_TITLE] = src.page_title || null;
          e[EVENT_FIELD.PAGE_SEQ] = typeof src.page_seq === "number" ? src.page_seq : null;
          e[EVENT_FIELD.SOURCE_HINT] = src.source_hint || null;
          if (src.payload && typeof src.payload === "object") {
            Object.keys(src.payload).forEach(function(k) {
              if (!Object.prototype.hasOwnProperty.call(e, k)) e[k] = src.payload[k];
            });
          }
          return e;
        }
        function encodeEventLine(event) {
          return JSON.stringify(event) + "\n";
        }
        function parseEventLine(line) {
          var parsed;
          try {
            parsed = JSON.parse(line);
          } catch (err) {
            return { ok: false, reason: "not JSON: " + err.message };
          }
          if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not an object" };
          if (EVENT_TYPES.indexOf(parsed[EVENT_FIELD.EVENT]) === -1) {
            return { ok: false, reason: "unknown event type " + String(parsed[EVENT_FIELD.EVENT]) };
          }
          if (typeof parsed[EVENT_FIELD.EVENT_ID] !== "string" || !parsed[EVENT_FIELD.EVENT_ID]) {
            return { ok: false, reason: "missing event_id, which is the idempotence key" };
          }
          return { ok: true, event: parsed };
        }
        var FLUSH = {
          // Synchronous, every keystroke, no debounce. A reload, a crash, or a sleep
          // costs nothing.
          TO_BROWSER_STORAGE: "every keystroke, synchronously",
          // To the helper within 750ms of being queued.
          HELPER_DEBOUNCE_MS: 750,
          // An item whose queued events are ALL drafts goes to the helper at most
          // once per this long (spec 20260922.01, requirement 4). The browser already
          // has every keystroke; the helper copy is a crash backup, and a few seconds
          // of it is an acceptable loss (Ken, 2026-09-22). It is a deadline from the
          // item's last draft post, not a timer that typing pushes back. The poll
          // loop cannot get round it either: flush itself applies it.
          DRAFT_FLOOR_MS: 1e4,
          // A free-writing run record's drafts carry the whole run, so they wait
          // longer (docs/features/20260928.01_free_writing). A commit is never held.
          RUN_DRAFT_FLOOR_MS: 3e4,
          // Choice buttons (docs/features/20261013.01_choice_buttons): every event of
          // a choice item waits until this long after the page's last press, so
          // presses made close together reach the helper in one post and wake the
          // agent once. Capped at PRESS_CAP_MS from the first held press, so steady
          // clicking cannot hold work back for minutes. Hiding the tab and leaving
          // the page flush at once, as for drafts; Hold's gate still applies.
          PRESS_QUIET_MS: 3e3,
          PRESS_CAP_MS: 1e4,
          // Plus an immediate flush on each of these, with no debounce and no draft
          // floor. `hide` is the tab being hidden, which is often the last thing a
          // page hears before the browser discards it.
          IMMEDIATE_ON: ["blur", "hide", "ready", "navigation", "unload"],
          // THE UNLOAD POST USES fetch(..., {keepalive: true}), NEVER sendBeacon.
          // sendBeacon cannot set the custom header D11 requires and cannot set the
          // JSON content type, so the obvious tool either drops the header (silently
          // breaking "no exceptions") or watches the post get refused during unload,
          // when nothing is watching.
          TRANSPORT_ON_UNLOAD: "fetch keepalive",
          SEND_BEACON_IS_FORBIDDEN: true,
          // Keepalive carries headers at the cost of a body limit of roughly 64KB
          // across all in-flight keepalive requests.
          KEEPALIVE_MAX_BYTES: 64 * 1024,
          // An edit too large for that is already safe in browser storage and goes to
          // the helper on the next load, so the cap costs latency, never work.
          OVERSIZE_FALLBACK: "leave it in browser storage; post it on the next load"
        };
        function byteLength(text) {
          var s = String(text === null || text === void 0 ? "" : text);
          if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
          return Buffer.byteLength(s, "utf8");
        }
        function fitsKeepalive(body) {
          return byteLength(typeof body === "string" ? body : JSON.stringify(body)) <= FLUSH.KEEPALIVE_MAX_BYTES;
        }
        var REPLY_FIELD = {
          ITEM: "item",
          REV: "rev",
          STATUS: "status",
          AGENT: "agent",
          REASON: "reason",
          TEXT: "text",
          FILES: "files",
          NEEDS_SEE: "user_needs_to_see_reply",
          // A proofread question on a long hand-written run: the agent placed the
          // words as written and lists fixes as {block, from, to}, block being the
          // index in new_blocks. Accepted on a question only.
          PROOFREAD: "proofread",
          SUGGESTIONS: "suggestions"
        };
        function acceptsNotesFlag(body) {
          return !!body && body.notes === true;
        }
        var SUGGESTIONS_MAX = 400;
        var SUGGESTION_TEXT_MAX = 2e5;
        function suggestionsProblem(list) {
          if (!Array.isArray(list)) return "suggestions must be a list";
          if (list.length > SUGGESTIONS_MAX) return "suggestions holds " + list.length + " fixes, more than " + SUGGESTIONS_MAX;
          for (var i = 0; i < list.length; i += 1) {
            var s = list[i];
            if (!s || typeof s !== "object" || Array.isArray(s)) return "suggestion " + i + " must be an object";
            if (!Number.isInteger(s.block) || s.block < 0) return "suggestion " + i + " block must be a whole number from 0";
            if (typeof s.from !== "string" || !s.from) return "suggestion " + i + " from must be a non-empty string";
            if (typeof s.to !== "string") return "suggestion " + i + " to must be a string";
            if (s.from.length > SUGGESTION_TEXT_MAX || s.to.length > SUGGESTION_TEXT_MAX) return "suggestion " + i + " from or to is over " + SUGGESTION_TEXT_MAX + " characters";
          }
          return null;
        }
        var REPLY_STATUS = { HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question" };
        var REPLY_STATUSES = [REPLY_STATUS.HANDLED, REPLY_STATUS.NOT_HANDLED, REPLY_STATUS.QUESTION];
        var REPLY_REQUIRED = {
          handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS],
          not_handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.REASON],
          question: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.TEXT]
        };
        var REPLY_FILE = {
          SINGLE: "replies.jsonl",
          PATTERN: /^replies(?:-([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?\.jsonl$/,
          prefix: "replies-",
          suffix: ".jsonl"
        };
        function agentFromFilename(filename) {
          var m = REPLY_FILE.PATTERN.exec(String(filename || ""));
          if (!m) return { ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl" };
          return { ok: true, agent: m[1] || null, reason: null };
        }
        function parseReplyLine(line, options) {
          var opts = options || {};
          var parsed;
          try {
            parsed = JSON.parse(line);
          } catch (err) {
            return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "not JSON: " + err.message };
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "a reply line must be a JSON object" };
          }
          var status = parsed[REPLY_FIELD.STATUS];
          if (REPLY_STATUSES.indexOf(status) === -1) {
            return {
              ok: false,
              code: "REPLY_LINE_MALFORMED",
              reason: "status must be one of " + REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(status)
            };
          }
          var missing = [];
          REPLY_REQUIRED[status].forEach(function(field) {
            var v = parsed[field];
            if (v === null || v === void 0 || v === "" || typeof v === "string" && !v.trim()) missing.push(field);
          });
          if (typeof parsed[REPLY_FIELD.ITEM] !== "string") missing.push(REPLY_FIELD.ITEM);
          if (typeof parsed[REPLY_FIELD.REV] !== "number") missing.push(REPLY_FIELD.REV);
          if (missing.length) {
            return {
              ok: false,
              code: "REPLY_LINE_MALFORMED",
              reason: "status " + status + " needs " + REPLY_REQUIRED[status].join(", ") + "; missing or wrong type: " + missing.join(", ")
            };
          }
          var marksProofread = parsed[REPLY_FIELD.PROOFREAD] !== void 0 || parsed[REPLY_FIELD.SUGGESTIONS] !== void 0;
          if (marksProofread) {
            if (status !== REPLY_STATUS.QUESTION) {
              return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "proofread and suggestions belong on a question reply only" };
            }
            if (parsed[REPLY_FIELD.PROOFREAD] !== true) {
              return { ok: false, code: "REPLY_LINE_MALFORMED", reason: "proofread must be true when suggestions are given" };
            }
            var problem = suggestionsProblem(parsed[REPLY_FIELD.SUGGESTIONS] === void 0 ? [] : parsed[REPLY_FIELD.SUGGESTIONS]);
            if (problem) return { ok: false, code: "REPLY_LINE_MALFORMED", reason: problem };
          }
          var agent = typeof parsed[REPLY_FIELD.AGENT] === "string" && parsed[REPLY_FIELD.AGENT] ? parsed[REPLY_FIELD.AGENT] : opts.filenameAgent || null;
          var reply = {};
          reply[REPLY_FIELD.ITEM] = parsed[REPLY_FIELD.ITEM];
          reply[REPLY_FIELD.REV] = parsed[REPLY_FIELD.REV];
          reply[REPLY_FIELD.STATUS] = status;
          reply[REPLY_FIELD.AGENT] = agent;
          reply[REPLY_FIELD.REASON] = typeof parsed[REPLY_FIELD.REASON] === "string" ? parsed[REPLY_FIELD.REASON] : null;
          reply[REPLY_FIELD.TEXT] = typeof parsed[REPLY_FIELD.TEXT] === "string" ? parsed[REPLY_FIELD.TEXT] : null;
          reply[REPLY_FIELD.FILES] = Array.isArray(parsed[REPLY_FIELD.FILES]) ? parsed[REPLY_FIELD.FILES].slice() : [];
          reply[REPLY_FIELD.NEEDS_SEE] = parsed[REPLY_FIELD.NEEDS_SEE] === true;
          if (marksProofread) {
            reply[REPLY_FIELD.PROOFREAD] = true;
            reply[REPLY_FIELD.SUGGESTIONS] = (parsed[REPLY_FIELD.SUGGESTIONS] || []).map(function(sg) {
              return { block: sg.block, from: sg.from, to: sg.to };
            });
          }
          return { ok: true, reply, reason: null };
        }
        var REPLY_POLL = {
          INTERVAL_MS: 5e3,
          // A file SHORTER than its recorded offset was truncated or rewritten rather
          // than appended to, so the offset resets to zero and the file is re-folded.
          // Safe, because folding is idempotent.
          RESET_ON_SHRINK: true,
          // A final line with no trailing newline is HELD until it completes, so a
          // torn write is never half-parsed.
          HOLD_TORN_FINAL_LINE: true
        };
        var REPLY_CURSOR_FIELD = EVENT_FIELD.SEQ;
        function nextReadOffset(recordedOffset, fileSize) {
          if (typeof fileSize !== "number" || fileSize < 0) throw new Error("nextReadOffset: fileSize must be a number");
          var offset = typeof recordedOffset === "number" && recordedOffset > 0 ? recordedOffset : 0;
          if (fileSize < offset) return { offset: 0, refold: true };
          return { offset, refold: false };
        }
        function splitCompleteLines(chunk) {
          var text = String(chunk || "");
          var lines = text.split("\n");
          var remainder = lines.pop();
          return { lines, remainder };
        }
        var SCRIPT_ATTR = {
          REVIEW: "data-lahe-review",
          TOKEN: "data-lahe-token",
          HELPER: "data-lahe-helper",
          FALLBACK: "data-lahe-fallback",
          FRAMES: "data-lahe-frames",
          START: "data-lahe-start",
          // A `lahe write` notes review (free writing, design call 2). The layer
          // reads it at boot, before the helper has answered anything, so an empty
          // notes page can open for typing and no other empty page does.
          NOTES: "data-lahe-notes",
          // Choice buttons (docs/features/20261013.01_choice_buttons): present on the
          // tag of a page the helper serves itself as a document, added at response
          // time and never written to disk. `lahe add` and heal never pass it. The
          // layer arms choice groups only when it is there.
          DOCUMENT: "data-lahe-document",
          // Stable addresses: the old page-server origins of this page's site, as a
          // JSON array. The layer reads a record made on one of them as made on this
          // page, so a review's old comments show at its new address. Written only by
          // the helper, from its own records (page_routes.aliasesFor).
          ALIASES: "data-lahe-aliases",
          // Stable addresses, V31: the old paths of this page, as a JSON array. Only
          // an old Markdown review has one: its page was the rendered file
          // (/<name>-<hash>.html), and its new address is the source (/doc.md). Read
          // only together with an old origin (record.samePage).
          PATH_ALIASES: "data-lahe-path-aliases",
          // Each page carries its own comments (Part 2): this page's other addresses
          // in the review that answers on it, as a JSON array of "origin path"
          // strings: a link address on another page's site, an old address. Written
          // only by the helper, from the review's own records (page_routes.spellingsFor).
          SPELLINGS: "data-lahe-spellings"
        };
        var LOOPBACK_PORT_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;
        function isLoopbackPortOrigin(value) {
          return typeof value === "string" && LOOPBACK_PORT_ORIGIN.test(value);
        }
        var ALIAS_MAX = 16;
        var PATH_ALIAS = /^\/[^"'<>\s\\]{0,511}$/;
        function isPathAlias(value) {
          return typeof value === "string" && PATH_ALIAS.test(value);
        }
        var SPELLING_ORIGIN = /^http:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/;
        function isSpellingOrigin(value) {
          return typeof value === "string" && SPELLING_ORIGIN.test(value);
        }
        function isSpelling(value) {
          if (typeof value !== "string") return false;
          var at = value.indexOf(" ");
          return at > 0 && isSpellingOrigin(value.slice(0, at)) && isPathAlias(value.slice(at + 1));
        }
        function spellingsAttribute(list) {
          if (!Array.isArray(list)) throw new Error("scriptTag: spellings must be a list");
          if (list.length > ALIAS_MAX) throw new Error("scriptTag: at most " + ALIAS_MAX + " spellings");
          list.forEach(function(one) {
            if (!isSpelling(one)) throw new Error('scriptTag: a spelling is "origin path", not ' + JSON.stringify(one));
          });
          return JSON.stringify(list).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        }
        function pathAliasesAttribute(paths) {
          if (!Array.isArray(paths)) throw new Error("scriptTag: pathAliases must be a list");
          if (paths.length > ALIAS_MAX) throw new Error("scriptTag: at most " + ALIAS_MAX + " path aliases");
          paths.forEach(function(one) {
            if (!isPathAlias(one)) throw new Error("scriptTag: a path alias must be an absolute path, not " + JSON.stringify(one));
          });
          return JSON.stringify(paths).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        }
        function aliasesAttribute(aliases) {
          if (!Array.isArray(aliases)) throw new Error("scriptTag: aliases must be a list");
          if (aliases.length > ALIAS_MAX) throw new Error("scriptTag: at most " + ALIAS_MAX + " aliases");
          aliases.forEach(function(alias) {
            if (!isLoopbackPortOrigin(alias)) {
              throw new Error("scriptTag: an alias must be a loopback http origin, not " + JSON.stringify(alias));
            }
          });
          return JSON.stringify(aliases).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        var FRAMES_ALLOW = "allow";
        var START_HIDDEN = "hidden";
        var NOTES_ON = "true";
        var DOCUMENT_ON = "true";
        var SCRIPT_FALLBACK_ONERROR = "var s=document.createElement('script');s.src=this.getAttribute('" + SCRIPT_ATTR.FALLBACK + "');document.head.appendChild(s)";
        var SCRIPT_SELECTOR = "script[" + SCRIPT_ATTR.REVIEW + "]";
        function scriptTag(options) {
          var o = options || {};
          if (!o.src) throw new Error("scriptTag: src is required (the path to the built library)");
          if (!isSafeId(o.review)) throw new Error("scriptTag: review must be a safe id");
          if (!o.token) throw new Error("scriptTag: token is required; absent configuration fails closed");
          var fallback = o.fallback ? "        " + SCRIPT_ATTR.FALLBACK + '="' + o.fallback + '"\n        onerror="' + SCRIPT_FALLBACK_ONERROR + '"\n' : "";
          return '<script src="' + o.src + '"\n        ' + SCRIPT_ATTR.REVIEW + '="' + o.review + '"\n        ' + SCRIPT_ATTR.TOKEN + '="' + o.token + '"\n        ' + SCRIPT_ATTR.HELPER + '="' + (o.helper || DEFAULT_HELPER_ORIGIN) + '"\n' + fallback + (o.notes === true ? "        " + SCRIPT_ATTR.NOTES + '="' + NOTES_ON + '"\n' : "") + (o.document === true ? "        " + SCRIPT_ATTR.DOCUMENT + '="' + DOCUMENT_ON + '"\n' : "") + (o.aliases !== void 0 ? "        " + SCRIPT_ATTR.ALIASES + '="' + aliasesAttribute(o.aliases) + '"\n' : "") + (o.pathAliases !== void 0 ? "        " + SCRIPT_ATTR.PATH_ALIASES + '="' + pathAliasesAttribute(o.pathAliases) + '"\n' : "") + (o.spellings !== void 0 ? "        " + SCRIPT_ATTR.SPELLINGS + '="' + spellingsAttribute(o.spellings) + '"\n' : "") + "        defer><\/script>";
        }
        var CLI_EXIT = {
          OK: 0,
          HELPER_UNREACHABLE: 2,
          UNKNOWN_REVIEW: 3,
          BAD_USAGE: 4,
          // The agent session is closed. Monitoring has ended; do not relaunch.
          SESSION_CLOSED: 5,
          // Another agent ran `lahe session takeover`. This monitor is fenced and the
          // work it was about to print belongs to the new owner.
          SESSION_TAKEN_OVER: 6
        };
        var WAKE = {
          FILE: "wake.log",
          KIND: {
            // A ready item landed for a review this session owns.
            WORK: "work",
            // Another agent ran `lahe session takeover` on this session.
            TAKEOVER: "takeover",
            // The session was closed. Nothing more will be appended.
            CLOSED: "closed",
            // The reviewer pressed End review on the rail, for a review this session
            // owns. It carries a review and no item, because it is about the review
            // rather than about one piece of work.
            //
            // IT IS NOT "STOP". An ended review's unanswered items are still the
            // reviewer's requests, so the answer to this line is the same drain as
            // any other, followed by the end-of-review routine in the contract. Only
            // TAKEOVER and CLOSED mean stop.
            //
            // Without this line the feed had no way to say a review had ended, and
            // the contract's promise that the reviewer "can end a review from the
            // page ... and you are woken" was false. Worse than silent: an ended
            // review drains to zero ready items, which is exactly what a review the
            // agent has kept up with looks like, so the agent reads "finished" as
            // "quiet" and waits.
            ENDED: "ended"
          },
          FIELD: {
            AT: "at",
            KIND: "kind",
            REVIEW: "review",
            ITEM: "item",
            REV: "rev",
            DRAIN: "drain"
          }
        };
        function shellWord(value) {
          var text = String(value);
          if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
          return "'" + text.replace(/'/g, "'\\''") + "'";
        }
        function stateDirFlag(stateDirPath) {
          if (typeof stateDirPath !== "string" || !stateDirPath) return "";
          return " --state-dir " + shellWord(stateDirPath);
        }
        function drainCommand(sessionId, stateDirPath) {
          return "lahe status --session " + String(sessionId) + " --json --quiet" + stateDirFlag(stateDirPath);
        }
        function monitorCommand(sessionId, stateDirPath, handoffRevisions) {
          var ids = Array.isArray(sessionId) ? sessionId : [sessionId];
          return "lahe monitor" + ids.map(function(id) {
            return " --session " + String(id) + (handoffRevisions && Number.isInteger(handoffRevisions[id]) ? " --handoff-rev " + handoffRevisions[id] : "");
          }).join("") + stateDirFlag(stateDirPath);
        }
        function takeoverCommand(sessionId, stateDirPath, requestId) {
          return "lahe session takeover " + String(sessionId) + stateDirFlag(stateDirPath) + (isSafeId(requestId) ? " --request " + requestId : "");
        }
        function reviewCommand(target, sessionId, stateDirPath) {
          return "lahe review " + shellWord(target) + " --session " + String(sessionId) + stateDirFlag(stateDirPath);
        }
        var MONITOR = {
          // The heartbeat and the activity stamp are separate files on purpose:
          // session.json is rewritten by takeover, and a heartbeat sharing that file
          // would race it.
          HEARTBEAT_FILE: "monitor.json",
          ACTIVITY_FILE: "activity.json",
          // The items (review, id, rev) the monitor has already printed to the agent
          // holding this handoff rev. A relaunch with only these still unanswered
          // waits rather than printing them again and exiting at once.
          DELIVERED_FILE: "delivered.json",
          // The monitor's default local poll interval, in seconds. The heartbeat is
          // written once per loop, so a heartbeat older than a few intervals means the
          // process is gone rather than slow.
          INTERVAL_SECONDS: 15,
          // How many intervals a heartbeat may be behind and still count as watching.
          FRESH_INTERVALS: 3,
          // PRIMARY (LAHE Library): the first --session of the monitor writing this
          // heartbeat. A monitor watching several sessions writes one heartbeat into
          // each, all naming the same primary, so the Library can say which agent is
          // watching a session it picked up.
          HEARTBEAT_FIELD: { PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at", PRIMARY: "primary" },
          ACTIVITY_FIELD: { AT: "at" }
        };
        MONITOR.HEARTBEAT_FRESH_MS = MONITOR.INTERVAL_SECONDS * MONITOR.FRESH_INTERVALS * 1e3;
        MONITOR.ACTIVITY_FRESH_MS = 18e4;
        var AGENT_LIVENESS = {
          STATE: {
            // Items are waiting, and the agent has run a lahe command or landed a
            // reply in the last few minutes. It is mid-task, which is not alarming
            // however long the item has been in the queue behind it.
            WORKING: "working",
            // Items are waiting and nothing has come back for a while.
            WAITING: "waiting",
            // Items are waiting, nothing has come back, and the machine can see that
            // nothing is listening: no process holds this session's wake feed open, no
            // live monitor, no lahe command in minutes. A different next move for the
            // reviewer, so a different state.
            NO_AGENT: "no_agent",
            // NOTHING IS WAITING. Says nothing at all, and this is the state a healthy
            // review spends most of its life in.
            NONE: "none"
          },
          FIELD: {
            STATE: "state",
            UNANSWERED: "unanswered",
            OLDEST_UNANSWERED_AT: "oldest_unanswered_at",
            // When the newest reply on this review landed, or null if none ever has.
            // It is evidence of an agent doing something recently, and it is what
            // `lahe session list` shows a human. It is never on the reviewer's line by
            // itself: an old reply on a fully answered review is not news.
            LAST_REPLY_AT: "last_reply_at",
            // true, false, or NULL FOR CANNOT TELL. Null is a real answer and it is
            // the answer on any host where the machine cannot be asked. It never
            // produces a claim in either direction; the line falls back to the wait.
            LISTENING: "listening",
            MONITOR_AT: "monitor_at",
            ACTIVITY_AT: "activity_at",
            // The session that owns this review, or null for a review with no
            // session. The rail's handoff message names it in the takeover command.
            SESSION_ID: "session_id",
            // true when the session's state is outside the default folder, so a copied
            // command needs --state-dir. A boolean on purpose: the page is never sent
            // a filesystem path.
            STATE_DIR_FLAG: "state_dir_flag_needed",
            // The id of the oldest waiting item. With oldest_unanswered_at (its
            // wait-start) it keys the one notice the rail raises for a late wait.
            OLDEST_ITEM: "oldest_unanswered_item",
            // The human's name for the owning session (set with --name or `lahe
            // session name`), or null. Display text: the rail draws it as text only.
            NAME: "session_name",
            // true when NAME was read off a page's own title (`lahe session name
            // --from-review`). The rail still shows it, but its hand-off message,
            // which a new agent reads as its first prompt, leaves it out.
            NAME_FROM_PAGE: "session_name_from_page",
            // One of PRESENCE below: what the Library may say about the agent,
            // whether or not anything is waiting.
            PRESENCE: "presence"
          },
          // listening: a live monitor heartbeat on this handoff rev (or a process
          //            holding the wake feed open).
          // working:   neither, but a lahe command within CATALOG.WORKING_MS.
          // away:      neither of those. The Library says when it was last active.
          PRESENCE: { LISTENING: "listening", WORKING: "working", AWAY: "away" },
          // THE WORDS, SPELLED ONCE, HERE. They used to be hand-copied into the layer,
          // which is two spellings of one wire value: rename a state and the rail
          // silently stopped recognising it, which looks exactly like a healthy rail
          // with nothing to say. `{age}` is how long the oldest unanswered item has
          // waited, filled in by whoever draws the line off its own clock, so a helper
          // repeating an unchanged payload cannot freeze a number that is growing.
          //
          // They are in a reviewer's words, not ours. No monitors, no heartbeats, no
          // wake feeds: none of that is the reviewer's problem, and naming it in front
          // of them asks them to care about our plumbing.
          //
          // `none` is deliberately absent: a state with no words draws nothing.
          TEXT: {
            working: "agent is working, {age}",
            waiting: "nothing back yet, {age}",
            no_agent: "nobody has picked this up, {age}"
          },
          // THE QUIET INDICATOR, which is what the line wears the rest of the time.
          //
          // It is a convenience rather than an alarm, and it exists because there are
          // two moments a reviewer actually looks: at the start ("will my comments
          // reach the agent, did this set up correctly?") and after a break ("did
          // anything die while I was away?"). Both are the same question, is the chain
          // intact, and both deserve a glanceable answer rather than a blank space.
          //
          // Two words, no punctuation, no verb: it must never look like it wants
          // reading. `null` when the machine cannot be asked, because a shrug is not a
          // status and inventing either answer would be worse than silence.
          CONNECTION: {
            connected: "agent listening",
            absent: "no agent listening"
          },
          // THE HOVER TEXT, assembled from these in order by whoever draws the line.
          //
          // This is where everything the tool actually knows about the connection
          // goes: whether the helper is answering, whether an agent has this review
          // open, when it last replied, and where the work is being kept. The line
          // itself stays short; a reviewer who is curious, or worried, hovers.
          //
          // Still no monitors, no heartbeats and no wake feeds. "Has this review open"
          // is what the machine can actually see (a process holding this session's
          // feed open) said in words that mean something to the person reading them.
          DETAIL: {
            helper_up: "The helper is answering this page, so comments and edits reach it as you make them.",
            helper_down: "The helper is not answering right now, so your work is being kept in this browser until it is.",
            agent_connected: "An agent has this review open.",
            agent_absent: "No agent has this review open.",
            agent_unknown: "Whether an agent has this review open cannot be checked on this computer.",
            agent_named: "The agent on this review is named {name}.",
            replied: "The agent last replied {reply} ago.",
            never_replied: "The agent has not replied on this review yet.",
            waiting: "Your oldest unanswered item has been waiting {age}.",
            stored: "Your comments and edits are stored in this browser and in the helper's log on disk.",
            save: "You can get your own copy any time: use Copy review or Export review to file in the menu."
          },
          // THE LOUD HALF, made prominent (Ken, 2026-09-16: "active boxes should
          // change color if they haven't been picked up after a certain amount of
          // time. something with more prominence should tell you to go check your
          // agent or assign a new one to this doc.").
          //
          // Shown only while the wait is overdue (see `overdue` below): a banner at
          // the top of the rail and a word on each late card. Same rule as the TEXT
          // above: a reviewer's words, no plumbing. `{age}` is filled in the same way.
          PROMINENT: {
            BANNER: {
              no_agent: "Nobody has picked up your comments in {age}.",
              waiting: "Nothing has come back on your comments in {age}."
            },
            CHECK: "Check your agent's window first. It may have stopped, or it may be waiting on you.",
            // When the session has a name, say which agent. Ken runs many at once.
            CHECK_NAMED: "Check the agent named {name} first. It may have stopped, or it may be waiting on you.",
            HANDOFF_BUTTON: "Copy a message for a new agent",
            COPIED: "Copied. Paste it into a new agent and it will pick up your comments.",
            COPY_FAILED: "Could not copy. Select the message below and copy it yourself.",
            CARD: "waiting {age}",
            // The one pop-up notice raised when a wait first goes late. A notice has
            // no buttons of its own, so it points at the rail, where the banner is.
            TOAST_LABEL: "Comments waiting",
            TOAST_CHECK: "Check your agent's window.",
            TOAST_CHECK_NAMED: "Check the agent named {name}.",
            TOAST_OPEN: "Open the rail to hand this doc to a new agent."
          },
          // WHEN THE LINE STARTS SPEAKING, counted from the moment the reviewer
          // submitted, not from anything about a process.
          //
          // Thirty seconds, because that is where a person who has just typed
          // something starts wondering whether it went anywhere. Not minutes: they are
          // sitting there. Not instant either, because an agent that has had a comment
          // for five seconds is reading it and a stopwatch started that fast is noise
          // on every single comment.
          //
          // THE CLOCK STARTS ON SUBMITTED WORK ONLY. A draft the reviewer is still
          // typing is waiting on nobody: drafts are invisible to agents everywhere
          // else in this design (`record.isUnansweredReady` requires READY), and they
          // are invisible to this clock for the same reason.
          QUIET_MS: 3e4,
          // A lahe command or a landed reply this recent is an agent mid-task. It is
          // the difference the reviewer actually asked for: "waiting 10m and nothing
          // has happened" is worth knowing, "waiting 10m while the agent works" is
          // not alarming.
          //
          // Deliberately the same number as RECENT_COMMAND_MS. A model thinking
          // through one hard comment leaves no footprint at all while it thinks, and
          // no monitor is armed while an agent works the batch it was handed. At
          // three minutes that quiet read as an empty chair, and a reviewer who
          // commented mid-thought was told nobody had picked it up. One number for
          // both means the agent counts as working for exactly as long as the machine
          // counts somebody as being on the review.
          ACTIVE_MS: 6e5,
          // Past this, a wait with nothing happening is loud. Nothing the machine can
          // see about listeners buys quiet here: a file tail can be armed all
          // afternoon over an agent that stopped reading.
          STALE_MS: 6e5,
          // How recently a lahe command must have run for the machine to count as
          // having somebody on it. The same as ACTIVE_MS on purpose, and only ever used
          // to WITHHOLD the "no agent listening" wording: an exit-on-work monitor is
          // gone the moment work arrives, so an agent can be mid-edit with nothing
          // holding the feed open and no heartbeat.
          RECENT_COMMAND_MS: 6e5,
          // When "nobody has picked this up" goes loud. The words start at QUIET_MS
          // like every other state, but the amber banner and the late card wait until
          // here. Not being able to see a listener is weak evidence: an agent can be
          // mid-thought with nothing holding the feed open, so half a minute of it is
          // not enough to tell the reviewer their comment landed nowhere.
          NO_AGENT_LOUD_MS: 12e4
        };
        function livenessOverdue(state, waitedMs) {
          if (typeof state !== "string" || !Object.prototype.hasOwnProperty.call(AGENT_LIVENESS.TEXT, state)) return false;
          if (typeof waitedMs !== "number" || !isFinite(waitedMs) || waitedMs < AGENT_LIVENESS.QUIET_MS) return false;
          if (state === AGENT_LIVENESS.STATE.WORKING) return false;
          if (state === AGENT_LIVENESS.STATE.NO_AGENT) return waitedMs >= AGENT_LIVENESS.NO_AGENT_LOUD_MS;
          return waitedMs >= AGENT_LIVENESS.STALE_MS;
        }
        AGENT_LIVENESS.overdue = livenessOverdue;
        function handoffMessage(sessionId, name, stateDirFlagNeeded, options) {
          var library = !!(options && options.library === true);
          var requestId = library && options && isSafeId(options.request) ? options.request : null;
          var dirPath = library && typeof options.stateDir === "string" && options.stateDir ? options.stateDir : null;
          var flag = stateDirFlag(dirPath);
          var hasId = typeof sessionId === "string" && isSafeId(sessionId);
          var elsewhere = !library && stateDirFlagNeeded === true ? [
            "This review keeps its files outside Lahe's default folder, so add --state-dir with the folder the earlier agent's lahe commands used. If you cannot find it, ask me.",
            ""
          ] : [];
          var run = hasId ? ["Run this command:", "", "    " + takeoverCommand(sessionId, dirPath, requestId), ""].concat(elsewhere) : [
            "Run `lahe session list" + flag + "` to find the session for this document, then take it over with:",
            "",
            "    lahe session takeover <session-id>" + flag,
            ""
          ].concat(elsewhere);
          var named = typeof name === "string" && name ? ", the session named " + JSON.stringify(name) : "";
          var why = library ? "I am handing it to you from the Lahe Library so you can continue it." : "The agent that was working on it stopped answering my comments, and I am asking you to continue it.";
          return ["Please take over my live Lahe review" + named + ". " + why, ""].concat(run).concat([
            "It prints the commands to catch up. Then work every comment that is waiting and reply to each one, and keep watching for new ones."
          ]).join("\n");
        }
        AGENT_LIVENESS.handoffMessage = handoffMessage;
        return {
          API_VERSION,
          SERVICE_CONTRACT,
          CONTRACT_VERDICT,
          helperContractVerdict,
          acceptsNotesFlag,
          BASE,
          DEFAULT_PORT,
          DEFAULT_HOST,
          DEFAULT_HELPER_ORIGIN,
          ALLOWED_HOST_NAMES,
          LOOPBACK_ORIGIN_HOSTS,
          ORIGIN_LIMIT,
          isRegisterableOrigin,
          HEADER,
          CLIENT_LAYER,
          CLIENT_CLI,
          CLIENTS,
          CLIENT_CATALOG,
          JSON_CONTENT_TYPE,
          AUTH,
          SAFE_ID,
          isSafeId,
          ROUTES,
          CATALOG_ROUTES,
          CATALOG_PAGE_PATH,
          CATALOG_API_BASE,
          CATALOG_TOKEN_META,
          HEALTH_FIELD,
          route,
          requiredHeaders,
          CHECK,
          CHECKS,
          checkNamed,
          checkRequest,
          hostAllowed,
          STATUS_FOR_CODE,
          statusFor,
          errorBody,
          CATALOG,
          CATALOG_LEGACY_NOTE,
          CATALOG_LOG,
          catalogLogLine,
          EVENT,
          EVENT_TYPES,
          EVENT_FIELD,
          IDEMPOTENCE_KEY,
          newEvent,
          encodeEventLine,
          parseEventLine,
          FLUSH,
          byteLength,
          fitsKeepalive,
          REPLY_FIELD,
          REPLY_STATUS,
          REPLY_STATUSES,
          REPLY_REQUIRED,
          REPLY_FILE,
          agentFromFilename,
          parseReplyLine,
          SUGGESTIONS_MAX,
          SUGGESTION_TEXT_MAX,
          REPLY_POLL,
          REPLY_CURSOR_FIELD,
          nextReadOffset,
          splitCompleteLines,
          SCRIPT_ATTR,
          ALIAS_MAX,
          isLoopbackPortOrigin,
          isPathAlias,
          isSpellingOrigin,
          isSpelling,
          FRAMES_ALLOW,
          START_HIDDEN,
          NOTES_ON,
          DOCUMENT_ON,
          SCRIPT_SELECTOR,
          SCRIPT_FALLBACK_ONERROR,
          scriptTag,
          PAGES,
          isSiteLabel,
          isSiteName,
          HOST_FAMILY,
          classifyHost,
          siteOrigin,
          siteNameFromOrigin,
          SITE_ROUTES,
          SUMMARY_ROUTES,
          PROOF,
          SUMMARY_VERSION,
          CLI_EXIT,
          WAKE,
          stateDirFlag,
          drainCommand,
          monitorCommand,
          takeoverCommand,
          reviewCommand,
          MONITOR,
          AGENT_LIVENESS
        };
      });
    }
  });

  // src/layer/catalog/view_model.js
  var require_view_model = __commonJS({
    "src/layer/catalog/view_model.js"(exports, module) {
      (function(root, factory) {
        "use strict";
        var browser = typeof window !== "undefined" && !!window.document;
        if (browser) {
          root.LAHE = root.LAHE || {};
          root.LAHE.catalogViewModel = factory(root.LAHE.protocol);
        } else {
          module.exports = factory(__require("../../shared/protocol.js"));
        }
      })(typeof globalThis !== "undefined" ? globalThis : exports, function(protocol) {
        "use strict";
        var CATALOG = protocol.CATALOG;
        var LEGACY_SESSION = "legacy";
        var TEXT = {
          TITLE: "Lahe Library",
          AGENT_ATTACHED: "Hand-overs go to: {agent}",
          AGENT_NONE: "No agent attached. Open still works; hand-overs give you a message to paste.",
          AGENT_STOPPED: "{agent} is attached but has stopped watching. Open still works; hand-overs give you a message to paste.",
          // On a Mac the helper opens the new Terminal window itself, so Launch a
          // new agent needs no attached agent (catalog_launch.js).
          AGENT_NONE_DIRECT: "No agent attached. Open and Launch a new agent still work; Pick this up gives you a message to paste.",
          AGENT_STOPPED_DIRECT: "{agent} is attached but has stopped watching. Open and Launch a new agent still work; Pick this up gives you a message to paste.",
          LAUNCHING: "Opening a new Terminal window.",
          WAITING: "Waiting for {agent}.",
          ALREADY_WAITING: "Already waiting for {agent}.",
          // The helper queued nothing: the attached agent already owns or watches
          // the document (request_id: null).
          ALREADY_HAS: "{agent} already has it. Nothing was sent.",
          DONE: "{agent}: {text}",
          REFUSED: "{agent} couldn't take it: {text}.",
          EXPIRED: "Not picked up. {agent} didn't answer.",
          // Not in the Page Spec's table: the expired line carries a reason
          // (catalog_requests.js EXPIRY_REASON), and a launch that expired is not a
          // pick-up. The row names both, so the reader knows what to do next.
          EXPIRED_PICKUP: "Not picked up.",
          EXPIRED_LAUNCH: "No new agent was launched.",
          EXPIRED_TIMEOUT: "{agent} didn't answer.",
          EXPIRED_MONITOR_DEAD: "{agent} stopped watching before it answered.",
          EXPIRED_ATTACH_CHANGED: "A different agent was attached before {agent} answered.",
          PANEL_NO_AGENT: "No agent is attached. This is the same hand-off message the chat bar already copies. Paste it into any agent:",
          PANEL_REFUSED: "This is the same hand-off message the chat bar already copies. Paste it into a new agent:",
          COPY: "Copy",
          COPIED: "Copied.",
          COPY_FAILED: "Couldn't copy. Select the message and copy it yourself.",
          CLOSE: "Close",
          COPY_HANDOFF: "Copy the hand-off message",
          POPUP_BLOCKED: "The browser blocked the new tab. Allow pop-ups for this page, then press Open again.",
          LIST_FAILED: "The Library couldn't load the list: {why}",
          OPEN: "Open",
          PICKUP: "Pick this up",
          LAUNCH: "Launch a new agent",
          // Pick this up and Launch sit behind one menu per row, so Open is the
          // only button a row shows at rest.
          HAND_TO: "Hand to agent",
          // An agent is told to refuse a dev-server hand-over (it cannot start
          // someone's app), so the Library does not offer one.
          // A launched agent takes the document's session over. These rows have
          // none to take, so Launch is off and no hand-off message is offered.
          LAUNCH_NO_SESSION_LEGACY: "This review is from before sessions, so there is no session for a new agent to take over. Pick this up has the attached agent serve it.",
          PANEL_NO_SESSION: "This document has no session a new agent could take over, so there is no hand-off message. Attach an agent with lahe library, then choose Pick this up.",
          DEV_SERVER_NO_HANDOFF: "An app's dev server serves this page, so no agent can take it from here. Start the dev server and open the page yourself.",
          SEARCH_PLACEHOLDER: "Search titles, files, folders, sessions",
          ALL_PROJECTS: "All projects",
          SECTION_TOP: "Unanswered comments, and starred ({n})",
          SECTION_WEEK: "This week ({n})",
          SECTION_OLDER: "Older than a week: {reviews}",
          SECTION_OLDER_NOTE: "Search reaches all of them.",
          SHOW_MISSING: "Show {n} missing",
          MISSING_HEADING: "Missing ({n}). Neither the file nor a main-repo copy exists.",
          HIDE: "Hide",
          // The card names its watcher once, so its rows need not repeat it. It
          // says only what is known (phase 8): a live monitor is "listening", a lahe
          // command inside CATALOG.WORKING_MS is "working", and anything older is
          // just when the agent was last active. A flat "watching" called an agent
          // that went quiet ten minutes ago a watcher.
          WATCH_LISTENING: "{agent} is listening",
          WATCH_WORKING: "{agent} is working, last active {time}",
          WATCH_AWAY: "{agent} last active {time}, not listening",
          WATCH_AWAY_NO_TIME: "{agent} is not listening",
          WATCH_NONE: "no agent listening",
          WATCH_LIBRARY_AGENT: "{agent} (the agent that opened this Library)",
          // The watcher's name is the card's own title: a session watched by its
          // own agent, often one launched for the document and named after it.
          WATCH_OWN: "its own agent",
          WATCH_OWN_START: "Its own agent",
          WAITING_ONE: "1 comment is waiting.",
          WAITING_MANY: "{n} comments are waiting.",
          UNNAMED_SESSION: 'Unnamed session, started on "{name}"',
          // Not in the Page Spec: the reader's "legacy" group is lahe add reviews
          // from before agent sessions existed, and "Unnamed session" would be untrue.
          LEGACY_SESSION: "Reviews from before sessions",
          // One card per project for pre-session reviews (phase 8): one card of
          // every project's old reviews read as a mix nobody made.
          LEGACY_PROJECT: "{project}, from before sessions",
          SESSION_OF: 'session "{name}"',
          BADGE_ENDED: "review ended",
          BADGE_SERVED: "being served now",
          BADGE_LISTENING: "agent listening: {agent}",
          BADGE_WORKING: "agent working: {agent}",
          FOLDED: "{n} reviews of this folder, shown as one",
          FOLDED_DOCUMENT: "{n} reviews of this document, shown as one",
          PAGES: "{n} pages",
          SHOW_MORE: "Show {n} more",
          SHOW_FEWER: "Show fewer",
          UNREADABLE: "Some of this review's records can't be read.",
          MISSING: "File is gone. Open unavailable.",
          // A legacy review belongs to no session: Pick this up has the attached
          // agent take it into its own session and serve it, old comments and all.
          LEGACY_PICKUP: "From before sessions. Pick this up has the attached agent take it into its session and serve it, with its old comments.",
          WORKTREE: "The worktree is gone. An agent will open the main repository's copy, which may differ from what you reviewed.",
          // With stable addresses the helper shows that copy itself, read-only.
          WORKTREE_READONLY: "The worktree is gone. Open shows the main repository's copy, read-only, which may differ from what you reviewed.",
          MOVED: "Moved from a worktree that is gone. Your comments came with it.",
          OPENED_RAIL_HELD: `Opened. This file's review is "{name}", so the page shows its comments. Open did not move the chat bar.`,
          OPENED_RETIRED: "Opened. This review was retired, so it answers on no page. The page shows the file's current review, if it has one.",
          BADGE_RETIRED: "review retired",
          NEEDS_AGENT: "Needs an agent to reopen. No agent is attached.",
          NO_MATCHES: "Nothing matches that search.",
          RESTARTED: "Lahe restarted, reload this page.",
          RELOAD: "Reload",
          NOT_RUNNING: "Lahe is not running. Ask an agent to open the lahe library.",
          EMPTY: "No reviews yet. Documents you review in Lahe show up here.",
          LOADING: "Loading the Library.",
          STAR: "Star",
          UNSTAR: "Remove the star",
          STAR_FAILED: "Couldn't save the star: {why}. The star goes back.",
          STAR_NOT_RUNNING: "Lahe is not running",
          RENAME: "Rename",
          RENAME_FAILED: "Couldn't save the rename: {why}. The old name goes back.",
          OPENING_HANDOFF: 'Opening "{name}" in a new tab and handing it to {agent}.',
          OPENING: 'Opening "{name}" in a new tab.',
          // Not in the Page Spec's table: the tab is open but the agent has not
          // answered yet. Saying "watching" here would be the optimistic "done".
          OPENED_WAITING: '"{name}" is open in a new tab. Waiting for {agent} to start watching it.',
          DONE_AFTER_OPEN: '"{name}" is open in a new tab, and {agent} is watching it.',
          OPENED: '"{name}" is open in a new tab.',
          OPENED_QUEUE_FULL: "Opened. No agent was asked: too many hand-overs are waiting.",
          OPENED_NO_AGENT: "Opened. No agent is attached to watch it.",
          QUEUE_FULL: "No agent was asked: too many hand-overs are waiting.",
          URL_REFUSED: "Lahe answered with an address that is not on this computer, so the Library did not open it.",
          UNKNOWN_ERROR: "Something went wrong.",
          CONFIRM_TITLE: "Another agent is on this session.",
          CONFIRM_BODY: '"{name}" belongs to session "{session}". Handing it to {agent} moves the whole session and stops the other agent.',
          CONFIRM_BODY_LAUNCH: '"{name}" belongs to session "{session}". A new agent takes the whole session over and stops the other agent.',
          CONFIRM_MOVES: "These reviews move with it:",
          CONFIRM_MOVE: "Move the session",
          CONFIRM_READ: "Just open it to read",
          CONFIRM_CANCEL: "Cancel",
          // failures.js holds PROTO_CATALOG_UNREADABLE's own wording, but the page
          // cannot load failures.js (the asset allowlist is fixed), so the notice is
          // spelled here from the same sentence.
          STARS_UNREADABLE: "Stars can't change right now: the Library's saved stars file can't be read. Lahe leaves the file as it is."
        };
        function fill(template, values) {
          return template.replace(/\{(\w+)\}/g, function(m, key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m;
          });
        }
        function assign(target) {
          for (var i = 1; i < arguments.length; i += 1) {
            var src = arguments[i];
            if (!src) continue;
            for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
          }
          return target;
        }
        function withKey(map, key, value) {
          var out = assign({}, map);
          if (value === void 0) delete out[key];
          else out[key] = value;
          return out;
        }
        function initialState() {
          return {
            fetch: "loading",
            query: "",
            project: "",
            showMissing: false,
            expanded: {},
            panel: null,
            dialog: null,
            banner: null,
            opening: {},
            menu: null,
            notes: {},
            starPending: {},
            starOverride: {},
            // {reviewId: true}: a review whose page list the reader opened.
            pagesOpen: {},
            // {cardId: true}: a card whose every review the reader asked to see.
            cardMore: {},
            // reviewId | null: the row whose name is being edited.
            renaming: null,
            // {reviewId: name|null}: a rename sent that the list has not caught up with.
            nameOverride: {}
          };
        }
        function withFetch(state, result) {
          var fetchState = "unreachable";
          var failure = null;
          if (result && result.ok) fetchState = "ok";
          else if (result && result.status === 401) fetchState = "unauthorized";
          else if (result && !result.unreachable && typeof result.status === "number") {
            fetchState = "failed";
            failure = errorText(result.error);
          }
          return assign({}, state, { fetch: fetchState, fetchFailure: failure });
        }
        function shouldPoll(state) {
          return state.fetch !== "unauthorized";
        }
        function withQuery(state, query) {
          return assign({}, state, { query: String(query == null ? "" : query) });
        }
        function withProject(state, project) {
          return assign({}, state, { project: String(project == null ? "" : project) });
        }
        function withShowMissing(state, shown) {
          return assign({}, state, { showMissing: !!shown });
        }
        function withRenaming(state, reviewId) {
          return assign({}, state, { renaming: reviewId || null });
        }
        function cleanTyped(name) {
          var t = typeof name === "string" ? name.trim() : "";
          return t || null;
        }
        function beginRename(state, reviewId, name) {
          return assign({}, state, { renaming: null, nameOverride: withKey(state.nameOverride || {}, reviewId, cleanTyped(name)) });
        }
        function afterRename(state, reviewId, result, now) {
          if (result && result.ok) {
            var kept = result.body && Object.prototype.hasOwnProperty.call(result.body, "name") ? result.body.name : void 0;
            var out = assign({}, state, { notes: withKey(state.notes, reviewId, void 0) });
            if (kept !== void 0) out.nameOverride = withKey(state.nameOverride || {}, reviewId, kept || null);
            return out;
          }
          var back = assign({}, state, { nameOverride: withKey(state.nameOverride || {}, reviewId, void 0) });
          if (result && result.status === 401) return withFetch(back, { ok: false, status: 401 });
          var why = !result || result.unreachable ? TEXT.STAR_NOT_RUNNING : result.error && (result.error.remedy || result.error.message) || TEXT.UNKNOWN_ERROR;
          return withNote(back, reviewId, { kind: "error", text: fill(TEXT.RENAME_FAILED, { why: withoutFinalPeriod(why) }), tone: "warn" }, now);
        }
        var SESSION_KEY = "session:";
        function sessionCustomName(session, state) {
          var o = state.nameOverride || {};
          var key = SESSION_KEY + session.id;
          if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
          return typeof session.custom_name === "string" && session.custom_name ? session.custom_name : null;
        }
        function customName(review, state) {
          var o = state.nameOverride || {};
          if (Object.prototype.hasOwnProperty.call(o, review.id)) return o[review.id];
          return typeof review.custom_name === "string" && review.custom_name ? review.custom_name : null;
        }
        function withPagesOpen(state, reviewId, open) {
          return assign({}, state, { pagesOpen: withKey(state.pagesOpen || {}, reviewId, open ? true : void 0) });
        }
        function withCardMore(state, cardId, open) {
          return assign({}, state, { cardMore: withKey(state.cardMore || {}, cardId, open ? true : void 0) });
        }
        function withExpanded(state, sessionId, open) {
          return assign({}, state, { expanded: withKey(state.expanded, sessionId, !!open) });
        }
        function withMenu(state, reviewId) {
          return assign({}, state, { menu: reviewId || null });
        }
        function withPanel(state, reviewId, reason) {
          return assign({}, state, { panel: reviewId ? { review: reviewId, reason: reason || "no_agent" } : null });
        }
        function withCopied(state, reviewId, ok) {
          if (!state.panel || state.panel.review !== reviewId) return state;
          return assign({}, state, { panel: assign({}, state.panel, { copied: !!ok }) });
        }
        function popupBlocked(state, reviewId, now) {
          return withNote(state, reviewId, { kind: "error", text: TEXT.POPUP_BLOCKED, tone: "warn" }, now);
        }
        function withDialog(state, reviewId, action) {
          return assign({}, state, { dialog: reviewId ? { review: reviewId, action } : null });
        }
        function withNote(state, reviewId, note, now) {
          return assign({}, state, { notes: withKey(state.notes, reviewId, note ? assign({}, note, { at: now }) : void 0) });
        }
        function afterList(state, list) {
          var override = assign({}, state.starOverride);
          Object.keys(override).forEach(function(id) {
            var found = findReview(list, id);
            if (!found || !!found.review.starred === override[id]) delete override[id];
          });
          var names = assign({}, state.nameOverride);
          Object.keys(names).forEach(function(id) {
            if (id.indexOf(SESSION_KEY) === 0) {
              var sid = id.slice(SESSION_KEY.length);
              var s = (list && list.sessions || []).filter(function(x) {
                return x.id === sid;
              })[0];
              if (!s || (s.custom_name || null) === names[id]) delete names[id];
              return;
            }
            var found = findReview(list, id);
            if (!found || (found.review.custom_name || null) === names[id]) delete names[id];
          });
          return assign({}, state, { starOverride: override, nameOverride: names });
        }
        function parts(ms, timeZone) {
          var fmt = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "short",
            day: "numeric",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit"
          });
          var out = {};
          fmt.formatToParts(new Date(ms)).forEach(function(p) {
            out[p.type] = p.value;
          });
          return out;
        }
        function formatTime(iso, now, timeZone) {
          var ms = Date.parse(iso);
          if (!isFinite(ms)) return "unknown time";
          var t = parts(ms, timeZone);
          var n = parts(now, timeZone);
          var clock = t.hour + ":" + t.minute + " " + t.dayPeriod;
          if (t.year === n.year && t.month === n.month && t.day === n.day) return clock;
          if (t.year === n.year) return t.weekday + " " + t.month + " " + t.day + ", " + clock;
          return t.month + " " + t.day + ", " + t.year;
        }
        function agentLabel(ref) {
          if (!ref) return null;
          return ref.name || ref.session || null;
        }
        function liveAgent(list) {
          var a = list && list.attached;
          if (!a || !a.session || a.watching === false) return null;
          return { session: a.session, name: agentLabel(a) };
        }
        function directLaunch(list) {
          return !!(list && list.launch && list.launch.direct === true);
        }
        function agentHeader(list) {
          var a = list && list.attached;
          var direct = directLaunch(list);
          var none = direct ? TEXT.AGENT_NONE_DIRECT : TEXT.AGENT_NONE;
          if (a && a.closed === true) return { attached: false, text: none };
          if (a && a.session && a.watching !== false) {
            return { attached: true, text: fill(TEXT.AGENT_ATTACHED, { agent: agentLabel(a) }) };
          }
          if (a && a.session) {
            return { attached: false, text: fill(direct ? TEXT.AGENT_STOPPED_DIRECT : TEXT.AGENT_STOPPED, { agent: agentLabel(a) }) };
          }
          return { attached: false, text: none };
        }
        function handoffFor(session, list) {
          var legacy = !session || isLegacy(session);
          var name = legacy || session.name_from_page === true ? null : session.name || null;
          var dirPath = list && typeof list.state_dir === "string" && list.state_dir ? list.state_dir : null;
          return protocol.AGENT_LIVENESS.handoffMessage(legacy ? null : session.id, name, false, {
            library: true,
            stateDir: dirPath
          });
        }
        function sameWatcher(a, b) {
          return !!(a && b && a.session === b.session);
        }
        var STATE_LISTENING = "listening";
        var STATE_WORKING = "working";
        function agentPhrase(ref, session, list, start) {
          var attached = list && list.attached;
          var agent = agentLabel(ref);
          if (attached && attached.session && ref.session === attached.session) return fill(TEXT.WATCH_LIBRARY_AGENT, { agent });
          if (agent === sessionTitle(session)) return start ? TEXT.WATCH_OWN_START : TEXT.WATCH_OWN;
          return agent;
        }
        function watchText(session, list, now, opts, start) {
          var w = session.watching;
          if (w) {
            var agent = agentPhrase(w, session, list, start);
            if (w.state === STATE_WORKING) {
              return fill(TEXT.WATCH_WORKING, { agent, time: formatTime(w.last_active, now, opts.timeZone) });
            }
            return fill(TEXT.WATCH_LISTENING, { agent });
          }
          var a = session.away;
          if (a) {
            var who = agentPhrase(a, session, list, start);
            if (!a.last_active) return fill(TEXT.WATCH_AWAY_NO_TIME, { agent: who });
            return fill(TEXT.WATCH_AWAY, { agent: who, time: formatTime(a.last_active, now, opts.timeZone) });
          }
          return TEXT.WATCH_NONE;
        }
        function waitingIn(session) {
          return (session.reviews || []).reduce(function(sum, r) {
            return r.openable === "missing" ? sum : sum + (r.waiting || 0);
          }, 0);
        }
        function plural(n, one, many) {
          return n + " " + (n === 1 ? one : many);
        }
        function isLegacy(session) {
          return !!session && (session.id === LEGACY_SESSION || session.id.indexOf(LEGACY_SESSION + ":") === 0);
        }
        function sessionTitle(session) {
          if (session.legacyProject) return fill(TEXT.LEGACY_PROJECT, { project: session.legacyProject });
          if (isLegacy(session)) return TEXT.LEGACY_SESSION;
          if (session.name) return session.name;
          var reviews = session.reviews || [];
          var first = reviews.length ? reviews[reviews.length - 1] : null;
          return fill(TEXT.UNNAMED_SESSION, { name: first ? first.display_name : session.id });
        }
        var CARD_ROWS_SHOWN = 5;
        function fullPath(review) {
          var dirPart = typeof review.path_hint === "string" ? review.path_hint : "";
          var file = typeof review.file === "string" && review.file ? review.file : "";
          return dirPart && file ? dirPart.replace(/\/+$/, "") + "/" + file : dirPart || "";
        }
        function pathText(review) {
          return typeof review.project_path === "string" && review.project_path ? review.project_path : fullPath(review);
        }
        function withoutFinalPeriod(text) {
          return String(text == null ? "" : text).replace(/[.\s]+$/, "");
        }
        function requestNote(review, list) {
          var q = review.request;
          if (!q) return null;
          var agent = q.by_name || agentLabel(list && list.attached) || "the agent";
          if (q.state === "waiting") {
            return { text: fill(TEXT.WAITING, { agent }), tone: "info", busy: true, copyHandoff: false, action: q.action };
          }
          if (q.state === "done") {
            return { text: fill(TEXT.DONE, { agent, text: q.text || "" }), tone: "ok", busy: false, copyHandoff: false };
          }
          if (q.state === "refused") {
            var live = liveAgent(list);
            if (!live || live.name !== q.by_name) return null;
            return {
              text: fill(TEXT.REFUSED, { agent, text: withoutFinalPeriod(q.text) }),
              tone: "warn",
              busy: false,
              copyHandoff: q.action === "launch"
            };
          }
          if (q.state === "expired") {
            var launch = q.action === "launch";
            var why = q.reason === "attach_changed" ? TEXT.EXPIRED_ATTACH_CHANGED : q.reason === "monitor_dead" ? TEXT.EXPIRED_MONITOR_DEAD : TEXT.EXPIRED_TIMEOUT;
            return {
              text: (launch ? TEXT.EXPIRED_LAUNCH : TEXT.EXPIRED_PICKUP) + " " + fill(why, { agent }),
              tone: "warn",
              busy: false,
              // A launch nobody ran can still be done by hand, from the message.
              copyHandoff: launch
            };
          }
          return null;
        }
        function effectiveStar(review, state) {
          var o = state.starOverride || {};
          return Object.prototype.hasOwnProperty.call(o, review.id) ? !!o[review.id] : !!review.starred;
        }
        function pickNote(local, review, list) {
          var fromList = requestNote(review, list);
          if (!local) return fromList;
          var q = review.request;
          if (q) {
            if (local.requestId && q.id === local.requestId) return fromList;
            if (local.kind === "already" && q.state !== "waiting") return fromList;
            var qAt = Date.parse(q.answered_at || q.at);
            if (isFinite(qAt) && qAt > local.at) return fromList;
          }
          return {
            text: local.text,
            tone: local.tone || "info",
            busy: !!local.busy,
            copyHandoff: false,
            action: local.action || null
          };
        }
        function buildRow(review, session, list, state, now, opts, cardWatching, inCard) {
          var agent = liveAgent(list);
          var missing = review.openable === "missing";
          var viaAgent = review.openable === "via-agent";
          var devServer = review.kind === "dev-server";
          var note = pickNote(state.notes && state.notes[review.id], review, list);
          var busyAction = note && note.busy ? note.action : null;
          var starred = effectiveStar(review, state);
          var notices = [];
          if (review.unreadable) notices.push({ text: TEXT.UNREADABLE, tone: "warn" });
          if (missing) notices.push({ text: TEXT.MISSING, tone: "quiet" });
          if (!missing && review.kind === "worktree") {
            notices.push({ text: viaAgent ? TEXT.WORKTREE : TEXT.WORKTREE_READONLY, tone: "info" });
          }
          if (!missing && review.moved === true) notices.push({ text: TEXT.MOVED, tone: "info" });
          if (!missing && review.kind === "legacy") notices.push({ text: TEXT.LEGACY_PICKUP, tone: "info" });
          if (viaAgent && !agent) notices.push({ text: TEXT.NEEDS_AGENT, tone: "warn" });
          if (devServer && !missing) notices.push({ text: TEXT.DEV_SERVER_NO_HANDOFF, tone: "quiet" });
          var handEnabled = !missing && !devServer;
          var noSession = review.kind === "legacy";
          var launchReason = review.kind === "legacy" ? TEXT.LAUNCH_NO_SESSION_LEGACY : null;
          if (note && noSession) note = assign({}, note, { copyHandoff: false });
          var buttons = {
            open: { label: TEXT.OPEN, enabled: !missing && !(viaAgent && !agent), busy: isOpening(state, review.id) },
            pickup: { label: TEXT.PICKUP, enabled: handEnabled, busy: busyAction === "pickup" },
            launch: { label: TEXT.LAUNCH, enabled: handEnabled && !noSession, reason: launchReason, busy: busyAction === "launch" },
            handTo: {
              label: TEXT.HAND_TO,
              // The attached agent already watches this session: there is nothing
              // to hand it.
              hidden: !!(agent && session.watching && session.watching.session === agent.session),
              enabled: handEnabled,
              reason: devServer && !missing ? TEXT.DEV_SERVER_NO_HANDOFF : null,
              busy: busyAction === "pickup" || busyAction === "launch",
              expanded: state.menu === review.id && handEnabled
            }
          };
          var panel = null;
          if (state.panel && state.panel.review === review.id) {
            panel = {
              reason: state.panel.reason,
              intro: noSession ? TEXT.PANEL_NO_SESSION : state.panel.reason === "refused" ? TEXT.PANEL_REFUSED : TEXT.PANEL_NO_AGENT,
              message: noSession ? null : handoffFor(session, list),
              copyLabel: TEXT.COPY,
              closeLabel: TEXT.CLOSE,
              copyStatus: state.panel.copied === true ? TEXT.COPIED : state.panel.copied === false ? TEXT.COPY_FAILED : null
            };
          }
          var badges = [];
          if (review.retired) badges.push(TEXT.BADGE_RETIRED);
          if (review.ended) badges.push(TEXT.BADGE_ENDED);
          if (review.served_url) badges.push(TEXT.BADGE_SERVED);
          if (session.watching && !sameWatcher(session.watching, cardWatching)) {
            var badge = session.watching.state === STATE_WORKING ? TEXT.BADGE_WORKING : TEXT.BADGE_LISTENING;
            badges.push(fill(badge, { agent: agentLabel(session.watching) }));
          }
          var folded = review.folded_from && review.folded_from.length ? fill(review.fold_kind === "document" ? TEXT.FOLDED_DOCUMENT : TEXT.FOLDED, { n: review.folded_from.length + 1 }) : null;
          var allPages = (review.pages || []).length > 1 ? review.pages : [];
          var pagesOpen = !!(state.pagesOpen && state.pagesOpen[review.id]);
          var pagesToggle = allPages.length ? { text: fill(TEXT.PAGES, { n: allPages.length }), expanded: pagesOpen } : null;
          var pages = pagesOpen ? allPages.map(function(p) {
            var where = typeof p.source === "string" && p.source ? p.source : String(p.path || "").replace(/^\/\.lahe-source\/[^/]+\//, "");
            return { title: p.title || where, path: where };
          }) : [];
          var original = review.display_name || review.title || review.id;
          var renamed = customName(review, state);
          if (renamed === original) renamed = null;
          return {
            id: review.id,
            session: session.id,
            name: renamed || original,
            // The document's own name, under the reviewer's when they renamed it.
            originalName: renamed ? original : null,
            rename: { editing: state.renaming === review.id, value: renamed || original, label: TEXT.RENAME, original },
            path: pathText(review),
            pathTitle: fullPath(review),
            address: addressLink(review.address),
            lastText: "last " + formatTime(review.last, now, opts.timeZone),
            counts: {
              waiting: review.waiting > 0 ? review.waiting + " waiting" : null,
              comments: plural(review.total || 0, "comment", "comments"),
              asOf: review.counts_as_of && review.counts_as_of !== review.last ? "counts as of " + formatTime(review.counts_as_of, now, opts.timeZone) : null
            },
            starred,
            star: {
              on: starred,
              enabled: true,
              pending: Object.prototype.hasOwnProperty.call(state.starPending || {}, review.id),
              label: starred ? TEXT.UNSTAR : TEXT.STAR
            },
            badges,
            folded,
            pages,
            pagesToggle,
            notices,
            note,
            offerHandoff: viaAgent && !agent && !noSession,
            handoffLabel: TEXT.COPY_HANDOFF,
            buttons,
            panel,
            sessionText: fill(TEXT.SESSION_OF, { name: sessionTitle(session) })
          };
        }
        function cardSessions(sessions) {
          var out = [];
          sessions.forEach(function(session) {
            if (session.id !== LEGACY_SESSION) {
              out.push(session);
              return;
            }
            var groups = {};
            var order = [];
            session.reviews.forEach(function(r) {
              var key = typeof r.project === "string" && r.project ? r.project : "";
              if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                groups[key] = [];
                order.push(key);
              }
              groups[key].push(r);
            });
            order.forEach(function(key) {
              var reviews = groups[key];
              var last = reviews.reduce(function(m, r) {
                return !m || Date.parse(r.last) > Date.parse(m) ? r.last : m;
              }, null);
              out.push(assign({}, session, {
                id: key ? LEGACY_SESSION + ":" + key : LEGACY_SESSION,
                legacyProject: key || null,
                projects: key ? [key] : [],
                reviews,
                last
              }));
            });
          });
          return out;
        }
        function hoistNotes(rows) {
          if (rows.length < 2) return [];
          var shared = rows[0].notices.filter(function(n) {
            return rows.every(function(row) {
              return row.notices.some(function(m) {
                return m.text === n.text;
              });
            });
          });
          if (!shared.length) return [];
          rows.forEach(function(row) {
            row.notices = row.notices.filter(function(n) {
              return !shared.some(function(m) {
                return m.text === n.text;
              });
            });
          });
          return shared.map(function(n) {
            return { text: n.text, tone: n.tone };
          });
        }
        function actingOn(state, reviewId) {
          return !!(state.panel && state.panel.review === reviewId || state.menu === reviewId || state.opening && state.opening[reviewId] || state.notes && state.notes[reviewId]);
        }
        function terms(query) {
          return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
        }
        function matchesAll(haystack, ts) {
          for (var i = 0; i < ts.length; i += 1) if (haystack.indexOf(ts[i]) === -1) return false;
          return true;
        }
        function sessionHaystack(session) {
          return [session.custom_name, session.name, sessionTitle(session)].filter(function(v) {
            return typeof v === "string";
          }).join("\n").toLowerCase();
        }
        function rowHaystack(review) {
          return [review.custom_name, review.display_name, review.title, review.file, review.folder, review.path_hint, review.project].filter(function(v) {
            return typeof v === "string";
          }).join("\n").toLowerCase();
        }
        function projectOptions(sessions) {
          var seen = {};
          var names = [];
          sessions.forEach(function(s) {
            (s.projects || []).forEach(function(p) {
              if (!Object.prototype.hasOwnProperty.call(seen, p)) {
                seen[p] = true;
                names.push(p);
              }
            });
          });
          names.sort();
          return [{ value: "", label: TEXT.ALL_PROJECTS }].concat(
            names.map(function(p) {
              return { value: p, label: p };
            })
          );
        }
        function banner(state, list) {
          if (state.fetch === "unauthorized") return { tone: "error", text: TEXT.RESTARTED, action: "reload", actionLabel: TEXT.RELOAD };
          if (state.fetch === "unreachable") return { tone: "error", text: TEXT.NOT_RUNNING, action: null };
          if (state.fetch === "failed") return { tone: "error", text: fill(TEXT.LIST_FAILED, { why: state.fetchFailure }), action: null };
          var b = state.banner;
          if (!b) return null;
          if (b.kind === "opening") {
            return {
              tone: "progress",
              text: b.agent ? fill(TEXT.OPENING_HANDOFF, { name: b.name, agent: b.agent }) : fill(TEXT.OPENING, { name: b.name }),
              action: null
            };
          }
          if (b.kind === "opened") {
            if (b.requestId) {
              var found = findReview(list, b.review);
              var q = found && found.review.request;
              if (q && q.id === b.requestId) {
                if (q.state === "done") return { tone: "ok", text: fill(TEXT.DONE_AFTER_OPEN, { name: b.name, agent: b.agent }), action: null };
                if (q.state !== "waiting") return null;
              }
              return { tone: "progress", text: fill(TEXT.OPENED_WAITING, { name: b.name, agent: b.agent }), action: null };
            }
            if (b.watched) return { tone: "ok", text: fill(TEXT.DONE_AFTER_OPEN, { name: b.name, agent: b.agent }), action: null };
            return { tone: "ok", text: fill(TEXT.OPENED, { name: b.name }), action: null };
          }
          return null;
        }
        function dialogView(state, list, now, opts) {
          var d = state.dialog;
          if (!d) return null;
          var found = findReview(list, d.review);
          var agent = liveAgent(list);
          var direct = d.action === "launch" && directLaunch(list);
          if (!found || !agent && !direct) return null;
          var others = found.session.reviews.filter(function(r) {
            return r.id !== d.review;
          }).map(function(r) {
            return r.display_name || r.id;
          });
          var body = fill(direct ? TEXT.CONFIRM_BODY_LAUNCH : TEXT.CONFIRM_BODY, {
            name: found.review.display_name || found.review.id,
            session: sessionTitle(found.session),
            agent: agent ? agent.name : ""
          });
          if (others.length) body += " " + TEXT.CONFIRM_MOVES;
          var waiting = waitingIn(found.session);
          var status = watchText(found.session, list, now, opts, true) + ".";
          if (waiting > 0) status += " " + (waiting === 1 ? TEXT.WAITING_ONE : fill(TEXT.WAITING_MANY, { n: waiting }));
          var buttons = [{ id: "move", label: TEXT.CONFIRM_MOVE }];
          if (found.review.openable === "yes") buttons.push({ id: "read", label: TEXT.CONFIRM_READ });
          buttons.push({ id: "cancel", label: TEXT.CONFIRM_CANCEL });
          return { review: d.review, action: d.action, title: TEXT.CONFIRM_TITLE, status, body, reviews: others, buttons };
        }
        function build(list, state, now, opts) {
          state = state || initialState();
          opts = opts || {};
          var view = {
            title: TEXT.TITLE,
            agent: agentHeader(list),
            search: { placeholder: TEXT.SEARCH_PLACEHOLDER, value: state.query || "" },
            projects: { options: [], value: state.project || "" },
            banner: banner(state, list),
            dialog: list ? dialogView(state, list, now, opts) : null,
            loading: null,
            empty: null,
            notice: null,
            noMatches: null,
            sections: [],
            missing: null
          };
          if (!list) {
            if (state.fetch === "loading") view.loading = TEXT.LOADING;
            return view;
          }
          var sessions = list.sessions || [];
          view.projects.options = projectOptions(sessions);
          if (list.notice === "PROTO_CATALOG_UNREADABLE") view.notice = TEXT.STARS_UNREADABLE;
          if (!sessions.length) {
            view.empty = TEXT.EMPTY;
            return view;
          }
          var ts = terms(state.query);
          var searching = ts.length > 0;
          var weekMs = CATALOG.DEFAULT_VIEW_DAYS * 24 * 60 * 60 * 1e3;
          var top = [];
          var week = [];
          var older = [];
          var olderReviews = 0;
          var missingRows = [];
          cardSessions(sessions).forEach(function(session) {
            if (state.project && (session.projects || []).indexOf(state.project) === -1) return;
            var wholeCard = searching && matchesAll(sessionHaystack(session), ts);
            var sessionText = sessionHaystack(session);
            var kept = session.reviews.filter(function(r) {
              return !searching || wholeCard || matchesAll(sessionText + "\n" + rowHaystack(r), ts);
            });
            var visible = [];
            kept.forEach(function(r) {
              if (r.openable === "missing") missingRows.push({ review: r, session });
              else visible.push(r);
            });
            if (!visible.length) return;
            var needs = visible.filter(function(r) {
              return r.waiting > 0 || effectiveStar(r, state);
            });
            var others = visible.filter(function(r) {
              return needs.indexOf(r) === -1;
            });
            if (needs.length) top.push(makeCard(session, needs, session.id, true));
            if (others.length) {
              var othersLast = others.reduce(function(m, r) {
                return !m || Date.parse(r.last) > Date.parse(m) ? r.last : m;
              }, null);
              var bucket = now - Date.parse(othersLast) < weekMs ? week : older;
              if (bucket === older) olderReviews += others.length;
              var restId = needs.length ? session.id + ":earlier" : session.id;
              bucket.push(makeCard(session, others, restId, bucket !== older, othersLast));
            }
          });
          function makeCard(session, visible, cardId, defaultOpen, lastAt) {
            var open = searching ? true : Object.prototype.hasOwnProperty.call(state.expanded || {}, cardId) ? state.expanded[cardId] : defaultOpen;
            var waiting = visible.reduce(function(sum, r) {
              return sum + (r.waiting || 0);
            }, 0);
            var rows = visible.map(function(r) {
              return buildRow(r, session, list, state, now, opts, session.watching || null, true);
            });
            var notes = hoistNotes(rows);
            var more = null;
            var cardOpenAll = !!(state.cardMore && state.cardMore[cardId]);
            if (!searching && rows.length > CARD_ROWS_SHOWN) {
              var hidden = 0;
              if (!cardOpenAll) {
                rows = rows.filter(function(row, i) {
                  var r = visible[i];
                  var keep = i < CARD_ROWS_SHOWN || r.waiting > 0 || row.starred || actingOn(state, r.id);
                  if (!keep) hidden += 1;
                  return keep;
                });
              }
              if (cardOpenAll) more = { text: TEXT.SHOW_FEWER, expanded: true };
              else if (hidden > 0) more = { text: fill(TEXT.SHOW_MORE, { n: hidden }), expanded: false };
            }
            var original = sessionTitle(session);
            var renamed = sessionCustomName(session, state);
            if (renamed === original) renamed = null;
            var renameKey = SESSION_KEY + session.id;
            var at = lastAt || session.last;
            return {
              id: cardId,
              session: session.id,
              title: renamed || original,
              originalTitle: renamed ? original : null,
              // A pre-session card is ours, not a session: it has no name to change.
              rename: isLegacy(session) ? null : { editing: state.renaming === renameKey, value: renamed || original, label: TEXT.RENAME, original },
              projects: (session.projects || []).slice(),
              reviewsText: plural(visible.length, "review", "reviews"),
              watchText: watchText(session, list, now, opts, false),
              watched: !!session.watching,
              waitingText: waiting > 0 ? waiting + " waiting" : null,
              lastText: "last " + formatTime(at, now, opts.timeZone),
              open,
              lastAt: at,
              notes,
              more,
              rows
            };
          }
          [top, week, older].forEach(function(bucket) {
            bucket.sort(function(a, b) {
              var am = Date.parse(a.lastAt) || 0;
              var bm = Date.parse(b.lastAt) || 0;
              return bm - am;
            });
          });
          if (top.length) view.sections.push({ id: "top", heading: fill(TEXT.SECTION_TOP, { n: top.length }), cards: top });
          if (week.length) view.sections.push({ id: "week", heading: fill(TEXT.SECTION_WEEK, { n: week.length }), cards: week });
          if (older.length) {
            view.sections.push({
              id: "older",
              heading: fill(TEXT.SECTION_OLDER, { reviews: plural(olderReviews, "review", "reviews") }),
              subtitle: TEXT.SECTION_OLDER_NOTE,
              cards: older
            });
          }
          if (missingRows.length) {
            view.missing = {
              shown: !!state.showMissing,
              toggleText: fill(TEXT.SHOW_MISSING, { n: missingRows.length }),
              section: state.showMissing ? {
                heading: fill(TEXT.MISSING_HEADING, { n: missingRows.length }),
                hideText: TEXT.HIDE,
                rows: missingRows.map(function(m) {
                  return buildRow(m.review, m.session, list, state, now, opts, null, false);
                })
              } : null
            };
          }
          if (searching && !view.sections.length && !view.missing) view.noMatches = TEXT.NO_MATCHES;
          return view;
        }
        function findReview(list, reviewId) {
          var sessions = list && list.sessions || [];
          for (var s = 0; s < sessions.length; s += 1) {
            for (var r = 0; r < sessions[s].reviews.length; r += 1) {
              if (sessions[s].reviews[r].id === reviewId) return { review: sessions[s].reviews[r], session: sessions[s] };
            }
          }
          return null;
        }
        function isOpening(state, reviewId) {
          return !!(state && state.opening && state.opening[reviewId]);
        }
        function watchedByOther(session, agent) {
          return !!(session.watching && agent && session.watching.session !== agent.session);
        }
        function decide(list, state, reviewId, action, options) {
          options = options || {};
          var found = findReview(list, reviewId);
          if (!found || found.review.openable === "missing") return { kind: "none" };
          if (isOpening(state, reviewId)) return { kind: "none" };
          var review = found.review;
          var agent = liveAgent(list);
          var viaAgent = review.openable === "via-agent";
          var waiting = !!(review.request && review.request.state === "waiting");
          var already = {
            kind: "already",
            review: reviewId,
            note: { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: review.request && review.request.by_name || agent && agent.name || "the agent" }), tone: "info" }
          };
          if (action === "open") {
            if (viaAgent && !agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
            if (options.read && !viaAgent) {
              return { kind: "open", review: reviewId, tab: true, body: { review: reviewId, handoff: false, confirmed: false } };
            }
            if (viaAgent && waiting) return already;
            var handoff = !!agent && !waiting;
            if (handoff && watchedByOther(found.session, agent) && !options.confirmed) {
              return { kind: "confirm", review: reviewId, action };
            }
            return {
              kind: "open",
              review: reviewId,
              tab: !viaAgent,
              body: { review: reviewId, handoff, confirmed: !!options.confirmed }
            };
          }
          if (action === "launch" && directLaunch(list)) {
            if (waiting) return already;
            if (found.session.watching && !options.confirmed) return { kind: "confirm", review: reviewId, action };
            return { kind: "request", review: reviewId, body: { review: reviewId, action, confirmed: !!options.confirmed } };
          }
          if (action === "pickup" || action === "launch") {
            if (!agent) return { kind: "handoff", review: reviewId, reason: "no_agent" };
            if (waiting) return already;
            if (watchedByOther(found.session, agent) && !options.confirmed) {
              return { kind: "confirm", review: reviewId, action };
            }
            return { kind: "request", review: reviewId, body: { review: reviewId, action, confirmed: !!options.confirmed } };
          }
          return { kind: "none" };
        }
        function clearRow(state, reviewId) {
          var out = assign({}, state, { notes: withKey(state.notes, reviewId, void 0) });
          if (out.panel && out.panel.review === reviewId) out.panel = null;
          if (out.dialog && out.dialog.review === reviewId) out.dialog = null;
          return out;
        }
        function errorText(error) {
          if (!error) return TEXT.UNKNOWN_ERROR;
          return [error.message, error.remedy].filter(function(t) {
            return typeof t === "string" && t;
          }).join(" ") || TEXT.UNKNOWN_ERROR;
        }
        function refused(state, list, reviewId, action, result, now) {
          if (result.unreachable) return withFetch(state, { ok: false, unreachable: true });
          if (result.status === 401) return withFetch(state, { ok: false, status: 401 });
          var code = result.error && result.error.code;
          var found = findReview(list, reviewId);
          var agent = liveAgent(list);
          var agentName = found && found.review.request && found.review.request.by_name || agent && agent.name || "the agent";
          if (code === "PROTO_CONFIRM_NEEDED") return withDialog(state, reviewId, action);
          if (code === "PROTO_NO_AGENT") return withPanel(state, reviewId, "no_agent");
          if (code === "PROTO_REQUEST_PENDING") {
            return withNote(state, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: agentName }), tone: "info" }, now);
          }
          if (code === "PROTO_QUEUE_FULL") return withNote(state, reviewId, { kind: "error", text: TEXT.QUEUE_FULL, tone: "warn" }, now);
          return withNote(state, reviewId, { kind: "error", text: errorText(result.error), tone: "warn" }, now);
        }
        function beginOpen(state, list, reviewId, options) {
          options = options || {};
          var out = clearRow(state, reviewId);
          out.opening = withKey(state.opening, reviewId, true);
          var found = findReview(list, reviewId);
          var agent = liveAgent(list);
          if (!found || options.tab === false) return assign(out, { banner: null });
          return assign(out, {
            banner: {
              kind: "opening",
              review: reviewId,
              name: found.review.display_name || reviewId,
              agent: options.handoff && agent ? agent.name : null
            }
          });
        }
        function afterOpen(state, list, reviewId, result, now) {
          var opening = state.banner && state.banner.review === reviewId ? state.banner : null;
          var out = assign({}, state, { banner: null, opening: withKey(state.opening, reviewId, void 0) });
          if (!result || !result.ok) {
            if (result && result.urlRefused) return withNote(out, reviewId, { kind: "error", text: TEXT.URL_REFUSED, tone: "warn" }, now);
            return refused(out, list, reviewId, "open", result || { unreachable: true }, now);
          }
          var body = result.body || {};
          var found = findReview(list, reviewId);
          var agent = liveAgent(list);
          var name = found ? found.review.display_name || reviewId : reviewId;
          if (body.held_by && typeof body.held_by.name === "string") {
            out = withNote(out, reviewId, { kind: "opened", text: fill(TEXT.OPENED_RAIL_HELD, { name: body.held_by.name }), tone: "info" }, now);
          }
          if (body.retired === true && !body.held_by) {
            out = withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_RETIRED, tone: "info" }, now);
          }
          if (body.not_asked === "queue_full") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_QUEUE_FULL, tone: "warn" }, now);
          if (body.not_asked === "no_agent") return withNote(out, reviewId, { kind: "opened", text: TEXT.OPENED_NO_AGENT, tone: "warn" }, now);
          if (body.not_asked === "request_pending" && body.url) {
            var pendingAgent = found && found.review.request && found.review.request.by_name || agent && agent.name || "the agent";
            out = withNote(out, reviewId, { kind: "already", text: fill(TEXT.ALREADY_WAITING, { agent: pendingAgent }), tone: "info" }, now);
            return assign(out, { banner: { kind: "opened", review: reviewId, name, agent: null, requestId: null, watched: false } });
          }
          if (!body.url) {
            if (!body.request_id) return out;
            return withNote(out, reviewId, {
              kind: "waiting",
              text: fill(TEXT.WAITING, { agent: agent ? agent.name : "the agent" }),
              tone: "info",
              busy: true,
              action: "pickup",
              requestId: body.request_id
            }, now);
          }
          var handedOver = !!(opening && opening.agent);
          return assign(out, {
            banner: {
              kind: "opened",
              review: reviewId,
              name,
              agent: handedOver ? opening.agent : null,
              requestId: handedOver && body.request_id ? body.request_id : null,
              watched: !!(handedOver && agent && found && found.session.watching && found.session.watching.session === agent.session)
            }
          });
        }
        function afterRequest(state, list, reviewId, action, result, now) {
          var out = clearRow(state, reviewId);
          if (!result || !result.ok) return refused(out, list, reviewId, action, result || { unreachable: true }, now);
          var agent = liveAgent(list);
          if (result.body && typeof result.body.launched === "boolean") {
            return withNote(out, reviewId, {
              kind: result.body.launched ? "launched" : "error",
              text: result.body.text || TEXT.LAUNCHING,
              tone: result.body.launched ? "ok" : "warn",
              requestId: result.body.request_id || null
            }, now);
          }
          if (result.body && result.body.request_id === null) {
            return withNote(out, reviewId, {
              kind: "has",
              text: fill(TEXT.ALREADY_HAS, { agent: agent ? agent.name : "the agent" }),
              tone: "ok"
            }, now);
          }
          return withNote(out, reviewId, {
            kind: "waiting",
            text: fill(TEXT.WAITING, { agent: agent ? agent.name : "the agent" }),
            tone: "info",
            busy: true,
            action,
            requestId: result.body && result.body.request_id || null
          }, now);
        }
        function beginStar(state, reviewId, desired) {
          return assign({}, state, { starPending: withKey(state.starPending, reviewId, !!desired) });
        }
        function afterStar(state, reviewId, desired, result, now) {
          var out = assign({}, state, { starPending: withKey(state.starPending, reviewId, void 0) });
          if (result && result.ok) {
            out.starOverride = withKey(state.starOverride, reviewId, !!desired);
            out.notes = withKey(state.notes, reviewId, void 0);
            return out;
          }
          if (result && result.status === 401) return withFetch(out, { ok: false, status: 401 });
          var why = !result || result.unreachable ? TEXT.STAR_NOT_RUNNING : result.error && (result.error.remedy || result.error.message) || TEXT.UNKNOWN_ERROR;
          return withNote(out, reviewId, { kind: "error", text: fill(TEXT.STAR_FAILED, { why: withoutFinalPeriod(why) }), tone: "warn" }, now);
        }
        function isLaheSiteUrl(value) {
          if (typeof value !== "string" || !value) return false;
          var parsed;
          try {
            parsed = new URL(value);
          } catch (err) {
            return false;
          }
          if (parsed.protocol !== "http:" || parsed.username || parsed.password) return false;
          var suffix = "." + protocol.PAGES.SUFFIX;
          var host = parsed.hostname;
          if (host.length <= suffix.length || host.slice(-suffix.length) !== suffix) return false;
          return protocol.isSiteName(host.slice(0, -suffix.length));
        }
        function addressLink(value) {
          if (!isLaheSiteUrl(value)) return null;
          var parsed = new URL(value);
          var readable = parsed.pathname;
          try {
            readable = decodeURIComponent(parsed.pathname);
          } catch (err) {
            readable = parsed.pathname;
          }
          return { href: value, text: parsed.host + readable };
        }
        function isLoopbackHttpUrl(value) {
          if (typeof value !== "string" || !value) return false;
          var parsed;
          try {
            parsed = new URL(value);
          } catch (err) {
            return false;
          }
          if (parsed.protocol !== "http:") return false;
          if (parsed.username || parsed.password) return false;
          return protocol.LOOPBACK_ORIGIN_HOSTS.indexOf(parsed.hostname) !== -1;
        }
        return {
          TEXT,
          initialState,
          withFetch,
          shouldPoll,
          withQuery,
          withProject,
          withShowMissing,
          withExpanded,
          withPagesOpen,
          withRenaming,
          beginRename,
          afterRename,
          withCardMore,
          CARD_ROWS_SHOWN,
          withPanel,
          withMenu,
          withDialog,
          withCopied,
          popupBlocked,
          withNote,
          afterList,
          beginOpen,
          afterOpen,
          afterRequest,
          beginStar,
          afterStar,
          isLoopbackHttpUrl,
          isLaheSiteUrl,
          formatTime,
          build,
          decide
        };
      });
    }
  });

  // src/layer/copy_text.js
  var require_copy_text = __commonJS({
    "src/layer/copy_text.js"(exports, module) {
      (function(root, factory) {
        "use strict";
        var browser = typeof window !== "undefined" && !!window.document;
        if (browser) {
          root.LAHE = root.LAHE || {};
          root.LAHE.copyText = factory();
        } else {
          module.exports = factory();
        }
      })(typeof globalThis !== "undefined" ? globalThis : exports, function() {
        "use strict";
        function copyViaField(doc, text) {
          if (!doc || !doc.body || typeof doc.execCommand !== "function") return false;
          var before = doc.activeElement;
          var field = doc.createElement("textarea");
          field.value = text;
          field.setAttribute("readonly", "");
          field.setAttribute("aria-hidden", "true");
          field.setAttribute("tabindex", "-1");
          field.style.position = "fixed";
          field.style.top = "0";
          field.style.left = "-9999px";
          field.style.opacity = "0";
          doc.body.appendChild(field);
          var ok = false;
          try {
            field.focus({ preventScroll: true });
            field.select();
            field.setSelectionRange(0, text.length);
            ok = doc.execCommand("copy") === true;
          } catch (err) {
            ok = false;
          }
          if (field.parentNode) field.parentNode.removeChild(field);
          if (before && typeof before.focus === "function") {
            try {
              before.focus({ preventScroll: true });
            } catch (err) {
            }
          }
          return ok;
        }
        function copyText(text, env) {
          var e = env || {};
          var nav = e.navigator || (typeof navigator !== "undefined" ? navigator : null);
          var doc = e.document || (typeof document !== "undefined" ? document : null);
          var value = String(text === void 0 || text === null ? "" : text);
          if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
            var attempt;
            try {
              attempt = Promise.resolve(nav.clipboard.writeText(value));
            } catch (err) {
              attempt = Promise.reject(err);
            }
            return attempt.then(
              function() {
                return true;
              },
              // Refused (no permission, or the page lost focus): the field may
              // still work.
              function() {
                return copyViaField(doc, value);
              }
            );
          }
          return Promise.resolve(copyViaField(doc, value));
        }
        return copyText;
      });
    }
  });

  // lahe-entry.js
  var import_protocol = __toESM(require_protocol());
  var import_view_model = __toESM(require_view_model());
  var import_copy_text = __toESM(require_copy_text());

  // src/layer/catalog/page.js
  (function() {
    "use strict";
    var protocol = window.LAHE && window.LAHE.protocol;
    var VM = window.LAHE && window.LAHE.catalogViewModel;
    var copyText = window.LAHE && window.LAHE.copyText;
    var statusLine = document.getElementById("lahe-catalog-status");
    if (!protocol || !VM || !copyText) {
      if (statusLine) statusLine.textContent = "The Library could not load its scripts. Reload this page.";
      return;
    }
    var meta = document.querySelector('meta[name="' + protocol.CATALOG_TOKEN_META + '"]');
    var token = meta && meta.getAttribute("content");
    if (!token) {
      if (statusLine) statusLine.textContent = "The Library token is missing. Reload this page.";
      return;
    }
    var ROUTE = {
      list: protocol.route("catalog.list"),
      open: protocol.route("catalog.open"),
      star: protocol.route("catalog.star"),
      rename: protocol.route("catalog.rename"),
      request: protocol.route("catalog.request")
    };
    var els = {
      agent: document.getElementById("lahe-catalog-agent"),
      search: document.getElementById("lahe-catalog-search"),
      project: document.getElementById("lahe-catalog-project"),
      banner: document.getElementById("lahe-catalog-banner"),
      main: document.getElementById("lahe-catalog-main"),
      dialog: document.getElementById("lahe-catalog-confirm")
    };
    var list = null;
    var state = VM.initialState();
    var lastRendered = null;
    var timer = null;
    function headers(json) {
      var h2 = {};
      h2[protocol.HEADER.CLIENT] = protocol.CLIENT_CATALOG;
      h2[protocol.HEADER.TOKEN] = token;
      if (json) h2[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
      return h2;
    }
    function call(route, body) {
      var init = {
        method: route.method,
        headers: headers(route.method !== "GET"),
        credentials: "same-origin",
        cache: "no-store"
      };
      if (route.method !== "GET") init.body = JSON.stringify(body || {});
      return fetch(route.path, init).then(
        function(res) {
          return res.text().then(function(text) {
            var parsed = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch (err) {
              parsed = null;
            }
            if (res.ok) return { ok: true, status: res.status, body: parsed || {} };
            return { ok: false, status: res.status, error: parsed && parsed.error || null };
          });
        },
        function() {
          return { ok: false, unreachable: true };
        }
      );
    }
    var polling = null;
    function poll() {
      if (!VM.shouldPoll(state)) return Promise.resolve();
      if (polling) return polling;
      polling = call(ROUTE.list).then(function(result) {
        polling = null;
        if (result.ok && result.body && Array.isArray(result.body.sessions)) {
          list = result.body;
          state = VM.afterList(VM.withFetch(state, { ok: true }), list);
        } else if (result.ok) {
          state = VM.withFetch(state, { ok: false, status: 500, error: { message: "The helper sent a list the page cannot read." } });
        } else {
          state = VM.withFetch(state, result);
        }
        if (!VM.shouldPoll(state)) stopPolling();
        render();
      });
      return polling;
    }
    function stopPolling() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }
    window.__laheCatalogPollNow = function() {
      return poll().then(function() {
        render();
      });
    };
    function update(next) {
      state = next;
      render();
    }
    function now() {
      return Date.now();
    }
    function act(reviewId, action, options) {
      var d = VM.decide(list, state, reviewId, action, options || {});
      if (d.kind === "none") return;
      if (d.kind === "handoff") {
        focusKey(reviewId + ":copy");
        update(VM.withDialog(VM.withPanel(state, reviewId, d.reason), null));
        return;
      }
      if (d.kind === "already") {
        update(VM.withNote(state, reviewId, d.note, now()));
        return;
      }
      if (d.kind === "confirm") {
        update(VM.withDialog(state, reviewId, d.action));
        return;
      }
      update(VM.withDialog(state, null));
      if (d.kind === "request") {
        call(ROUTE.request, d.body).then(function(result) {
          update(VM.afterRequest(state, list, reviewId, d.body.action, result, now()));
          poll();
        });
        return;
      }
      if (d.kind === "open") openReview(reviewId, d);
    }
    function openReview(reviewId, d) {
      var tab = null;
      if (d.tab) {
        tab = window.open("about:blank", "_blank");
        if (!tab) {
          update(VM.popupBlocked(state, reviewId, now()));
          return;
        }
        awayInTab = true;
        try {
          tab.opener = null;
        } catch (err) {
        }
      }
      update(VM.beginOpen(state, list, reviewId, { handoff: d.body.handoff, tab: d.tab }));
      call(ROUTE.open, d.body).then(function(result) {
        var url = result.ok && result.body ? result.body.url : null;
        if (tab) {
          if (result.ok && (VM.isLoopbackHttpUrl(url) || VM.isLaheSiteUrl(url))) {
            tab.location.href = url;
          } else {
            tab.close();
            if (result.ok && url !== null && url !== void 0) result = { ok: false, urlRefused: true };
          }
        }
        update(VM.afterOpen(state, list, reviewId, result, now()));
        poll();
      });
    }
    function star(reviewId, desired) {
      update(VM.beginStar(state, reviewId, desired));
      call(ROUTE.star, { review: reviewId, starred: desired }).then(function(result) {
        update(VM.afterStar(state, reviewId, desired, result, now()));
        poll();
      });
    }
    var renameDraft = { id: null, value: "" };
    function startRename(reviewId) {
      var found = null;
      renameDraft = { id: null, value: "" };
      focusKey(reviewId + ":rename-input");
      update(VM.withRenaming(state, reviewId));
      found = els.main.querySelector('[data-key="' + cssEscape(reviewId + ":rename-input") + '"]');
      if (found && found.select) found.select();
    }
    var renameClosing = false;
    var blurTarget = false;
    function blurring() {
      return blurTarget;
    }
    function commitRename(input) {
      var id = input.getAttribute("data-rename");
      var typed = String(input.value || "").trim();
      var current = input.getAttribute("data-current") || "";
      var original = input.getAttribute("data-original") || "";
      if (!typed || typed === current) {
        cancelRename(id);
        return;
      }
      saveRename(id, typed === original ? "" : typed);
    }
    function saveRename(reviewId, value) {
      renameDraft = { id: null, value: "" };
      if (!blurring()) focusKey(reviewId + ":rename");
      update(VM.beginRename(state, reviewId, value));
      var body = reviewId.indexOf("session:") === 0 ? { session: reviewId.slice("session:".length), name: value } : { review: reviewId, name: value };
      call(ROUTE.rename, body).then(function(result) {
        update(VM.afterRename(state, reviewId, result, now()));
        poll();
      });
    }
    function cancelRename(reviewId) {
      renameDraft = { id: null, value: "" };
      if (!blurring()) focusKey(reviewId + ":rename");
      update(VM.withRenaming(state, null));
    }
    function copyHandoff(reviewId, message) {
      copyText(message).then(function(ok) {
        update(VM.withCopied(state, reviewId, ok));
      });
    }
    function onClick(event) {
      var btn = event.target.closest ? event.target.closest("[data-act]") : null;
      if (!btn || btn.disabled) return;
      var id = btn.getAttribute("data-review");
      var what = btn.getAttribute("data-act");
      if (what === "open") act(id, what);
      else if (what === "pickup" || what === "launch") {
        state = VM.withMenu(state, null);
        act(id, what);
      } else if (what === "menu") {
        if (btn.getAttribute("aria-expanded") === "true") update(VM.withMenu(state, null));
        else {
          focusKey(id + ":pickup");
          update(VM.withMenu(state, id));
        }
      } else if (what === "star") star(id, btn.getAttribute("aria-pressed") !== "true");
      else if (what === "rename") {
        event.preventDefault();
        startRename(id);
      } else if (what === "rename-session") {
        event.preventDefault();
        startRename("session:" + btn.getAttribute("data-session"));
      } else if (what === "pages") update(VM.withPagesOpen(state, id, btn.getAttribute("aria-expanded") !== "true"));
      else if (what === "more") update(VM.withCardMore(state, btn.getAttribute("data-card"), btn.getAttribute("aria-expanded") !== "true"));
      else if (what === "handoff") {
        focusKey(id + ":copy");
        update(VM.withPanel(state, id, btn.getAttribute("data-reason") || "no_agent"));
      } else if (what === "copy") copyHandoff(id, btn.getAttribute("data-message") || "");
      else if (what === "close-panel") update(VM.withPanel(state, null));
      else if (what === "show-missing") update(VM.withShowMissing(state, true));
      else if (what === "hide-missing") update(VM.withShowMissing(state, false));
      else if (what === "reload") window.location.reload();
      else if (what === "move") act(id, btn.getAttribute("data-action"), { confirmed: true });
      else if (what === "read") act(id, "open", { read: true });
      else if (what === "cancel") update(VM.withDialog(state, null));
    }
    function h(tag, attrs, children) {
      var node = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function(k) {
          var v = attrs[k];
          if (v === null || v === void 0 || v === false) return;
          if (k === "text") node.textContent = String(v);
          else node.setAttribute(k, v === true ? "" : String(v));
        });
      }
      (children || []).forEach(function(child) {
        if (child === null || child === void 0) return;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      });
      return node;
    }
    function slashBreaks(text) {
      var out = [];
      String(text).split("/").forEach(function(part, i, all) {
        out.push(part + (i < all.length - 1 ? "/" : ""));
        if (i < all.length - 1) out.push(document.createElement("wbr"));
      });
      return out;
    }
    function button(label, attrs) {
      return h("button", Object.assign({ type: "button", class: "lib-btn", text: label }, attrs || {}));
    }
    function actionButton(row, key, primary) {
      var b = row.buttons[key];
      return button(b.label, {
        "data-act": key,
        "data-review": row.id,
        "data-key": row.id + ":" + key,
        "data-primary": primary ? "true" : null,
        "aria-busy": b.busy ? "true" : null,
        title: b.reason || null,
        disabled: !b.enabled
      });
    }
    function waitingMark(text) {
      return h("span", { class: "lib-waiting" }, [h("span", { class: "lib-dot", "aria-hidden": "true" }), text]);
    }
    function renderRow(row, extra) {
      var nameLine;
      if (row.rename.editing) {
        var typed = renameDraft.id === row.id ? renameDraft.value : row.rename.value;
        nameLine = h("p", { class: "lib-name lib-rename" }, [
          h("input", {
            type: "text",
            class: "lib-rename-input",
            "data-rename": row.id,
            "data-key": row.id + ":rename-input",
            "data-current": row.rename.value,
            "data-original": row.rename.original,
            value: typed,
            maxlength: "80",
            "aria-label": row.rename.label + ": " + row.rename.original,
            placeholder: row.rename.original
          })
        ]);
      } else {
        nameLine = h("p", { class: "lib-name-line" }, [
          h("button", {
            type: "button",
            class: "lib-name",
            "data-act": "rename",
            "data-review": row.id,
            "data-key": row.id + ":rename",
            "aria-label": row.rename.label + ": " + row.name,
            title: row.rename.label,
            text: row.name
          })
        ]);
      }
      var main = h("div", { class: "lib-row-main" }, [
        nameLine,
        row.originalName ? h("p", { class: "lib-original", text: row.originalName }) : null,
        row.path ? h("p", { class: "lib-where", title: row.pathTitle || null }, slashBreaks(row.path)) : null,
        row.address ? h("p", { class: "lib-address" }, [
          h("a", {
            href: row.address.href,
            target: "_blank",
            rel: "noopener noreferrer",
            "data-act-link": "address",
            "data-review": row.id,
            text: row.address.text
          })
        ]) : null
      ]);
      var facts = [h("span", { text: row.lastText })];
      if (extra) facts.push(h("span", { text: extra }));
      if (row.counts.waiting) facts.push(waitingMark(row.counts.waiting));
      facts.push(h("span", { text: row.counts.comments }));
      if (row.counts.asOf) facts.push(h("span", { text: row.counts.asOf }));
      row.badges.forEach(function(b) {
        var kind = b.indexOf("agent listening") === 0 || b.indexOf("agent working") === 0 ? "watching" : b === "being served now" ? "served" : "ended";
        facts.push(h("span", { class: "lib-badge", "data-badge": kind, text: b }));
      });
      if (row.folded) facts.push(h("span", { text: row.folded }));
      main.appendChild(h("div", { class: "lib-facts" }, facts));
      if (row.pagesToggle) {
        main.appendChild(
          h("p", { class: "lib-line" }, [
            button(row.pagesToggle.text, {
              "data-act": "pages",
              "data-review": row.id,
              "data-key": row.id + ":pages",
              "data-quiet": "true",
              "data-disclosure": "true",
              "aria-expanded": row.pagesToggle.expanded ? "true" : "false"
            })
          ])
        );
      }
      if (row.pages.length) {
        main.appendChild(
          h(
            "ul",
            { class: "lib-pages", "aria-label": "Pages" },
            row.pages.map(function(p) {
              return h("li", null, [h("span", { text: p.title }), p.title !== p.path ? h("span", { class: "lib-path", text: p.path }) : null]);
            })
          )
        );
      }
      row.notices.forEach(function(n) {
        main.appendChild(h("p", { class: "lib-line", "data-tone": n.tone, text: n.text }));
      });
      if (row.note) {
        var noteKids = [h("span", { class: "lib-mark", "aria-hidden": "true" }), h("span", { class: "lib-note-text", text: row.note.text })];
        if (row.note.copyHandoff) {
          noteKids.push(
            button(row.handoffLabel, {
              "data-act": "handoff",
              "data-reason": "refused",
              "data-review": row.id,
              "data-key": row.id + ":handoff",
              "data-quiet": "true"
            })
          );
        }
        main.appendChild(
          h("p", { class: "lib-note", "data-tone": row.note.tone, "data-busy": row.note.busy ? "true" : "false" }, noteKids)
        );
      }
      if (row.offerHandoff) {
        main.appendChild(
          h("p", { class: "lib-line" }, [
            button(row.handoffLabel, {
              "data-act": "handoff",
              "data-reason": "no_agent",
              "data-review": row.id,
              "data-key": row.id + ":handoff",
              "data-quiet": "true"
            })
          ])
        );
      }
      var starBtn = h("button", {
        type: "button",
        class: "lib-star",
        "data-act": "star",
        "data-review": row.id,
        "data-key": row.id + ":star",
        "aria-pressed": row.star.on ? "true" : "false",
        "aria-label": row.star.label,
        title: row.star.label,
        "aria-busy": row.star.pending ? "true" : null,
        disabled: !row.star.enabled || row.star.pending,
        text: row.star.on ? "\u2605" : "\u2606"
      });
      var actKids = [actionButton(row, "open", true)];
      var hand = row.buttons.handTo;
      if (!hand.hidden) {
        var menuId = "lib-menu-" + row.id;
        var menuWrap = h("div", { class: "lib-menu" }, [
          button(hand.label, {
            "data-act": "menu",
            "data-review": row.id,
            "data-key": row.id + ":menu",
            "aria-haspopup": "true",
            "aria-expanded": hand.expanded ? "true" : "false",
            "aria-controls": hand.expanded ? menuId : null,
            "aria-busy": hand.busy ? "true" : null,
            title: hand.reason || null,
            disabled: !hand.enabled
          })
        ]);
        if (hand.expanded) {
          menuWrap.appendChild(
            h("div", { class: "lib-menu-list", id: menuId, role: "group", "aria-label": hand.label }, [
              actionButton(row, "pickup", false),
              actionButton(row, "launch", false)
            ])
          );
        }
        actKids.push(menuWrap);
      }
      var acts = h("div", { class: "lib-acts" }, actKids);
      var kids = [starBtn, main, acts];
      if (row.panel) {
        kids.push(
          h("div", { class: "lib-panel", role: "region", "aria-label": row.handoffLabel }, [
            h("p", { text: row.panel.intro }),
            row.panel.message ? h("pre", { text: row.panel.message }) : null,
            h("div", { class: "lib-panel-acts" }, [
              row.panel.message ? button(row.panel.copyLabel, {
                "data-act": "copy",
                "data-review": row.id,
                "data-key": row.id + ":copy",
                "data-message": row.panel.message,
                "data-primary": "true"
              }) : null,
              button(row.panel.closeLabel, { "data-act": "close-panel", "data-review": row.id, "data-key": row.id + ":close" }),
              row.panel.copyStatus ? h("span", { class: "lib-copy-status", role: "status", text: row.panel.copyStatus }) : null
            ])
          ])
        );
      }
      return h("li", { "data-review": row.id }, [h("div", { class: "lib-row" }, kids)]);
    }
    function cardTitle(card) {
      if (card.rename && card.rename.editing) {
        var key = "session:" + card.session;
        var typed = renameDraft.id === key ? renameDraft.value : card.rename.value;
        return h("span", { class: "lib-card-title" }, [
          h("input", {
            type: "text",
            class: "lib-rename-input",
            "data-rename": key,
            "data-key": key + ":rename-input",
            "data-current": card.rename.value,
            "data-original": card.rename.original,
            value: typed,
            maxlength: "80",
            "aria-label": card.rename.label + ": " + card.rename.original,
            placeholder: card.rename.original
          })
        ]);
      }
      var kids = [];
      if (card.rename) {
        kids.push(h("button", {
          type: "button",
          class: "lib-card-name",
          "data-act": "rename-session",
          "data-session": card.session,
          "data-key": "session:" + card.session + ":rename",
          "aria-label": card.rename.label + ": " + card.title,
          title: card.rename.label,
          text: card.title
        }));
      } else {
        kids.push(h("span", { text: card.title }));
      }
      if (card.originalTitle) kids.push(h("span", { class: "lib-card-original", text: card.originalTitle }));
      return h("span", { class: "lib-card-title" }, kids);
    }
    function renderCard(card) {
      var metaKids = card.projects.map(function(p) {
        return h("span", { class: "lib-project", text: p });
      });
      metaKids.push(h("span", { text: card.reviewsText }));
      metaKids.push(
        card.watched ? h("span", { class: "lib-card-watch" }, [h("span", { class: "lib-badge", "data-badge": "watching", text: card.watchText })]) : h("span", { class: "lib-card-watch", text: card.watchText })
      );
      if (card.waitingText) metaKids.push(waitingMark(card.waitingText));
      metaKids.push(h("span", { text: card.lastText }));
      var body = [
        h("summary", { "data-key": "card:" + card.id }, [
          h("span", { class: "lib-chev", "aria-hidden": "true" }),
          cardTitle(card),
          h("span", { class: "lib-card-meta" }, metaKids)
        ])
      ];
      if (card.notes && card.notes.length) {
        body.push(h("div", { class: "lib-card-notes" }, card.notes.map(function(n) {
          return h("p", { class: "lib-line", "data-tone": n.tone, text: n.text });
        })));
      }
      body.push(h("ul", { class: "lib-rows" }, card.rows.map(function(r) {
        return renderRow(r, null);
      })));
      if (card.more) {
        body.push(h("p", { class: "lib-card-more" }, [
          button(card.more.text, {
            "data-act": "more",
            "data-card": card.id,
            "data-key": "more:" + card.id,
            "data-quiet": "true",
            "data-disclosure": "true",
            "aria-expanded": card.more.expanded ? "true" : "false"
          })
        ]));
      }
      var details = h("details", { class: "lib-card", "data-session": card.id, open: card.open }, body);
      details.addEventListener("toggle", function() {
        if (details.open !== card.open) update(VM.withExpanded(state, card.id, details.open));
      });
      return details;
    }
    function renderMain(view) {
      var kids = [];
      if (view.notice) kids.push(h("p", { class: "lib-notice", text: view.notice }));
      if (view.loading) kids.push(h("p", { class: "lib-quiet", id: "lahe-catalog-status", text: view.loading }));
      if (view.empty) kids.push(h("p", { class: "lib-quiet", "data-state": "empty", text: view.empty }));
      if (view.noMatches) kids.push(h("p", { class: "lib-quiet", "data-state": "no-matches", text: view.noMatches }));
      view.sections.forEach(function(section) {
        kids.push(
          h("section", { class: "lib-section", "data-section": section.id }, [
            h("h2", { text: section.heading }),
            section.subtitle ? h("p", { class: "lib-section-sub", text: section.subtitle }) : null
          ].concat(section.cards.map(renderCard)))
        );
      });
      if (view.missing) {
        if (view.missing.section) {
          var sec = view.missing.section;
          kids.push(
            h("section", { class: "lib-section lib-missing", "data-section": "missing" }, [
              h("div", { class: "lib-section-head" }, [
                h("h2", { text: sec.heading }),
                button(sec.hideText, { "data-act": "hide-missing", "data-key": "missing:toggle", "data-quiet": "true" })
              ]),
              h("ul", { class: "lib-rows" }, sec.rows.map(function(r) {
                return renderRow(r, r.sessionText);
              }))
            ])
          );
        } else {
          kids.push(
            h("p", { class: "lib-missing-toggle" }, [
              button(view.missing.toggleText, { "data-act": "show-missing", "data-key": "missing:toggle", "data-quiet": "true" })
            ])
          );
        }
      }
      els.main.replaceChildren.apply(els.main, kids);
    }
    function renderBanner(banner) {
      if (!banner) {
        els.banner.replaceChildren();
        return;
      }
      var kids = [h("p", { text: banner.text })];
      if (banner.action === "reload") kids.push(button(banner.actionLabel, { "data-act": "reload", "data-key": "banner:reload", "data-primary": "true" }));
      var existing = els.banner.firstChild;
      if (existing && existing.getAttribute("data-text") === banner.text) return;
      els.banner.replaceChildren(h("div", { class: "lib-banner-box", "data-tone": banner.tone, "data-text": banner.text }, kids));
    }
    var lastDialog = null;
    function renderDialog(dialog) {
      var el = els.dialog;
      var serial = dialog ? JSON.stringify(dialog) : null;
      if (!dialog) {
        lastDialog = null;
        if (el.open) el.close();
        el.replaceChildren();
        return;
      }
      if (serial === lastDialog && el.open) return;
      lastDialog = serial;
      var kids = [
        h("h2", { id: "lahe-catalog-confirm-title", text: dialog.title }),
        dialog.status ? h("p", { class: "lib-dialog-status", text: dialog.status }) : null,
        h("p", { class: "lib-dialog-body", text: dialog.body })
      ].filter(Boolean);
      if (dialog.reviews.length) {
        kids.push(h("ul", { class: "lib-dialog-list" }, dialog.reviews.map(function(name) {
          return h("li", { text: name });
        })));
      }
      kids.push(
        h("div", { class: "lib-dialog-acts" }, dialog.buttons.map(function(b) {
          return button(b.label, {
            "data-act": b.id,
            "data-review": dialog.review,
            "data-action": dialog.action,
            "data-key": "dialog:" + b.id,
            "data-primary": b.id === "move" ? "true" : null,
            "data-quiet": b.id === "cancel" ? "true" : null
          });
        }))
      );
      el.replaceChildren.apply(el, kids);
      if (!el.open) el.showModal();
      var first = el.querySelector('[data-act="move"]');
      if (first) first.focus();
    }
    function renderProjects(projects) {
      var current = Array.prototype.map.call(els.project.options, function(o) {
        return o.value + "\0" + o.textContent;
      }).join("");
      var wanted = projects.options.map(function(o) {
        return o.value + "\0" + o.label;
      }).join("");
      if (current !== wanted) {
        els.project.replaceChildren.apply(
          els.project,
          projects.options.map(function(o) {
            return h("option", { value: o.value, text: o.label });
          })
        );
      }
      els.project.value = projects.value;
      els.project.hidden = projects.options.length <= 1;
    }
    var pendingFocus = null;
    function focusKey(key) {
      pendingFocus = key;
    }
    var awayInTab = false;
    function backOnPage() {
      if (!awayInTab) return;
      awayInTab = false;
      if (pendingFocus !== null) render();
    }
    window.addEventListener("focus", backOnPage);
    document.addEventListener("pointerdown", backOnPage, true);
    document.addEventListener("keydown", backOnPage, true);
    function render() {
      var view = VM.build(list, state, now(), {});
      var serial = JSON.stringify(view);
      if (serial === lastRendered && pendingFocus === null) return;
      lastRendered = serial;
      var active = document.activeElement;
      var activeKey = active && active.getAttribute ? active.getAttribute("data-key") : null;
      els.agent.textContent = view.agent.text;
      els.agent.setAttribute("data-attached", view.agent.attached ? "true" : "false");
      els.search.placeholder = view.search.placeholder;
      if (els.search.value !== view.search.value) els.search.value = view.search.value;
      renderProjects(view.projects);
      renderBanner(view.banner);
      renderMain(view);
      renderDialog(view.dialog);
      var key = pendingFocus || activeKey;
      pendingFocus = null;
      if (key && awayInTab) {
        pendingFocus = key;
        key = null;
      }
      if (key && !(view.dialog && els.dialog.open)) {
        var target = els.main.querySelector('[data-key="' + cssEscape(key) + '"]') || els.banner.querySelector('[data-key="' + cssEscape(key) + '"]');
        if (target && target !== document.activeElement) target.focus();
      }
    }
    function cssEscape(value) {
      return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
    }
    els.main.addEventListener("click", onClick);
    els.banner.addEventListener("click", onClick);
    els.dialog.addEventListener("click", onClick);
    els.dialog.addEventListener("close", function() {
      if (state.dialog) update(VM.withDialog(state, null));
    });
    document.addEventListener("keydown", function(event) {
      if (event.key !== "Escape" || !state.menu) return;
      focusKey(state.menu + ":menu");
      update(VM.withMenu(state, null));
    });
    els.main.addEventListener("input", function(event) {
      var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
      if (id) renameDraft = { id, value: event.target.value };
    });
    els.main.addEventListener("keydown", function(event) {
      var id = event.target && event.target.getAttribute && event.target.getAttribute("data-rename");
      if (!id) return;
      if (event.key === "Enter") {
        event.preventDefault();
        renameClosing = true;
        commitRename(event.target);
        renameClosing = false;
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        renameClosing = true;
        cancelRename(id);
        renameClosing = false;
      }
    });
    els.main.addEventListener("focusout", function(event) {
      var input = event.target;
      if (renameClosing || !input || !input.getAttribute || !input.getAttribute("data-rename")) return;
      if (!input.isConnected) return;
      renameClosing = true;
      blurTarget = true;
      commitRename(input);
      blurTarget = false;
      renameClosing = false;
    });
    els.search.addEventListener("input", function() {
      update(VM.withQuery(state, els.search.value));
    });
    els.project.addEventListener("change", function() {
      update(VM.withProject(state, els.project.value));
    });
    render();
    poll();
    timer = setInterval(poll, protocol.CATALOG.POLL_MS);
  })();
})();
