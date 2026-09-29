// A stand-in helper that refuses every run event, for the card's refusal state
// (free writing, plan Task 3.2: "A refused item is never shown as sent").
//
// Why a stand-in and not the real helper. The real helper refuses only a run
// the layer would never send (a forged block, a record over the ceiling), and
// the layer refuses that input before it is ever posted. So the refusal cannot
// be typed. What this checks is the layer's half: a refusal from the helper
// reaches the card, through sync's onItemRefused, with the helper's own codes.
//
// It replaces window.fetch before the page's scripts run, and answers only the
// helper's origin. Every run event is refused with RUN_BLOCK_REFUSED, every
// other event is accepted. Nothing is stored anywhere.

"use strict";

const protocol = require("../../../src/shared/protocol.js");

function install(page, helperOrigin) {
  return page.addInitScript(
    ({ origin, base }) => {
      const real = window.fetch.bind(window);
      const json = (body) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      window.__laheRefused = [];
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input.url;
        if (url.indexOf(origin) !== 0) return real(input, init);
        const path = url.slice(origin.length).split("?")[0];
        if (path === base + "/events") {
          const body = JSON.parse((init && init.body) || "{}");
          const accepted = [];
          const rejected = [];
          (body.events || []).forEach((ev) => {
            const rec = ev.record || (ev.payload && ev.payload.record) || null;
            if (rec && Array.isArray(rec.new_blocks) && rec.new_blocks.length) {
              rejected.push({ event_id: ev.event_id, code: "RUN_BLOCK_REFUSED", reason: "block 0 is not clean" });
              window.__laheRefused.push(ev.event_id);
            } else accepted.push(ev.event_id);
          });
          return Promise.resolve(json({ accepted: accepted, rejected: rejected, seq: 1 }));
        }
        if (path === base + "/window") {
          return Promise.resolve(
            json({
              granted: true,
              since: new Date().toISOString(),
              heartbeat_seconds: 30,
              quiet_heartbeat_seconds: 120,
              took_over: false,
              session_secret: "stand-in"
            })
          );
        }
        if (path === base + "/replies") {
          return Promise.resolve(json({ events: [], seq: 1, target_mtime: null, stamp_carriable: null, agent_liveness: null }));
        }
        if (path === base + "/review") {
          return Promise.resolve(
            json({ origins: [], recorded_source: null, recorded_paths: [], only_recorded_pages: false, seq: 1 })
          );
        }
        return Promise.resolve(json({ ok: true }));
      };
    },
    { origin: helperOrigin, base: protocol.route("events.append").path.replace(/\/events$/, "") }
  );
}

module.exports = { install };
