# Cloud proof, attempt 2

Result: PASSED. The comment journey ran end to end on a fresh cloud Linux runner.

## Environment

- uname -a: Linux vm 6.18.44-fc-v139 #1 SMP PREEMPT_DYNAMIC @0 x86_64 x86_64 x86_64 GNU/Linux
- Node: v22.22.0 (meets the 20 or later floor)
- Commit: b05c2252c548534e220b7f2fdd7f2aae22330d57 on docs/verification-skill
- Layer version: 0.4.0+5a08787aefbe
- Name resolution: `getent hosts foo.lahe.localhost` returned nothing (exit 2), so the system resolver does not resolve *.lahe.localhost. Chromium resolves *.localhost itself, so the seed journey still opened http://lahe-verify.cloud-proof.work.lahe.localhost:46379/sample.md and the rail booted. The journey, not getent, is the real test, and it passed.

## Setup

- `npm ci`: succeeded.
- `npx playwright install --with-deps chromium`: succeeded, exit 0. Chrome for Testing 151.0.7922.34 and the headless shell both downloaded from cdn.playwright.dev. The earlier block on that host is gone.
- Helper count (`ps -axo command | grep -c "[l]ahe.js serve"`) before the run: 0.

## Commands, all with --run cloud-proof

1. `up --evidence <this folder>`: pass. Printed open, source, session s_c6aad03df19517bf and review r9bcec61e9605.
2. `doctor`: pass. All 12 checks ok, including helper health, bundle matches src, Chromium on this run's profile, layer booted, rail shows no failures.
3. `page select "text=The shed roof leaks" --text "roof leaks"`: pass. Printed "selected": "roof leaks".
4. `page key ControlOrMeta+Shift+KeyC`, `page type "Which side is north?"`, `page key ControlOrMeta+Enter`: pass. Rail saved as 001-before-reply.rail.json.
5. `agent wait "Which side is north"` and `agent drain`: pass. The drain line has kind comment, quote "roof leaks", state ready, note "Which side is north?".
6. `agent reply itm_306be0f54aa36ac56ab3d823 1 question --text "Is north the road side?"`: pass. Returned status question.
7. `page wait "(window.__lahe.items()[0].reply||{}).status === 'question'"`: pass. `page shot reply` (002-reply.png) shows the card with a QUESTION chip, "verify is asking" and the agent's words.
8. Click the Follow up box, type "Yes, the road side.", Cmd-Enter: pass. `agent wait "Yes, the road side"` showed the same item at rev 2 with a thread holding the first exchange. `page shot followup` saved as 003-followup.png.
9. `doctor` again before teardown: pass, all ok.
10. `down`: pass. Printed `session close: exit 0`, `helpers stopped: 643`, `keeper 650 and its browser stopped`, `left running: nothing`, and kept the evidence.

Not run: the recipe's page-note and delete steps, which the task did not list.

## Failures

None in the journey. The only failed command was the extra `getent` name check described above.

## Cleanup

`down` reported nothing left running. A `ps` check afterwards showed no lahe or chrom processes other than the shell running the check itself. Helper count after the run was 0, matching the 0 before.

## Notes on the harness for Linux

- cloud.md says to verify name resolution through the seed journey. That advice is right: `getent` fails on this runner while the browser works. A reader who checks with getent or curl would wrongly conclude names do not resolve.
- No instruction in the skill needed changing for Linux.
- The logs folder holds the raw output of each step. commands.jsonl is the harness's own log.
