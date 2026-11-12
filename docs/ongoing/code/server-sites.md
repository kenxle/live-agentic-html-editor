---
read-when: Changing a file in src/server/sites/, or working out why one of them does what it does.
not-for: How the TypeScript projects and the lint gate are set up; see README.md in this folder.
---

# `src/server/sites/`: serving the pages a site publishes

This folder holds the server code that serves a site's pages and keeps the lahe script line in them. Today it holds one file, `script-line.ts`. The rest of the folder arrives with the server slices of the [TypeScript migration](../../features/20261112.01_typescript_migration/parts/target_layout.md): `heal`, `name-server`, `addresses`, `static-servers`, `sites`, `page-routes` and `rebuild`.

Source files carry no comments except their `read-when` header. The why, the traps and the history live here.

## `script-line.ts`: the script line in an HTML file

The script line is the `<script>` tag that loads the review layer into a static page. Two programs write it: `lahe add` (`src/cli/commands/add.js`), and the server when it heals a page that a rebuild stripped the line out of (`src/service/heal.js`). They must write the same line in the same place, so the placement logic lives in this one module and both call it. It used to live inside `add.js`, where nothing else could reach it. The tag's own text is `protocol.scriptTag`'s, and is not restated here.

Only Node runs it. It is not in the browser bundle, because only the server and the CLI edit files.

The old path, `src/shared/script_line.js`, is a one-line forwarder until the migration's finishing slice, so callers that are still JavaScript reach this module unchanged.

### Finding the line

`EXISTING_TAG` finds a tag by the `data-lahe-review` attribute, which only Lahe writes. The pattern uses a negated class (`[^>]*`) for the attribute list, which spans the newlines in the pinned multi-line form. That only works while no attribute value holds a `>`: `test/unit/protocol_wire.test.js` pins that the fallback `onerror` attribute has none.

`catalog_reader.js` builds a global copy of the pattern from its `source` to scan every tag in a file. Everyone else calls `exec` on it, which finds the first tag.

### Where a new line goes

In order:

1. Just before the **last** `</body>`. Last, not first, because a page that quotes `</body>` in its prose or in a nested template still ends at the real one.
2. Failing that, just before the last `</html>`. A fragment with no body still has a document end.
3. Failing both, at the end of the file, on its own line. A fragment that something else includes is a real thing to review, and the line still runs there.

A closer inside an HTML comment, a `<script>` element or a `<style>` element is text, not the page's end. Counting one would put the tag inside a comment (the rail never loads) or inside a script string (the inserted `</script>` cuts the page's own script short). A comment or element that is never closed runs to the end of the file.

When the closer starts its line, the tag goes on its own line just above it, at its indentation. When other markup comes first on that line, as on a minified page written as one long line, the tag goes directly before the closer on the same line. The start of that line can be inside a `<style>` block, where the browser would read the tag as CSS and the rail would never load. That happened on the Herald wireframes (board row `LAHE-inject-minified-line`). Putting the tag on the same line also means removing it takes back exactly what was added.

The tag carries `defer`, so where it sits is about being easy for a person reading the file to see, not about when it runs.

`where` in the result is one of four phrases, and people read them: `lahe add` prints "The script line is in page.html, just before &lt;/body&gt;.", and the heal writes the phrase into the server log.

### Replacing and removing

Replace keeps the old tag's position and gives the new tag's later lines the indentation of the line the old one started on.

Remove matches with the same pattern, so the only tag it can take out is one Lahe wrote. The line's indentation and the newline that ends it go too, so no blank line is left behind. A tag that shares its line with other markup takes only itself.

### Known edges, unchanged

- A tag inside an HTML comment is still found by `EXISTING_TAG`, so `lahe add --remove` would take out a commented-out line.
- Placing a line at the end of a file that does not end in a newline adds one. Removing the line later leaves that newline, so that one case is not a byte-for-byte round trip.
