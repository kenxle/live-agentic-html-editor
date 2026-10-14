# Seneschal standard

The master list of what a project's docs should contain. The scaffold copies this file into a project as `docs/STANDARD.md`. The audit reads the project's copy first and the master only when a project has none.

Every table is read by a script. Keep the header rows and the column order.

## Standard as of 2026-10-13

`required` and `closed` are `yes` or `no`. A closed folder reports every file it does not list as unlisted. `accepts` lists alternate paths, separated by commas, that count as the item being present somewhere else. `charter` names the stub charter file under `references/charters/`.

| path | kind | required | closed | accepts | charter |
|---|---|---|---|---|---|
| CLAUDE.md | doc | yes | no | | charters/CLAUDE.md |
| AGENTS.md | doc | yes | no | | charters/AGENTS.md |
| .claude/guardrails.md | doc | yes | no | | charters/GUARDRAILS.md |
| docs/ | folder | yes | yes | | |
| docs/README.md | doc | yes | no | | charters/README.md |
| docs/STANDARD.md | doc | yes | no | | charters/STANDARD.md |
| docs/SENESCHAL.md | doc | no | no | | charters/SENESCHAL.md |
| docs/BULLETIN.md | doc | yes | no | docs/ongoing/BULLETIN.md | charters/BULLETIN.md |
| docs/ongoing/ | folder | yes | yes | docs/ongoing-docs/ | |
| docs/ongoing/PRODUCT_BRIEF.md | doc | yes | no | docs/ongoing/PRD.md | charters/PRODUCT_BRIEF.md |
| docs/ongoing/ARCHITECTURE.md | doc | yes | no | | charters/ARCHITECTURE.md |
| docs/ongoing/STYLE_GUIDE.md | doc | yes | no | | charters/STYLE_GUIDE.md |
| docs/ongoing/BRAND.md | doc | yes | no | | charters/BRAND.md |
| docs/ongoing/TESTING.md | doc | yes | no | | charters/TESTING.md |
| docs/ongoing/ROADMAP.md | doc | no | no | | charters/ROADMAP.md |
| docs/ongoing/diagrams/ | folder | yes | no | docs/diagrams/ | |
| docs/ongoing/diagrams/INDEX.md | doc | yes | no | | charters/DIAGRAMS_INDEX.md |
| docs/features/ | folder | yes | no | | |
| docs/reports/ | folder | yes | no | | |
| docs/lessons/ | folder | yes | no | | |
| docs/marketing/ | folder | no | no | | |
| docs/feedback/ | folder | no | no | | |
| docs/user_research/ | folder | no | no | | |

## Not used here

A project lists a standard path here, with a reason, when the standard does not fit it. The audit says nothing about a path listed here. The master has no rows. A row looks like this:

<!-- | docs/ongoing/BRAND.md | A course repo has no brand to describe. | -->

| path | reason |
|---|---|

## Declined

A project lists a change from the master's Changes log here when it turned that change down. The audit does not offer a declined change again. Copy the change text exactly.

| change | reason |
|---|---|

## Settings

| key | value | meaning |
|---|---|---|
| stale_row_days | 14 | A bulletin row open longer than this many days is reported as old. |
| code_root | src/ | The folder code lives in. Doc freshness is measured against it. Blank means no code and no freshness ranking. |
| boards | docs/BULLETIN.md | The board file, or the registry file that lists several boards. |
| evidence | local | `local` keeps run folders out of git. `commit` commits them. |
| jev | true | `true` uses Jev to label items when a key exists. `false` never calls it. |

## Changes

The master's change log, newest last. Copies carry it too, but only the master's log is compared against a copy's stamp.

| date | change |
|---|---|
| 2026-10-13 | First version. |
