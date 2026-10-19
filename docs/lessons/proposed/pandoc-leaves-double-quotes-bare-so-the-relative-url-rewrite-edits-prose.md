---
title: Pandoc leaves double quotes unescaped in text, so the relative-URL rewrite edits href= written as prose
category: service
symptoms: ["href=\"./x\" in my document shows a different path on the page", "inline code shows /.lahe-source/ inside the code", "rewriteRelativeUrls changed text I wrote", "src= in a sentence got a prefix", "pandoc and marked render the same quote differently", "&quot; missing in pandoc output", "link prefix appears inside a code span"]
applies_to: [src/service/markdown.js, src/service/lahe_render.lua, src/service/pandoc.js, test/unit/pandoc_render.test.js]
first_seen: 2026-10-19
confirmed: 2026-10-19
status: live
---

## What happens

A Markdown document that shows an attribute as words, for example a code span holding `<link href="./style.css">`, or a sentence containing `src="./a.png"`, comes out of the pandoc path with the visible text changed. Pandoc's HTML is this:

```
<p>Use <code>&lt;link href="./style.css"&gt;</code> and src="./a.png" in words.</p>
```

After `rewriteRelativeUrls` in `src/service/markdown.js` runs on it, the page shows:

```
<code>&lt;link href="/.lahe-source/abc/./style.css"&gt;</code> and src="/.lahe-source/abc/./a.png"
```

The same source through `marked` is not touched, because marked writes `&quot;` for each quote.

## Why

`rewriteRelativeUrls` finds links with the pattern `\b(href|src)="([^"]*)"` over the whole rendered body. It cannot tell a real attribute from text that looks like one. It was safe under marked only because marked escapes every `"` in text and code to `&quot;`, so the pattern never matched prose. Pandoc writes a bare `"` in text and in inline code, so the same pattern now matches.

## What to do instead

Make the pandoc path escape quotes the way marked does, so `rewriteRelativeUrls` can keep treating every bare `href="` and `src="` as a real attribute. `src/service/lahe_render.lua` does this with two filters: `Str` and `Code` elements containing a `"` become raw HTML run through its `escape` function, which writes `&quot;`. Code blocks and the mermaid block use the same `escape`. The filter's `Image` handler tells the walk not to descend into an image, so alt text is left to pandoc's attribute writer, which already writes `&quot;`.

Any new pandoc filter that emits raw HTML for user text must call `escape` on that text. Do not loosen `rewriteRelativeUrls` to compensate. It would then miss real links.

`test/unit/pandoc_render.test.js` ("a quote in text or inline code stays escaped, so href= in prose is never rewritten") covers it. That test skips when pandoc is not installed, so it runs in a local `npm run gate` and not in CI.
