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

### Your app in dev

```sh
lahe review path/to/project --origin http://localhost:3000
```

This row writes and serves nothing. It prints one script line with a reminder
comment, and the comment is NOT a guard. Wrap the script in the framework's real
development-only conditional, paste it where the layout's scripts go, and reload
the page. The server is yours to start and stop. The line's `onerror` names a
fallback path, `/lahe-layer.js`; publish the built library there if you want the
page to load with the helper down.

For a single generated page, use
`lahe review page.html --source generator` and rerun that generator after
each source change. Verify the change in the built page before replying
`handled`. A stack with hot reload needs no extra rebuild.
