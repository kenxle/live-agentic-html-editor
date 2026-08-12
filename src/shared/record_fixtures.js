// The record fixture generator.
//
// Owner: 0A-kernel. Imported by: 2B (protection) and 2C (replay), which have to
// be built and tested against realistic edit records without waiting on 2A
// (editing) to produce real ones. CP2-mid is where those tasks meet 2A's real
// records; until then this is what they run against.
//
// It is in the bundle because 2B's and 2C's tests run IN A REAL BROWSER (never
// jsdom), so the fixtures have to exist on the page, not only in Node.
//
// Every fixture is a real record: it goes through record.newItem, it carries
// the page fields, and validateItem passes on it. A fixture generator that
// produced a plausible object literal would let a builder ship against a shape
// the real recorder never emits, which is the whole reason this exists.
//
// The generator is DETERMINISTIC when given a seed, so a failing replay test
// reproduces. Ids are minted from the seed rather than from the CSPRNG for the
// same reason.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.record_fixtures = factory(root.LAHE.record);
  } else {
    module.exports = factory(require("./record.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record) {
  "use strict";

  var DEFAULT_PAGE = {
    origin: "http://localhost:7817",
    path: "/fixture",
    title: "Fixture page",
    seq: 1,
    source_hint: null
  };

  var FIXED_AT = "2026-08-12T00:00:00.000Z";

  // A tiny deterministic id source. Not a CSPRNG and never used for anything
  // real: an id that changes per run makes a replay failure impossible to
  // reproduce, and these records never leave a test.
  function idSource(seed) {
    var n = 0;
    var prefix = String(seed || "fx");
    return function (kind) {
      n += 1;
      return "itm_" + prefix + "_" + kind + "_" + n;
    };
  }

  function pageOf(overrides) {
    return Object.assign({}, DEFAULT_PAGE, overrides || {});
  }

  function base(nextId, kind, fields, page) {
    var p = pageOf(page);
    return record.newItem(
      Object.assign(
        {
          id: nextId(kind),
          kind: kind,
          state: record.STATE.READY,
          created_at: FIXED_AT,
          updated_at: FIXED_AT,
          page_origin: p.origin,
          page_path: p.path,
          page_title: p.title,
          page_seq: p.seq,
          source_hint: p.source_hint,
          region: { ref: { id: "ref_" + kind, probe: null }, label: "Fixture region", lost: null }
        },
        fields || {}
      )
    );
  }

  function createFixtures(options) {
    var opts = options || {};
    var nextId = idSource(opts.seed);
    var page = opts.page || null;

    // A plain edit: one before, one after, one revision. Replay's branches one
    // and two are judged against this.
    function edit(overrides) {
      return base(
        nextId,
        record.KIND.EDIT,
        Object.assign(
          {
            before: "The trainer writes the plan every week.",
            after: "The trainer writes the plan each week.",
            before_html: "<p>The trainer writes the plan every week.</p>",
            after_html: "<p>The trainer writes the plan each week.</p>",
            change: "every -> each"
          },
          overrides || {}
        ),
        page
      );
    }

    // An edit reworded TWICE, so the earlier `after` is neither the current
    // `after` nor the `before`. Replay's branch three is only meaningfully
    // tested against this: a single rewording lets a broken implementation pass
    // by accident, because the prior `after` happens to equal the `before`.
    function editRewordedTwice(overrides) {
      var v1 = edit(
        Object.assign(
          {
            before: "The trainer writes the plan every week.",
            after: "The trainer writes the plan each week."
          },
          overrides || {}
        )
      );
      var v2 = record.bumpRev(v1, { after: "The trainer writes a plan each week." });
      return record.bumpRev(v2, { after: "The trainer writes one plan a week." });
    }

    // A formatting-only change. Text-equal, structure-different: it compares on
    // structure, and a comparator that fell back to text would call it a no-op.
    function formatOnly(overrides) {
      return base(
        nextId,
        record.KIND.FORMAT_ONLY,
        Object.assign(
          {
            before: "This part matters.",
            after: "This part matters.",
            before_html: "<p>This part matters.</p>",
            after_html: "<p>This part <strong>matters</strong>.</p>",
            change: "emphasized 'matters'"
          },
          overrides || {}
        ),
        page
      );
    }

    // A deleted block. Idempotent by absence: the block gone is applied, the
    // block back is re-applied.
    function deletion(overrides) {
      return base(
        nextId,
        record.KIND.DELETE,
        Object.assign(
          {
            before: "This whole paragraph should go.",
            before_html: "<p>This whole paragraph should go.</p>",
            after: null,
            change: "deleted the paragraph"
          },
          overrides || {}
        ),
        page
      );
    }

    function comment(overrides) {
      return base(
        nextId,
        record.KIND.COMMENT,
        Object.assign(
          {
            note: "This says the opposite of the heading above it.",
            context: Object.assign(record.emptyContext(), { quote: "The trainer writes the plan every week." })
          },
          overrides || {}
        ),
        page
      );
    }

    function note(overrides) {
      return base(
        nextId,
        record.KIND.NOTE,
        Object.assign({ note: "The whole flow feels one step too long." }, overrides || {}),
        page
      );
    }

    function draftComment(overrides) {
      return comment(Object.assign({ state: record.STATE.DRAFT, note: "half a th" }, overrides || {}));
    }

    // A record whose anchor can no longer be found. Surfaced as lost, never
    // dropped and never moved (R20).
    function lostAnchor(overrides) {
      return edit(
        Object.assign(
          {
            region: {
              ref: { id: "ref_gone", probe: null },
              label: "Fixture region",
              lost: { code: "ANCHOR_NOT_FOUND", reason: "no candidate matched", at: FIXED_AT }
            }
          },
          overrides || {}
        )
      );
    }

    // One of each, which is what a replay pass is judged against: every branch
    // has a record in the same set, so a pass that handles one kind and drops
    // another shows up as a count.
    function oneOfEach() {
      return [edit(), editRewordedTwice(), formatOnly(), deletion(), comment(), note(), draftComment(), lostAnchor()];
    }

    // n plain edits on distinct regions, for the "every other record is
    // byte-identical and unchanged in state" assertions.
    function manyEdits(n) {
      var out = [];
      for (var i = 0; i < n; i += 1) {
        out.push(
          edit({
            before: "Paragraph " + (i + 1) + " as the page shipped it.",
            after: "Paragraph " + (i + 1) + " as the reviewer wants it.",
            before_html: "<p>Paragraph " + (i + 1) + " as the page shipped it.</p>",
            after_html: "<p>Paragraph " + (i + 1) + " as the reviewer wants it.</p>",
            region: { ref: { id: "ref_p" + (i + 1), probe: null }, label: "Paragraph " + (i + 1), lost: null }
          })
        );
      }
      return out;
    }

    // Records spread across three pages, for the per-page grouping in
    // review.json and for the dev-server walk.
    function acrossPages() {
      var paths = ["/", "/clients", "/plans"];
      var out = [];
      for (var i = 0; i < paths.length; i += 1) {
        out.push(
          base(
            nextId,
            record.KIND.COMMENT,
            {
              note: "Something to fix on " + paths[i],
              context: Object.assign(record.emptyContext(), { quote: "Text on " + paths[i] })
            },
            { path: paths[i], title: "Page " + paths[i], seq: i + 1 }
          )
        );
      }
      return out;
    }

    return {
      FIXED_AT: FIXED_AT,
      page: pageOf(page),
      edit: edit,
      editRewordedTwice: editRewordedTwice,
      formatOnly: formatOnly,
      deletion: deletion,
      comment: comment,
      note: note,
      draftComment: draftComment,
      lostAnchor: lostAnchor,
      oneOfEach: oneOfEach,
      manyEdits: manyEdits,
      acrossPages: acrossPages
    };
  }

  return {
    DEFAULT_PAGE: DEFAULT_PAGE,
    FIXED_AT: FIXED_AT,
    createFixtures: createFixtures
  };
});
