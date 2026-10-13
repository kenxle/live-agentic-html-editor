# Bringing LAHE's docs up to your standard set

**Short version:** LAHE has none of your four standard docs. It has no product brief, no architecture doc, no style guide and no brand doc. (The style doc you were thinking of, `STYLES.md`, is about the document styles a reviewer installs. It says nothing about how LAHE itself looks.) Seven of the 13 files in `docs/ongoing/` are feature records: plans, option pages and build notes. They belong in `docs/features/`. My plan is to move those seven out, write the four missing docs, and give every remaining ongoing doc a charter, the way Steady Thread does.

## Questions for you

Four calls change what I write. My recommendation comes first in each.

1. **Should the new `ARCHITECTURE.md` become the binding home of the design decisions?** Today CLAUDE.md says the decisions D1 to D12 are binding. They live in the original 2026-08-12 architecture doc, which is also marked as history that is never rewritten. Several decisions have since been amended (D9's stamp, for one). **Recommendation:** yes. `ARCHITECTURE.md` states each decision as it stands today, under the same D-numbers so code comments still match. The original doc stays as history. CLAUDE.md then points at the new file.

2. **What should the style guide cover?** **Recommendation:** how LAHE's own screens look: the rail, cards, state chips, buttons, the conflict toast and the Library page. Today those rules exist only as CSS inside `src/layer/overlay.js`. The document style (the St. Clair AI style in `vendor/stclair-doc-style/`) already has its own docs, so the guide points at those and does not repeat them.

3. **Is it "LAHE" or "Lahe"?** The README says "Lahe" 14 times and "LAHE" never. The skill says "LAHE" 18 times and "Lahe" twice. The brand doc has to pick one. **Recommendation:** "Lahe" for the product name in prose, `lahe` for the command. All capitals reads as an acronym nobody says out loud.

4. **Should the paid Lahe Styles be in the brand doc?** **Recommendation:** a short section on how we talk about them, with no file names, prices or style names. This repo is public, and the styles are sold.

## The four new docs

Your carousel names the full doc stack: product brief, architecture, style guide, brand voice, diagrams and feature dossiers. Lahe already has the last two. These are the other four. Each one opens with a charter: what belongs here, what does not, and how much detail.

| File | What it holds | Written from |
| --- | --- | --- |
| `PRODUCT_BRIEF.md` | Follows the outline of your LinkedIn product brief carousel: charter, what Lahe is, who it is for, the problem, jobs to be done, what it does, what it is not, principles, commitments, and how we know it works. The commitments include zero runtime dependencies, your exact words reaching the source, never guessing where a comment goes, and working with no helper running. | your carousel, the original brief, the README, the feature list |
| `ARCHITECTURE.md` | The shape of the system: helper, review layer, store, Library, agent loop. One short section per area, each linking to its diagram or ongoing doc. The design decisions as they stand today (see question 1). | the original architecture doc, `docs/diagrams/`, `src/shared/manifest.js` |
| `STYLE_GUIDE.md` | The rail's colors, type, spacing, cards, chips, buttons and toast, light and dark. The Library page. A link to the document style for documents. | the CSS in `src/layer/overlay.js` and the Library page, with screenshots |
| `BRAND.md` | How we talk about Lahe: the one-line position, words we use and avoid, how the README sounds, how labels and card text in the rail sound, and how an agent's reply on a card should sound. | the README, the rail's text, the reply rules in the skill, your communication style doc |

The brand doc is the one with the least to draw on, so expect a first draft for you to react to, not a finished doc.

## Moving the feature records out of `docs/ongoing/`

| File now in `docs/ongoing/` | What it actually is | Where it goes |
| --- | --- | --- |
| `DOC_STYLE_BUILD.md` | the spec and progress record for the default document style | a new folder, `docs/features/20260916.06_default_doc_style/` |
| `FINGERPRINTING_BUILD.md` | the task plan for finishing fingerprinting | a new folder, `docs/features/20260911.01_fingerprinting_build/` |
| `OUTBOX_COALESCING.md` | the design note for a memory fix | `docs/features/20260916.05_memory_audit/`, which asked for it |
| `DIAGRAMS_PLAN.md` | the plan you reviewed for which diagrams to draw | a new folder, `docs/features/20260904.01_diagrams/` |
| `DOCUMENT_INDEX_IDEAS.md` | the options page that became the Library | `docs/features/20260922.02_lahe_library/` |
| `STABLE_ADDRESSES.md` | the options page that started stable addresses | `docs/features/20261011.02_stable_addresses/` |
| `STATIC_SITE_FOLDER.md` | the spec and progress record for the rail following a folder | a new folder, `docs/features/20260916.07_static_site_folder/` |

Before each move I check that what the file says about how things work today is already in a living doc. For example, the folder rule is in [SERVING_ARCHITECTURES.md](../../ongoing/SERVING_ARCHITECTURES.md), and the outbox rule needs a short section in a living doc before its note leaves.

Two leftovers outside `docs/ongoing/` go too. `docs/AGENTS.next.coverage.md` and `docs/AGENTS.next.questions.md` are from the playbook rewrite. The file they describe is gone. They move to a new folder, `docs/features/20260916.08_agents_playbook_rewrite/`.

A few things point at the moved files: three code comments, two tests, the diagrams README and the bulletin board. I update every one. The code comments also ship inside the built bundle, so that part goes through a worktree, the unit gate and a bundle rebuild.

## What stays in `docs/ongoing/`

These six describe how a part of Lahe works today. Each one gets a charter at the top and nothing else changes:

- [FINGERPRINTING.md](../../ongoing/FINGERPRINTING.md)
- [FREE_WRITING.md](../../ongoing/FREE_WRITING.md)
- [LIBRARY.md](../../ongoing/LIBRARY.md)
- [SERVING_ARCHITECTURES.md](../../ongoing/SERVING_ARCHITECTURES.md)
- [SESSION_OWNERSHIP.md](../../ongoing/SESSION_OWNERSHIP.md)
- [STYLES.md](../../ongoing/STYLES.md)

## Where the bulletin board and the diagrams live

In Steady Thread both sit inside `docs/ongoing/`. In Lahe they sit one level up: `docs/BULLETIN.md` and `docs/diagrams/`. About 20 files point at the board and about 60 at the diagrams, including the skill and the contract text every agent reads. **Recommendation:** leave them where they are, and list them in the CLAUDE.md doc table so an agent finds them. Moving them means a lot of churn for little gain. Tell me if you want them moved anyway.

## CLAUDE.md and the docs README

- CLAUDE.md gets a doc table like Steady Thread's: each ongoing doc and when to read it. `forge-cleanup` reads that table when it checks which docs a feature touched. Without it, that step has nothing to read.
- [docs/README.md](../../README.md) says the living truth is three files. It gets updated to name `docs/ongoing/` and the four new docs.

## Order of work

1. Move the seven feature records and the two leftovers, and fix every reference. This one is mechanical.
2. Add charters to the six living docs, and the doc table to CLAUDE.md.
3. Write `PRODUCT_BRIEF.md` and `ARCHITECTURE.md`. These need your answer to question 1.
4. Write `STYLE_GUIDE.md`. This needs your answer to question 2.
5. Write `BRAND.md`. This needs your answers to questions 3 and 4.

Steps 1 and 2 need nothing from you. I'll start on them once you've read this, unless you comment otherwise.
