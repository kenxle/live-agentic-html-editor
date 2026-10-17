---
title: A link mount makes one site claim another site's files
category: service
symptoms: [the built page does not show its text so it stays open, handled check keeps refusing a paragraph that is on the page, agent says it is on the page but the check cannot see it, new_blocks held as not on the page, every other edit comes back cannot tell, renderForFile returns null, handled check reads the raw markdown, works in a test but not on the real machine]
applies_to: ["src/service/page_routes.js", "src/service/handled_check.js", "src/service/rebuild.js", "src/service/sites.js"]
first_seen: 2026-10-17
confirmed: 2026-10-17
status: live
---

## What happens

An agent places the reviewer's new paragraph in a Markdown file and replies
`handled`. The helper log says:

```
item <id> was answered handled, but the built page does not show its text, so it stays open
```

The paragraph is in the file and on the reviewer's page. The agent retries, and
every retry is refused the same way. Ordinary edits on the same document pass,
which hides that the check is not working for them either: they come back
"cannot tell", not "shown".

Run `verdictFor` by hand against the rendered page and it says true. Run it
against the raw `.md` file and it says false. The check was reading the raw file.

## Why

A site reaches a file in two ways: its own root holds the file, or it has a mount
into the file's folder, made when another document linked there. The lookup that
names a file's site (`siteForFile` in `src/service/page_routes.js`) used to take
the first site in the registry that reached the file either way. A docs site that
linked into an assignments folder is often listed before the assignments site.
`renderForFile` then sees the file is not under that site's root and returns null,
and `pageShows` in `src/service/handled_check.js` falls back to reading the file
from disk. For Markdown that is the source, not a page. `normalize.leafBlocks`
finds no blocks in it, so a run record fails, and plain text compares come back
null.

A fresh test registry rarely has two sites that reach one file, which is why it
only shows up on a real machine with months of sites.

## What to do instead

Pick the site that owns the file before any site that only mounts it: a page-only
site whose root is the file, else the folder site with the deepest root. Count a
mount only when no site owns the file. `siteForFile` does this now.

To check a suspect case, replay the item against a copy of the registry, never
the live state folder (opening the registry can write `sites.json`):

```js
const sites = sitesModule.createSites({ dir: copyDir, home: process.env.HOME });
sites.load();
pageRoutes.activate(copyDir, { sites, pagesPort: 1483 });
const files = handledCheck.pageFilesFor(meta, item, copyDir);
const html = files.map((f) => pageRoutes.renderForFile(copyDir, f));
// null here means the check is reading the raw file
handledCheck.verdictFor(html.filter(Boolean), item, false);
```

When writing a test for site lookups, bind a site that mounts the target folder
first, and assert the list order, or the test passes on the first-match bug.
