# Review a slide deck

Keep the deck's framework, theme and build process. A deck with its own styles
keeps them. When creating a deck in the Lahe house style, read
[documents](documents.md) and use the catalog components within the deck's
layout. The document skeleton is for document pages, not slide containers.

Review source HTML directly with `lahe review deck.html`. If HTML is generated,
use `--source <build-entrypoint>`, edit the source and rerun the real build;
follow [webapps and builds](webapps.md). Follow [review](review.md) for the
URL, contract and monitor, and [feedback](feedback.md) for incoming items.

### A page inside an iframe

A framed page gets no rail. Add `data-lahe-frames="allow"` to the script tag if the
page really is meant to be reviewed while embedded.

Keep framing refused by default: a reveal.js speaker-notes window embeds the
same deck, and the framed copy can compete with the presentation for review.
Before exporting a deck, follow [finish](finish.md) to remove any pasted rail.
