// The item record and the event envelope: the single place every field name in
// this tool is spelled.
//
// Owner: Task 0a (shared kernel). Imported by: the store (1B-ii), the sync
// client (1B-ii), the service (1A), the projection (1A), the review file
// writer (1D), the edit recorder (2A-i), replay (2B), the rail (1B-i), and the
// CLI (1D).
//
// Architecture D4 names the fields. This module is that table as code. If a
// builder needs a field name, they import FIELD; they never type the string.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.record = factory(root.LAHE.normalize);
  } else {
    module.exports = factory(require("./normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Field names
  // ---------------------------------------------------------------------------

  var FIELD = {
    ID: "id",
    REV: "rev",
    KIND: "kind",
    GROUP: "group",
    TARGET: "target",
    STATE: "state",
    FEEDBACK: "feedback",
    BEFORE: "before",
    AFTER: "after",
    BEFORE_HTML: "before_html",
    AFTER_HTML: "after_html",
    MOVED_BEFORE: "moved_before",
    MOVED_AFTER: "moved_after",
    REGION: "region",
    CONTEXT: "context",
    REPLY: "reply",
    DELIVERED: "delivered",
    ACK: "ack",
    VERIFICATION: "verification",
    CREATED_AT: "created_at",
    UPDATED_AT: "updated_at",
    DIAGNOSTICS: "diagnostics"
  };

  // ---------------------------------------------------------------------------
  // Kinds and states
  // ---------------------------------------------------------------------------

  // Architecture D4's kind list, verbatim.
  var KIND = {
    COMMENTED: "commented",
    EDITED: "edited",
    DELETED: "deleted",
    MOVED: "moved",
    FORMATTED: "formatted",
    RESIZED: "resized",
    NOTE: "note"
  };
  var KINDS = Object.keys(KIND).map(function (k) {
    return KIND[k];
  });

  // The lifecycle states. Note "discarded" where the architecture's state
  // diagram says "reviewer deletes it": the word "deleted" is already a kind
  // (the reviewer deleted a block, which is feedback), and one word meaning two
  // things in the same record is how a builder writes the wrong comparison.
  var STATE = {
    OUTSTANDING: "outstanding",
    DELIVERED: "delivered",
    APPLIED: "applied",
    DECLINED: "declined",
    DISCARDED: "discarded"
  };
  var STATES = Object.keys(STATE).map(function (k) {
    return STATE[k];
  });

  // ---------------------------------------------------------------------------
  // D10: every field is classified
  // ---------------------------------------------------------------------------
  //
  // "instruction" means the reviewer wrote it and an agent should act on it.
  // "data" means it came out of the reviewed document; it is a search key and
  // never a directive. The review file writer fences every data field and the
  // JSON carries this map so an agent reading the file can see the rule rather
  // than being told it in prose.
  var CLASS_INSTRUCTION = "instruction";
  var CLASS_DATA = "data";

  var FIELD_CLASS = {
    feedback: CLASS_INSTRUCTION,
    after: CLASS_INSTRUCTION,
    after_html: CLASS_INSTRUCTION,
    moved_after: CLASS_INSTRUCTION,
    before: CLASS_DATA,
    before_html: CLASS_DATA,
    moved_before: CLASS_DATA,
    "context.quote": CLASS_DATA,
    "context.prefix": CLASS_DATA,
    "context.suffix": CLASS_DATA,
    "context.heading": CLASS_DATA,
    "context.element": CLASS_DATA,
    "region.label": CLASS_DATA,
    "target.title": CLASS_DATA,
    "target.canonical": CLASS_DATA
  };

  function fieldClass(path) {
    return Object.prototype.hasOwnProperty.call(FIELD_CLASS, path) ? FIELD_CLASS[path] : CLASS_DATA;
  }

  // ---------------------------------------------------------------------------
  // Ids
  // ---------------------------------------------------------------------------
  //
  // Client-minted, so a re-send after a failed sync cannot double-count (D6).
  // A CSPRNG is required in both environments; Node 20 and Chromium both have
  // globalThis.crypto. Missing entropy is an error, not a Math.random fallback:
  // two items sharing an id is silent, permanent feedback loss.
  function csprngBytes(n) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (g && g.crypto && typeof g.crypto.getRandomValues === "function") {
      var b = new Uint8Array(n);
      g.crypto.getRandomValues(b);
      return b;
    }
    // Node without the webcrypto global. Node's own crypto module is built in,
    // so reaching for it is not a dependency. Guarded on there being no window
    // so a browser page that happens to define require never takes this path.
    if (typeof require === "function" && typeof window === "undefined") {
      return new Uint8Array(require("node:crypto").randomBytes(n));
    }
    throw new Error("randomId: no CSPRNG available (globalThis.crypto.getRandomValues)");
  }

  function randomId(prefix) {
    var bytes = csprngBytes(12);
    var hex = "";
    for (var i = 0; i < bytes.length; i += 1) {
      hex += (bytes[i] + 0x100).toString(16).slice(1);
    }
    return (prefix ? prefix + "_" : "") + hex;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // The record
  // ---------------------------------------------------------------------------

  function emptyRegion() {
    return {
      // The anchor engine's reference (Task 1C mints it). Opaque here on
      // purpose: this module owns the field name, 1C owns the contents.
      ref: null,
      // Display only. Pinned at first touch, never recomputed. See regions.js.
      label: null,
      // null, or {code, reason, at} when the subject can no longer be found.
      lost: null
    };
  }

  function emptyContext() {
    return { quote: null, prefix: null, suffix: null, heading: null, element: null };
  }

  // Creates a record with every field present. Every field present always is
  // deliberate: a projection that merges snapshots never has to distinguish
  // "absent" from "null", and an agent reading review.json sees a stable shape.
  function newItem(input) {
    var src = input || {};
    if (KINDS.indexOf(src.kind) === -1) {
      throw new Error("newItem: kind must be one of " + KINDS.join(", ") + ", got " + String(src.kind));
    }
    if (typeof src.target !== "string" || !src.target) {
      throw new Error("newItem: target (a canonical target string) is required");
    }
    var at = src.created_at || nowIso();
    var item = {};
    item[FIELD.ID] = src.id || randomId("itm");
    item[FIELD.REV] = typeof src.rev === "number" ? src.rev : 1;
    item[FIELD.KIND] = src.kind;
    item[FIELD.GROUP] = src.group || null;
    item[FIELD.TARGET] = src.target;
    item[FIELD.STATE] = src.state || STATE.OUTSTANDING;
    item[FIELD.FEEDBACK] = typeof src.feedback === "string" ? src.feedback : null;
    item[FIELD.BEFORE] = typeof src.before === "string" ? src.before : null;
    item[FIELD.AFTER] = typeof src.after === "string" ? src.after : null;
    item[FIELD.BEFORE_HTML] = typeof src.before_html === "string" ? src.before_html : null;
    item[FIELD.AFTER_HTML] = typeof src.after_html === "string" ? src.after_html : null;
    item[FIELD.MOVED_BEFORE] = src.moved_before || null;
    item[FIELD.MOVED_AFTER] = src.moved_after || null;
    item[FIELD.REGION] = src.region || emptyRegion();
    item[FIELD.CONTEXT] = src.context || emptyContext();
    item[FIELD.REPLY] = src.reply || null;
    item[FIELD.DELIVERED] = src.delivered || null;
    item[FIELD.ACK] = src.ack || null;
    item[FIELD.VERIFICATION] = src.verification || null;
    item[FIELD.CREATED_AT] = at;
    item[FIELD.UPDATED_AT] = src.updated_at || at;
    item[FIELD.DIAGNOSTICS] = src.diagnostics || {};
    return item;
  }

  // Every change to an item bumps rev. Deliveries and acks name (item, rev) and
  // lifecycle wins only for the revision it names (D4), so a rev that does not
  // move is how an ack silently swallows a rewording.
  function bumpRev(item, changes) {
    var next = Object.assign({}, item, changes || {});
    next[FIELD.REV] = item[FIELD.REV] + 1;
    next[FIELD.UPDATED_AT] = nowIso();
    return next;
  }

  // Fail loud, and report every problem at once rather than the first.
  function validateItem(item) {
    var problems = [];
    if (!item || typeof item !== "object") {
      throw new TypeError("validateItem expects an object, got " + typeof item);
    }
    if (typeof item[FIELD.ID] !== "string" || !item[FIELD.ID]) problems.push("id must be a non-empty string");
    if (typeof item[FIELD.REV] !== "number" || item[FIELD.REV] < 1) problems.push("rev must be a number >= 1");
    if (KINDS.indexOf(item[FIELD.KIND]) === -1) problems.push("kind must be one of " + KINDS.join(", "));
    if (STATES.indexOf(item[FIELD.STATE]) === -1) problems.push("state must be one of " + STATES.join(", "));
    if (typeof item[FIELD.TARGET] !== "string" || !item[FIELD.TARGET]) problems.push("target must be a non-empty string");
    if (item[FIELD.KIND] === KIND.NOTE && !item[FIELD.FEEDBACK]) {
      problems.push("a note item must carry feedback text");
    }
    if (item[FIELD.KIND] === KIND.EDITED && typeof item[FIELD.AFTER] !== "string") {
      problems.push("an edited item must carry after text");
    }
    if (problems.length) {
      throw new Error("invalid item " + String(item[FIELD.ID]) + ": " + problems.join("; "));
    }
    return item;
  }

  // An item is outstanding for send purposes when it is outstanding or was
  // declined and reopened. Nothing here reads agent presence; see
  // lifecycle.isSendEnabled.
  function isOutstanding(item) {
    return item[FIELD.STATE] === STATE.OUTSTANDING;
  }

  // The reviewer's own words, used by replay's three-way comparison and by
  // verification. Normalized through the one normalizer, never ad hoc.
  function normalizedBefore(item) {
    return typeof item[FIELD.BEFORE] === "string" ? normalize.normalizeText(item[FIELD.BEFORE]) : null;
  }

  function normalizedAfter(item) {
    return typeof item[FIELD.AFTER] === "string" ? normalize.normalizeText(item[FIELD.AFTER]) : null;
  }

  // ---------------------------------------------------------------------------
  // The event envelope
  // ---------------------------------------------------------------------------
  //
  // D6: events carry a client-minted id and are idempotent by that id, and an
  // item event is a full snapshot of that item, never a delta, so replaying
  // events in any order converges.

  var EVENT = {
    ITEM_UPSERT: "item.upsert",
    ITEM_DISCARD: "item.discard",
    REVIEW_SEND: "review.send",
    REVIEW_END: "review.end",
    ACK_APPLIED: "ack.applied",
    ACK_DECLINED: "ack.declined",
    VERIFY_RESULT: "verify.result",
    SESSION_MINT: "session.mint",
    TARGET_SEEN: "target.seen"
  };
  var EVENT_TYPES = Object.keys(EVENT).map(function (k) {
    return EVENT[k];
  });

  var ACTOR = { REVIEWER: "reviewer", AGENT: "agent", SERVICE: "service" };

  function newEvent(type, payload, meta) {
    var m = meta || {};
    if (EVENT_TYPES.indexOf(type) === -1) {
      throw new Error("newEvent: unknown type " + String(type));
    }
    if (!m.actor || [ACTOR.REVIEWER, ACTOR.AGENT, ACTOR.SERVICE].indexOf(m.actor) === -1) {
      throw new Error("newEvent: actor must be reviewer, agent, or service");
    }
    return {
      event_id: m.event_id || randomId("evt"),
      // Assigned by the service when the line is appended. Null client-side.
      seq: typeof m.seq === "number" ? m.seq : null,
      type: type,
      at: m.at || nowIso(),
      review: m.review || null,
      target: m.target || null,
      actor: m.actor,
      payload: payload || {}
    };
  }

  function itemUpsertEvent(item, meta) {
    validateItem(item);
    return newEvent(EVENT.ITEM_UPSERT, { item: item }, Object.assign({ target: item[FIELD.TARGET] }, meta));
  }

  return {
    FIELD: FIELD,
    KIND: KIND,
    KINDS: KINDS,
    STATE: STATE,
    STATES: STATES,
    CLASS_INSTRUCTION: CLASS_INSTRUCTION,
    CLASS_DATA: CLASS_DATA,
    FIELD_CLASS: FIELD_CLASS,
    fieldClass: fieldClass,
    EVENT: EVENT,
    EVENT_TYPES: EVENT_TYPES,
    ACTOR: ACTOR,
    randomId: randomId,
    nowIso: nowIso,
    emptyRegion: emptyRegion,
    emptyContext: emptyContext,
    newItem: newItem,
    bumpRev: bumpRev,
    validateItem: validateItem,
    isOutstanding: isOutstanding,
    normalizedBefore: normalizedBefore,
    normalizedAfter: normalizedAfter,
    newEvent: newEvent,
    itemUpsertEvent: itemUpsertEvent
  };
});
