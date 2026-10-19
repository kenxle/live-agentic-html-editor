# Read, style and export documents

## Sub-features

Render Markdown and diagrams, follow document links, preview a style, ask to keep it, and export.

## How to get to it (user POV)

Open a Markdown or house-style HTML review. Use the Document style control in the rail for preview and Ask; use the PDF control for export. Follow relative document links in the page.

## Driving it with Playwright

Precondition: the setup and isolation checks in [verify-lahe](../SKILL.md) pass.

Read the rendered headings, lists, fonts and Mermaid diagram.

```sh
npm exec -- playwright test test/browser/markdown_render.spec.js --workers 1 --trace on --output /tmp/lahe-proof-document-presentation-markdown_render
```

Open Document style, preview a fixture style, return with Back or ask the agent to keep it. Confirm reading position and text survive.

```sh
npm exec -- playwright test test/browser/style_switcher.spec.js --workers 1 --trace on --output /tmp/lahe-proof-document-presentation-style_switcher
```

Follow document links and confirm the review rail and document ownership.

```sh
npm exec -- playwright test test/browser/linked_docs_rail.spec.js --workers 1 --trace on --output /tmp/lahe-proof-document-presentation-linked_docs_rail
```

Use the PDF button and verify its declared exporter boundary.

```sh
npm exec -- playwright test test/browser/pdf_button.spec.js --workers 1 --trace on --output /tmp/lahe-proof-document-presentation-pdf_button
```

Observable proof: The rendered document keeps the expected structure. Preview changes appearance without losing edits. Asking to keep a style creates a real pending request. Export invokes the expected path.

## Gotchas

Use made-up styles from test/fixtures/styles, never private paid assets. PDF tests may use a stub; they do not certify real PDF fidelity. A Markdown-only pass does not cover style, links or export.

Source anchors:

- [src/service/markdown.js](../../../src/service/markdown.js)
- [src/layer/style_switch.js](../../../src/layer/style_switch.js)
- [test/browser/style_switcher.spec.js](../../../test/browser/style_switcher.spec.js)
- [test/browser/pdf_button.spec.js](../../../test/browser/pdf_button.spec.js)
