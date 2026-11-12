<!-- read-when: A test in test/unit/build_layer.test.js fails, or you are changing what these fixture modules do. -->

# Fixtures for the layer build

`test/unit/build_layer.test.js` bundles these files with `scripts/build-layer.js` and runs the result against a stand-in `window`.

- `first.js` and `last.js` are old-style wrappers: each registers itself on `window.LAHE` in the browser, and exports in Node.
- `middle.ts` is a converted ES module. The build registers it on `window.LAHE` between the two.
- `node_only.js` is reached only from `last.js`'s Node branch, so it must never end up in a bundle.
