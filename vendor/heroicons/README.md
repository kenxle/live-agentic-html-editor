# vendor/heroicons

One icon from [Heroicons](https://github.com/tailwindlabs/heroicons) 2.2.0, MIT
licensed (see `LICENSE`). `arrow-right-start-on-rectangle.svg` is the file from
`src/24/outline/`, copied byte for byte.

It lives here because this tool has zero runtime dependencies: a `git clone` has to
run with no install step, so an icon set cannot be an npm dependency. Only the one
icon the rail uses is vendored, rather than the whole set, because the rest would be
dead weight in a repository that ships a built bundle.

The rail draws it from the path data in `src/layer/overlay.js` rather than loading
this file at runtime. This copy is the provenance: it is what the path was taken
from, so the next person can diff it against a newer Heroicons release instead of
guessing whether the drawing was hand-made.

To take a newer version, copy the new file over this one, update the version above,
and copy its `d` attribute into `EXIT_ICON_PATH` in `src/layer/overlay.js`.
