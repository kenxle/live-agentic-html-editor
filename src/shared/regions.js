// Region label rules.
//
// Owner: Task 0a (shared kernel). Imported by: the anchor engine (1C), the edit
// recorder (2A-i), the rail (1B-i), the review file writer (1D).
//
// The law, stated first because it is the one that gets broken:
//
//   RECORD IDENTITY IS THE REGION REFERENCE. IT IS NEVER THE DISPLAY LABEL.
//
// Two paragraphs in different containers under one heading produce the same
// label ("Introduction, paragraph 2" for both, if you compute the label from
// the heading). If identity were the label, the second edit would overwrite the
// first and one of them would vanish. That collision is a named shipped bug in
// the tool being replaced and R29 exists because of it. Labels may collide.
// References may not.
//
// Second law: a label is pinned at first touch and never recomputed. The page
// repaints, a heading changes, a sibling is inserted, and a recomputed label
// renames a row in the rail underneath the reviewer. The label is a name the
// reviewer learned; it does not move.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.regions = factory(root.LAHE.markers, root.LAHE.normalize);
  } else {
    module.exports = factory(require("./markers.js"), require("./normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, normalize) {
  "use strict";

  // The attribute a page author may put on their own markup to name a region.
  // Spelled in markers.js so cleanMarkup knows not to strip it.
  var AUTHOR_ATTR = markers.AUTHOR_REGION_ATTR;

  var LABEL_MAX = 80;

  // The fallback chain, in order. Each source is tried until one produces a
  // non-empty label. Every source is a pure function of a DESCRIPTOR, not of a
  // DOM node, so the rules are unit-testable with no browser: the layer builds
  // the descriptor from the node, this module turns it into a label.
  //
  // descriptor = {
  //   authorName:  the value of data-review-region, or null
  //   id:          the element's id, or null
  //   ariaLabel:   the element's aria-label, or null
  //   name:        a name the element carries in its own content, such as the
  //                filename in an image's src or an svg's <title>, or null
  //   heading:     text of the nearest preceding heading, or null
  //   ordinal:     1-based position among same-tag elements IN THAT HEADING'S
  //                SECTION, in document order
  //   tag:         lowercase tag name
  //   text:        the region's own text, used only for the last resort
  // }
  //
  // On the ordinal: it is counted through the section, not among immediate
  // siblings, because a row of images is ordinarily written with each image in
  // its own wrapper. Counted among siblings, all three are "img 1", and three
  // cards in the rail read identically. That is a real bug a reviewer hit.
  var LABEL_SOURCES = [
    {
      name: "author_attribute",
      why: "the page author named this region with " + AUTHOR_ATTR,
      get: function (d) {
        return d.authorName;
      }
    },
    {
      name: "id",
      why: "the element has an id, which is stable and already meaningful to the author",
      get: function (d) {
        return d.id;
      }
    },
    {
      name: "aria_label",
      why: "an accessible name is a human-written name for the same thing",
      get: function (d) {
        return d.ariaLabel;
      }
    },
    {
      name: "element_name",
      why: "a name the element carries itself, such as an image's filename, which is what a person says out loud and which does not collide the way a position does",
      get: function (d) {
        if (!d.name) return null;
        return d.tag ? d.tag + " " + d.name : d.name;
      }
    },
    {
      name: "heading_ordinal",
      why: "the nearest preceding heading plus a position, which is how a person would describe it",
      get: function (d) {
        if (!d.heading) return null;
        var tail = d.tag ? d.tag : "block";
        return d.heading + ", " + tail + " " + (d.ordinal || 1);
      }
    },
    {
      name: "tag_ordinal",
      why: "last resort: a tag and a document-order position, available for any element",
      get: function (d) {
        if (!d.tag) return null;
        return d.tag + " " + (d.ordinal || 1);
      }
    },
    {
      name: "text_snippet",
      why: "only when there is no tag at all, which should not happen",
      get: function (d) {
        if (!d.text) return null;
        var t = normalize.normalizeText(d.text);
        return t ? t.slice(0, 40) : null;
      }
    }
  ];

  function trimLabel(value) {
    var s = normalize.normalizeText(String(value));
    if (s.length <= LABEL_MAX) return s;
    return s.slice(0, LABEL_MAX - 1) + "…";
  }

  // Returns {label, source} or throws. Throwing is right: a region with no
  // label at all means the descriptor was built wrong, and a blank row in the
  // rail is worse than a loud failure during the build.
  function labelFor(descriptor) {
    if (!descriptor || typeof descriptor !== "object") {
      throw new TypeError("labelFor expects a region descriptor object");
    }
    for (var i = 0; i < LABEL_SOURCES.length; i += 1) {
      var raw = LABEL_SOURCES[i].get(descriptor);
      if (typeof raw === "string" && raw.trim()) {
        return { label: trimLabel(raw), source: LABEL_SOURCES[i].name };
      }
    }
    throw new Error("labelFor: no label source produced a label for " + JSON.stringify(descriptor));
  }

  // Pin the label onto a region object once. Calling it again is a no-op, which
  // is the whole point: whoever calls it on every repaint gets the first label
  // back, not a recomputed one.
  function pinLabel(region, descriptor) {
    if (!region || typeof region !== "object") throw new TypeError("pinLabel expects a region object");
    if (typeof region.label === "string" && region.label) return region;
    var got = labelFor(descriptor);
    region.label = got.label;
    region.label_source = got.source;
    return region;
  }

  // Identity comparison. Two regions are the same region when their references
  // are the same, and for no other reason. Labels are explicitly not consulted.
  //
  // The reference's shape is owned by Task 1C. This function compares it
  // structurally so it keeps working as 1C fills the shape in, and refuses a
  // null reference rather than treating two unresolved regions as equal, which
  // is how two records would merge into one row.
  function sameRegion(refA, refB) {
    if (!refA || !refB) return false;
    if (refA === refB) return true;
    if (typeof refA.id === "string" && typeof refB.id === "string") return refA.id === refB.id;
    return JSON.stringify(refA) === JSON.stringify(refB);
  }

  // The lost-anchor state that travels in the payload (R17). Stored on
  // region.lost; null means the subject is still findable.
  function lostState(code, reason) {
    return { code: code, reason: reason || null, at: new Date().toISOString() };
  }

  // A reference the anchor engine refused to mint, as that same lost state.
  //
  // Here rather than in each caller because both the comment surface and the
  // edit recorder have to stamp it, and a caller that forgets is the bug this
  // exists to close: the reference had already failed, `lost` stayed null, and
  // review.json told the agent the item was healthy. The failure code is the
  // engine's own, so the reviewer's card and the agent's file say the same
  // thing. A reference with no `ok` at all is treated as failed, because a
  // caller who cannot say the mint worked has not shown that it did.
  function lostFromMint(ref) {
    if (ref && ref.ok === true) return null;
    var failure = (ref && ref.failure) || {};
    return lostState(failure.failureCode || "ANCHOR_NO_TEXT_MATCH", failure.reason || null);
  }

  return {
    AUTHOR_ATTR: AUTHOR_ATTR,
    LABEL_MAX: LABEL_MAX,
    LABEL_SOURCES: LABEL_SOURCES,
    labelFor: labelFor,
    pinLabel: pinLabel,
    sameRegion: sameRegion,
    lostState: lostState,
    lostFromMint: lostFromMint,
    // Stated as a value so a test can assert it and a reader cannot miss it.
    IDENTITY_IS_THE_REFERENCE_NOT_THE_LABEL: true,
    LABELS_MAY_COLLIDE: true
  };
});
