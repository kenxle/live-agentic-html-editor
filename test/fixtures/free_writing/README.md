# Free-writing fixtures

Seeds for the free-writing feature (`docs/features/20260928.01_free_writing/`,
plan Task 1.1). Every Phase 1 and Phase 2 test that needs a page or a markup
corpus for this feature reads it from here.

| File | What it is | Where it came from |
| --- | --- | --- |
| `blog.html` | A styled blog page whose CSS leans on child and sibling selectors (`article > p`, `p + p`, `h2 + p`). New blocks must keep the page's spacing and type on it. | The editing-host spike, `host_spike/fixtures/blog.html`, unchanged. |
| `doc.md` | A short Markdown document with a lede, two sections and a list. | The editing-host spike, `host_spike/fixtures/doc.md`, unchanged. |
| `md_render.html` | `doc.md` rendered by this repo's `src/service/markdown.js`: `sheet-head` and the "Section N" label, the inlined document style. | Re-rendered from `doc.md` with this branch's renderer, the way the spike's `make_md_fixture.js` did. Re-render it the same way if the renderer's markup changes. |
| `empty_notes.md` | An empty Markdown file. | New. |
| `empty_notes.html` | `empty_notes.md` rendered by today's `markdown.js`, with the file-name title marker (`markers.FILE_TITLE_ATTR`) added to the hero `h1` by hand. Task 2.11 makes the renderer add it; its test compares the render against this file, ids aside. | New. |
| `dark.html` | A page with a dark background. Every dark screenshot for this feature is taken on it, because the layer samples its scheme from the page and the Markdown style has no dark mode. | New. |
| `body_paragraph.html` | Paragraphs that are direct children of `body`, with no container. | New. |
| `lists.html` | A list with a two-item nested list, a list whose first bullet holds a lone sub-bullet, and a one-cell table. Delete item tests run on it. | New. |
| `corpus.js` | Two markup corpora: `MALFORMED` (a `p` closed by a `div`, an unclosed `li`, a script body holding `<p>`, template contents, comments) and `ENGINE` (`b`, `i`, nbsp, a trailing `br`, nested `strong` and `em`, entities, uppercase tags). Loads with `require()` and as a page script. | New. |
| `r14_repro_reference.js` | Reference only, run by nothing. The script that reproduced the three brief R14 cases on a real `lahe review post.md`. `test/browser/free_writing_r14.spec.js` is its runnable port. | The R14 reproduction as re-run on main at 2b6eb96 (`r14_main/repro.js`), cleaned: no home path, no fixed waits, output to the OS temp folder. |

What the R14 reproduction recorded on main at 2b6eb96, which the spec asserts:

- Bold in the first new paragraph, left out by the agent: replay writes the paragraph back with its bold. Passes.
- Bold in the second new paragraph, left out by the agent: the edit goes lost and nothing is flagged. Expected failure.
- A line written after a heading, left by click or by Esc: the line nests inside the `h2` and shows twice after the rebuild. Expected failure.
- Bold two words, the agent changes nothing and replies handled: the item retires and the bold is gone. Expected failure.
