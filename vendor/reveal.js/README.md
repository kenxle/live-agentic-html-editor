# vendor/reveal.js

Vendored copy of [reveal.js](https://github.com/hakimel/reveal.js) 5.2.1, MIT
licensed (see `LICENSE`). The files are copied byte for byte from the published
npm package `reveal.js@5.2.1`. The banner inside `dist/reveal.js` reads 5.2.0:
upstream cut 5.2.1 without rebuilding the banner, and the file is what 5.2.1
ships.

This is TEST TOOLING ONLY. It is never shipped and never loaded by anything in
`src/`. Nothing here belongs in `dependencies` in `package.json`.

## Why it is here

Four separate bugs came out of reviewing a real reveal deck with this tool:

- page hotkeys firing from an anchored comment box,
- page hotkeys firing from the rail's own fields,
- the speaker-notes window booting a second copy of the library,
- the change highlight painting the slide number and a countdown.

Each was first fixed against a stand-in fixture that imitated reveal's
behavior. `test/fixtures/reveal-deck.html` and `test/browser/reveal_deck.spec.js`
run the same claims against the real library, so a future reveal release that
changes how the deck listens for keys shows up here instead of in a live
presentation.

## What was taken, and what was left

Only the pieces the fixture loads:

- `dist/reveal.js`: the UMD build, which defines the `Reveal` global.
- `dist/reveal.css` and `dist/reset.css`: the core stylesheets.
- `dist/theme/serif.css`: one theme. Chosen because it is one of two stock
  themes with no `@import` of a webfont, so the fixture needs no font files and
  the test server serves no 404s.
- `plugin/notes/notes.js` and `plugin/notes/speaker-view.html`: the speaker-notes
  plugin, which is the thing that opens a second window embedding the deck.

Left out: the ES module builds, the source maps, the other themes, the webfonts
(1.8 MB), and every other plugin.

## Updating

Fetch the npm tarball with curl, never `npm install` (a lockfile change is a
runtime dependency waiting to happen):

```
curl -sL -o /tmp/reveal.tgz https://registry.npmjs.org/reveal.js/-/reveal.js-<version>.tgz
tar xzf /tmp/reveal.tgz -C /tmp/revealx
```

Copy the seven files above over these, copy the new `LICENSE`, and change the
version named at the top of this file.
