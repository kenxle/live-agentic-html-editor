# Review apps and generated documents

Keep the app or document's own styles and icon. Edit the source rather than
generated HTML. Use [review](review.md) for setup, the URL, contract and
monitor, and [feedback](feedback.md) for incoming items.

### A document built from several sources

Run the project's real, repeatable build, then review its output:

```sh
npm run build-docs
lahe review path/to/build/report.html --source path/to/build-entrypoint
```

`--source` is a navigation hint. Point it at the entrypoint: the top-level
Markdown file, manifest, build script, or template that reveals the input set.
Use the item's page text to find the right fragment, edit it, run the canonical
build, verify, then reply.

#### When there's no build script

Some documents will be generated on the fly, like a prompt that is composed of many underlying files that you want to read at once. You should probably create a throwaway (or reusable) script to build this. The point is to never report an update as "complete" when the user cannot see it (you updated the source but the users view didn't change).

### Your app in dev

```sh
lahe review path/to/project --origin http://localhost:3000
```

The app's own dev server serves the page. Start and stop it according to the
project's workflow; `lahe review` does neither. It connects the review rail to
that origin and prints one script line with a reminder comment. The comment is
NOT a guard. Wrap the script in the framework's real development-only
conditional, paste it where the layout's scripts go, and reload the page. The
line's `onerror` names a fallback path, `/lahe-layer.js`; publish the built
library there if you want the page to load with the helper down.

For a single generated page, use
`lahe review page.html --source generator` and rerun that generator after
each source change. Verify the change in the built page before replying
`handled`. A stack with hot reload needs no extra rebuild.
