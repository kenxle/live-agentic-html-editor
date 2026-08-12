// The fixture corpus the uniqueness predicate is judged against.
//
// Owner: Task 0a. Task 1C imports this file and runs its real DOM engine
// against the same six cases, so the predicate and the engine are judged by one
// standard rather than two.
//
// The six cases come straight from plan Task 0a:
//
//   text and path unchanged        bind
//   rewrapped and reformatted      bind
//   a sibling inserted above       bind
//   region text fully rewritten    no bind
//   region deleted                 no bind
//   the same paragraph duplicated  no bind, ambiguous
//
// A document is an ordered array of block texts. That is enough to express
// every case, and it keeps the corpus runnable with no browser.

"use strict";

var ORIGINAL = [
  "Steady Thread sends check-ins your clients actually answer.",
  "The trainer writes the plan. Acey writes the messages.",
  "Every message goes out under the trainer's name.",
  "Pricing starts at thirty five dollars a month."
];

// The record was minted against block index 1 of ORIGINAL.
var REFERENCE = {
  probe: "The trainer writes the plan. Acey writes the messages.",
  prefix: "Steady Thread sends check-ins your clients actually answer.",
  suffix: "Every message goes out under the trainer's name.",
  path: 1
};

var CASES = [
  {
    name: "text_and_path_unchanged",
    expect: { bound: true, reason: "unique" },
    why: "the ordinary case. Nothing moved, so exactly one candidate matches the probe",
    blocks: ORIGINAL.slice()
  },
  {
    name: "rewrapped_and_reformatted",
    expect: { bound: true, reason: "unique" },
    why:
      "R16. A build rewrapped the paragraph and doubled the indentation. The one normalizer collapses " +
      "whitespace, so the probe still matches exactly",
    blocks: [
      "Steady Thread sends check-ins your clients\n   actually answer.",
      "  The trainer writes the plan.\n\tAcey writes\n   the messages.  ",
      "Every message goes out\nunder the trainer's name.",
      "Pricing starts at thirty five dollars a month."
    ]
  },
  {
    name: "sibling_inserted_above",
    expect: { bound: true, reason: "unique" },
    why:
      "the structural path is now wrong (the region moved from index 1 to index 2) and the stored prefix no " +
      "longer matches. Neither matters: the text is still unique, so it binds. This is the case a path-first " +
      "ladder gets wrong",
    blocks: [
      "A new opening line an agent added.",
      "Steady Thread sends check-ins your clients actually answer.",
      "The trainer writes the plan. Acey writes the messages.",
      "Every message goes out under the trainer's name.",
      "Pricing starts at thirty five dollars a month."
    ]
  },
  {
    name: "region_text_fully_rewritten",
    expect: { bound: false, reason: "no_text_match" },
    why: "an agent rewrote the sentence. Nothing matches the probe, so nothing is written and the card says so",
    blocks: [
      "Steady Thread sends check-ins your clients actually answer.",
      "Coaches set the direction and the assistant drafts each note.",
      "Every message goes out under the trainer's name.",
      "Pricing starts at thirty five dollars a month."
    ]
  },
  {
    name: "region_deleted",
    expect: { bound: false, reason: "no_text_match" },
    why: "the paragraph is gone. Same verdict as a rewrite, and the reviewer's text is kept either way",
    blocks: [
      "Steady Thread sends check-ins your clients actually answer.",
      "Every message goes out under the trainer's name.",
      "Pricing starts at thirty five dollars a month."
    ]
  },
  {
    name: "same_paragraph_duplicated",
    expect: { bound: false, reason: "ambiguous" },
    why:
      "the dangerous case. Two exact matches with symmetric context. Any scalar score rates both high and " +
      "picks one; the predicate fails closed. D3 Law 1 exists for exactly this",
    blocks: [
      "Steady Thread sends check-ins your clients actually answer.",
      "The trainer writes the plan. Acey writes the messages.",
      "Every message goes out under the trainer's name.",
      "Steady Thread sends check-ins your clients actually answer.",
      "The trainer writes the plan. Acey writes the messages.",
      "Every message goes out under the trainer's name."
    ]
  },
  {
    name: "duplicated_but_context_distinguishes",
    expect: { bound: true, reason: "context_eliminated_rivals" },
    why:
      "the same text twice, but only one copy has the stored neighbors. Context eliminates the rival " +
      "outright, which is a different thing from scoring it lower",
    blocks: [
      "An unrelated opening.",
      "The trainer writes the plan. Acey writes the messages.",
      "A different closing.",
      "Steady Thread sends check-ins your clients actually answer.",
      "The trainer writes the plan. Acey writes the messages.",
      "Every message goes out under the trainer's name."
    ]
  }
];

module.exports = { ORIGINAL: ORIGINAL, REFERENCE: REFERENCE, CASES: CASES };
