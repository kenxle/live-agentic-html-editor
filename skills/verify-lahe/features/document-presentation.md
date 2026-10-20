# Document style and PDF

A Markdown review renders in the house document style. From the rail, the
reviewer can preview another installed style, ask the agent to switch the page
to it, and ask the agent for a PDF. The style and PDF requests reach the agent
as notes.

## Sub-features

- `style-preview`: picking a style changes how the page looks without changing the file.
- `style-ask`: "Ask the agent to use <style>" sends a note naming the style.
- `pdf-ask`: "Save as PDF" sends "Make a PDF of this page." to the agent.
- `markdown-render`: headings, lists, fonts and Mermaid diagrams render (not yet driven with lahe-verify).
- `doc-links`: relative links between documents open inside the review (not yet driven).

## How to get to it (user POV)

- Click the "Document style" icon at the top of the rail, then a style's row. "Back to the document's style" undoes the preview.
- In the same panel, click "Ask the agent to use <style>".
- Click "Ask the agent for a PDF", then "Save as PDF".

## Driving it with lahe-verify

Preconditions:

- A fresh run on the sample document.
- A made-up style installed into this run's own state: `lv cli -- style add test/fixtures/styles/sample`, then `lv page reload`.

- **Open the panel.** Run `lv page click "rail-text:Document style"`. `lv page eval "JSON.stringify(window.__lahe.stylePanel().rows.map(r=>r.id))"` lists `international` and `sample`.
- **Preview.** Run `lv page click "rail:[data-style-id=sample]"`. `lv page eval "JSON.stringify(window.__lahe.style())"` shows `"previewing":true,"shown":"sample"`. `lv page shot style-preview` shows the new look.
- **Ask to keep it.** Run `lv page click "rail-text:Ask the agent to use Sample"`. `lv agent wait "lahe-style: sample"` shows a note "Use the Sample style for this page (lahe-style: sample)."
- **Ask for a PDF.** Run `lv page click "rail-text:Ask the agent for a PDF"`, then `lv page click "rail-text:Save as PDF"`. `lv agent wait "Make a PDF"` shows a note.
- **Proof.** The preview screenshot and both drain lines.

## Gotchas

- Use only the made-up styles in `test/fixtures/styles/`. Paid styles never enter this repo.
- `style add` through `lv cli` installs into the run's state folder, not the real one. Without the reload, the panel lists only the built-in style.
- The PDF note is a request to the agent. Making the PDF is the agent's job and needs a real exporter; this recipe does not prove PDF output.
- Regression specs: `style_switcher.spec.js`, `pdf_button.spec.js`, `markdown_render.spec.js`, `linked_docs_rail.spec.js`.
