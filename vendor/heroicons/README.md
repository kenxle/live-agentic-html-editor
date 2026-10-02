# vendor/heroicons

Two icons from [Heroicons](https://github.com/tailwindlabs/heroicons) 2.2.0, MIT
licensed (see `LICENSE`). Each is the file from `src/24/outline/`, copied byte for
byte:

- `arrow-right-start-on-rectangle.svg`: the End review door in the rail's footer.
- `swatch.svg`: the Document style button in the rail's head.

They live here because this tool has zero runtime dependencies: a `git clone` has to
run with no install step, so an icon set cannot be an npm dependency. Only the icons
the rail uses are vendored, rather than the whole set, because the rest would be
dead weight in a repository that ships a built bundle.

The rail draws each from the path data in `src/layer/overlay.js` rather than loading
these files at runtime. These copies are the provenance: they are what the paths were
taken from, so the next person can diff them against a newer Heroicons release
instead of guessing whether a drawing was hand-made.

To take a newer version, copy the new files over these, update the version above,
and copy each `d` attribute into `src/layer/overlay.js`: the door's into
`EXIT_ICON_PATH`, the swatch's into `STYLE_ICON_PATH`.
