// The app fixture's content: a small coaching app's real-looking text.
//
// Plan task 0C. Every paragraph here is a target for a later anchor test (1C
// mints anchors from a region's normalized text plus surrounding context), so
// the writing has to behave like writing: repeated names, near-duplicate
// sentences, and short lines next to long ones. Lorem ipsum would make the
// anchor corpus lie, because filler text has none of the accidental repetition
// that makes uniqueness hard on a real page.

"use strict";

const CLIENTS = [
  {
    slug: "marisa-huang",
    name: "Marisa Huang",
    program: "Strength, week 9 of 12",
    status: "on track",
    summary:
      "Marisa pulled 185 for a clean set of six on Tuesday, which is the number she has been chasing since February. Her knee held up through the whole session and she walked the long way home afterward."
  },
  {
    slug: "devon-abara",
    name: "Devon Abara",
    program: "Return to running, week 3",
    status: "drifting",
    summary:
      "Devon has missed two of the last three easy runs. He answers texts the same day, so this is a scheduling problem rather than a motivation one, and the fix is probably moving his Thursday session to the morning."
  },
  {
    slug: "priya-raman",
    name: "Priya Raman",
    program: "Postpartum rebuild, week 6",
    status: "on track",
    summary:
      "Priya added a second core session and said the first one no longer leaves her sore the next day. She asked whether she can start carrying the toddler on her hip again, which is worth a real answer rather than a shrug."
  },
  {
    slug: "tom-kessler",
    name: "Tom Kessler",
    program: "General fitness, ongoing",
    status: "quiet",
    summary:
      "Tom has not logged a session in eleven days and has not replied to the last two check-ins. He does this every spring when work gets loud, and he always comes back, but the check-in still has to go out."
  }
];

// Rotating feed lines. The morph engine writes a new one on every pass, so the
// content genuinely changes and a test can tell a morph that ran from one that
// did not. Each entry is a whole sentence a coach might actually read.
const FEED_LINES = {
  latest: [
    "Marisa Huang logged 4 sets of 6 at 185 lb and rated the last set an 8 out of 10.",
    "Priya Raman finished her second core session of the week and asked about carrying weight on one hip.",
    "Devon Abara moved Thursday's easy run to Friday morning and said the earlier slot suits him better.",
    "Tom Kessler opened the check-in text but has not replied yet."
  ],
  coachNote: [
    "Reply to Priya before Friday. Her question about carrying the toddler deserves a real answer.",
    "Devon's schedule, not his motivation, is the problem. Offer the 6am slot.",
    "Marisa is ahead of the program. Decide whether week 10 gets a deload or a heavier top set.",
    "Tom goes quiet every spring. Send the short version of the check-in, not the long one."
  ],
  highlight: [
    "Three clients hit a personal best this week, which is the most since the January cohort started.",
    "Session attendance is at 78 percent for the month, up from 71 percent in March.",
    "Two clients are on a program that ends in under three weeks and neither has a renewal conversation booked.",
    "Average reply time to a client text is under four hours, which is the fastest it has been."
  ],
  queue: [
    "Four check-ins go out tonight at 7pm. Two are drafted and two are still empty.",
    "Next week's programs are written for six of nine clients.",
    "One invoice is nine days overdue and one payment failed and has not been retried.",
    "Two clients asked for a call this week and neither has a time on the calendar."
  ]
};

const REPORTS = [
  {
    title: "Attendance by program",
    body:
      "Strength clients showed up for 84 percent of booked sessions this month. Return-to-running clients showed up for 61 percent, and every miss in that group was an easy run rather than a session with the coach in the room."
  },
  {
    title: "Where the week went",
    body:
      "Eleven hours were spent in sessions and just over six hours went to writing programs, answering texts, and rescheduling. The rescheduling alone was ninety minutes, most of it for two clients."
  },
  {
    title: "Renewals coming up",
    body:
      "Three programs end inside the next month. Two of those clients have hit every milestone they were given, which is the easiest renewal conversation there is, and the third has not trained in eleven days."
  }
];

module.exports = { CLIENTS, FEED_LINES, REPORTS };
