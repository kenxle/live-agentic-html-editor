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

    // ---------------------------------------------------------------------
    // Free writing: run records (docs/features/20260928.01_free_writing,
    // plan Task 1.4)
    // ---------------------------------------------------------------------
    //
    // The agreed shape between the editing workstream (which must produce
    // these by typing) and the replay and helper workstreams (which build
    // against them). Each run fixture carries the literal `after` and the
    // exact change sentence, and every run's words hold the token zqxcanary,
    // so a test can prove the change text never quotes them.

    function anchorRegion(tag, label) {
      return { ref: { id: "ref_anchor_" + tag, probe: null, fingerprint: { tag: tag } }, label: label || "Fixture anchor", lost: null };
    }

    // One free-writing record. The whole-sitting after and after_html, and the
    // change text, are derived the way the recorder derives them, unless the
    // caller pins them.
    function runItem(overrides) {
      var o = overrides || {};
      var fields = Object.assign(
        {
          kind: record.KIND.EDIT,
          before: "What changed",
          before_html: "What changed",
          anchor_after_html: "What changed",
          anchor_tag_after: null,
          placement: record.PLACEMENT.AFTER_ANCHOR,
          new_blocks: [{ tag: "p", html: "A new paragraph zqxcanary" }],
          region: anchorRegion("p")
        },
        o
      );
      var built = record.buildRunAfter(fields.anchor_after_html, fields.new_blocks);
      if (o.after_html === undefined) fields.after_html = built.after_html;
      if (o.after === undefined) fields.after = built.after;
      if (o.change === undefined) fields.change = record.runChangeText(fields);
      if (fields.new_blocks === null) delete fields.new_blocks;
      return base(nextId, fields.kind, fields, page);
    }

    var WORKED_BLOCKS = [
      { tag: "h2", html: "What the chat window cost me zqxcanary" },
      { tag: "p", html: "I lost my place <strong>every</strong> time zqxcanary" },
      { tag: "ul", html: "<li>scrolling</li><li>re-asking zqxcanary</li>" }
    ];

    function worked(overrides) {
      return runItem(Object.assign({ new_blocks: WORKED_BLOCKS }, overrides || {}));
    }

    function runFixtures() {
      var out = [];
      function add(name, item, after, change) {
        out.push({ name: name, item: item, after: after, change: change });
      }

      add(
        "worked example",
        worked(),
        "What changed\n\nWhat the chat window cost me zqxcanary\n\nI lost my place every time zqxcanary\n\nscrolling\n\nre-asking zqxcanary",
        "Added 3 blocks after this paragraph: h2, p, ul. Their words are in new_blocks."
      );

      add(
        "split tail, no typing",
        runItem({
          before: "First half zqxcanary. Second half zqxcanary.",
          before_html: "First half zqxcanary. Second half zqxcanary.",
          anchor_after_html: "First half zqxcanary.",
          new_blocks: [{ tag: "p", html: "Second half zqxcanary.", from_anchor: true }]
        }),
        "First half zqxcanary.\n\nSecond half zqxcanary.",
        "Split this paragraph in two after the anchor's new end. The second part is new_blocks[0], marked from_anchor."
      );

      add(
        "split tail, with typing",
        runItem({
          before: "First half zqxcanary. Second half zqxcanary.",
          before_html: "First half zqxcanary. Second half zqxcanary.",
          anchor_after_html: "First half zqxcanary.",
          new_blocks: [
            { tag: "p", html: "Second half zqxcanary.", from_anchor: true },
            { tag: "p", html: "Typed after the split zqxcanary" }
          ]
        }),
        "First half zqxcanary.\n\nSecond half zqxcanary.\n\nTyped after the split zqxcanary",
        "Split this paragraph in two after the anchor's new end. The second part is new_blocks[0], marked from_anchor. " +
          "Added 1 block after this paragraph: p. Its words are in new_blocks."
      );

      add(
        "tag-only change",
        runItem({
          kind: record.KIND.FORMAT_ONLY,
          before: "Plain words zqxcanary",
          before_html: "Plain words zqxcanary",
          anchor_after_html: "Plain words zqxcanary",
          anchor_tag_after: "h2",
          new_blocks: []
        }),
        "Plain words zqxcanary",
        "Changed this paragraph to h2."
      );

      add(
        "tag change with new words",
        runItem({
          before: "Old words zqxcanary",
          before_html: "Old words zqxcanary",
          anchor_after_html: "New words zqxcanary",
          anchor_tag_after: "h3",
          new_blocks: []
        }),
        "New words zqxcanary",
        "Reworded this paragraph; its new markup is in anchor_after_html. Changed this paragraph to h3."
      );

      add(
        "paragraph turned into a list",
        runItem({
          kind: record.KIND.FORMAT_ONLY,
          before: "Item words zqxcanary",
          before_html: "Item words zqxcanary",
          anchor_after_html: "<li>Item words zqxcanary</li>",
          anchor_tag_after: "ul",
          new_blocks: []
        }),
        "Item words zqxcanary",
        "Changed this paragraph to ul."
      );

      add(
        "item added to an existing list",
        runItem({
          before: "one zqxcanary",
          before_html: "<li>one zqxcanary</li>",
          anchor_after_html: "<li>one zqxcanary</li><li>two zqxcanary</li>",
          new_blocks: [],
          region: anchorRegion("ul")
        }),
        "one zqxcanary\n\ntwo zqxcanary",
        "Reworded this list; its new markup is in anchor_after_html."
      );

      add(
        "start of container",
        runItem({
          before: "",
          before_html: "",
          anchor_after_html: "",
          placement: record.PLACEMENT.START_OF_CONTAINER,
          new_blocks: [{ tag: "h2", html: "Notes zqxcanary" }, { tag: "p", html: "First thought zqxcanary" }],
          region: anchorRegion("main", "Markdown document")
        }),
        "Notes zqxcanary\n\nFirst thought zqxcanary",
        "Added 2 blocks at the start of the page: h2, p. Their words are in new_blocks."
      );

      var first = runItem({ new_blocks: [{ tag: "p", html: "An earlier run zqxcanary" }] });
      var laterBlocks = [{ tag: "p", html: "An earlier run zqxcanary" }, { tag: "p", html: "And a second sitting zqxcanary" }];
      var laterBuilt = record.buildRunAfter(first.anchor_after_html, laterBlocks);
      var later = record.bumpRev(first, { new_blocks: laterBlocks, after_html: laterBuilt.after_html, after: laterBuilt.after });
      later.change = record.runChangeText(later);
      add(
        "with an earlier run in history",
        later,
        "What changed\n\nAn earlier run zqxcanary\n\nAnd a second sitting zqxcanary",
        "Added 2 blocks after this paragraph: p, p. Their words are in new_blocks."
      );

      var handled = worked();
      handled.state = record.STATE.HANDLED;
      var back = record.revertOf(handled, { created_at: FIXED_AT });
      back.id = nextId("takeback");
      add(
        "take-back",
        back,
        "What changed",
        record.REVERT_EDIT + " Remove the blocks in remove_blocks from after this paragraph; the reviewer undid them."
      );

      add(
        "special characters",
        runItem({
          new_blocks: [
            {
              tag: "p",
              html: "Use &lt;b&gt; &amp; *stars* _under_ `code` # not a heading 1. not a list \"straight\" 'quotes' -- dashes zqxcanary"
            }
          ]
        }),
        "What changed\n\nUse &lt;b&gt; &amp; *stars* _under_ `code` # not a heading 1. not a list \"straight\" 'quotes' -- dashes zqxcanary",
        "Added 1 block after this paragraph: p. Its words are in new_blocks."
      );

      return out;
    }

    // One forged record per refusal code. Built by hand, the way a script
    // holding the token would post one.
    function forgedRuns() {
      var many = [];
      for (var i = 0; i <= record.NEW_BLOCKS_MAX; i += 1) many.push({ tag: "p", html: "Block " + i + " zqxcanary" });
      return [
        { name: "a script block", code: "RUN_BLOCK_REFUSED", item: runItem({ new_blocks: [{ tag: "script", html: "alert(1)" }] }) },
        { name: "one block too many", code: "RUN_OVER_CEILING", item: runItem({ new_blocks: many }) },
        { name: "an unknown placement", code: "RUN_PLACEMENT_REFUSED", item: runItem({ placement: "sideways" }) },
        {
          name: "a take-back carrying a run",
          code: "RUN_TAKEBACK_CARRIES_RUN",
          item: runItem({ reverts: "itm_earlier", remove_blocks: [{ tag: "p", html: "Placed zqxcanary" }] })
        }
      ];
    }

    // A run record the page check reopened for a wrong tag.
    function runWithTagNote() {
      return worked({ note: record.PAGE_CHECK_TAG_NOTE });
    }

    // Today's shape of "Enter after a heading": the new paragraph nested in
    // the heading's own after_html, and no new_blocks. Replay keeps today's
    // path for it.
    function oldShapeNested() {
      return edit({
        before: "Intro",
        after: "Intro\n\nA new line",
        before_html: "Intro",
        after_html: "Intro<p>A new line</p>",
        change: 'Added a paragraph after "Intro": "A new line".',
        region: anchorRegion("h2", "Intro")
      });
    }

    // A proofread question on a long run: the agent placed the words as
    // written and lists its suggestions, keyed by new_blocks index.
    function proofreadQuestion() {
      var item = worked();
      item.reply = {
        status: record.REPLY_STATUS.QUESTION,
        agent: "fixture-agent",
        reason: null,
        text: "I placed your words as written. Two fixes you may want.",
        files: ["post.md"],
        at: FIXED_AT,
        proofread: true,
        suggestions: [
          { block: 1, from: "place", to: "spot" },
          { block: 0, from: "cost me", to: "cost us" }
        ]
      };
      return item;
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
      acrossPages: acrossPages,
      runItem: runItem,
      runFixtures: runFixtures,
      forgedRuns: forgedRuns,
      runWithTagNote: runWithTagNote,
      oldShapeNested: oldShapeNested,
      proofreadQuestion: proofreadQuestion
    };
  }

  return {
    DEFAULT_PAGE: DEFAULT_PAGE,
    FIXED_AT: FIXED_AT,
    createFixtures: createFixtures
  };
});
