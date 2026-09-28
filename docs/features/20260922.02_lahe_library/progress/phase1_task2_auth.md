# Phase 1, Task 1.2: Catalog auth and page serving

**Summary.** The Library token and its per-route checks are live. `catalog.page` and `catalog.asset` serve for real. `catalog.list`, `open`, `star` and `request` pass their checks and then answer 501 until Task 2.1. `health` reports `catalog_seen_at`. The D11 amendment is in `docs/CONTRACTS.md`. `npm run gate:unit`: 1332 tests, 1330 pass, 0 fail, 2 todo. Both todos existed before this task and are in other areas.

Branch `task/lib-auth`, off `feat/lahe_library` at `000c40b`.

## What was built

- **The Library token.** The helper mints it in memory at each start (`auth.createCatalogState`). It lives only in the served page's `<meta name="lahe-catalog-token">` tag.
- **The catalog check block.** `auth.checkCatalogRequest`, a pure function driven by each route's `checks` object from Phase 0. The existing `auth.check` sends catalog routes to it, so the helper still has one check call site.
- **Page and assets.** A placeholder page template with the token meta tag and the script and style tags. The asset route serves a fixed allowlist by exact name.
- **No CORS, strict headers.** Every catalog response carries the security policies and no `Access-Control-*` header. That covers refusals and 404s too.
- **Preflight.** An `OPTIONS` request on any catalog path is refused, whatever the origin.
- **`health.catalog_seen_at`.** It reads `catalog.seenAt()`. Task 2.1 calls `helper.catalog.markSeen(now)` (also `deps.catalog.markSeen`) on an authenticated list.

## File by file

- `src/service/auth.js`
  - `createCatalogState()`: token, port and last-seen time.
  - `checkCatalogRequest(request, catalog)`. The check order is Host, `Sec-Fetch-Site`, client header, content type, token, Origin.
  - `check()` sends catalog routes to the catalog check block and logs refusals through the same named-refusal path.
  - The token is compared with `crypto.timingSafeEqual`. No token enters a log line.
- `src/service/routes.js`
  - A `CATALOG_HANDLERS` map. Page and asset are real; the four API routes throw `NOT_IMPLEMENTED` (501), naming Library 2.1.
  - A load-time check that every catalog route has a handler.
  - `matchCatalogRoute(method, rawPath)` and `isCatalogPath(rawPath)`.
  - `health` gains `catalog_seen_at`.
- `src/service/index.js`
  - Creates the catalog state and fills in its port once the listener is bound. Until then every catalog request fails the Host check.
  - Catalog routes are matched on the raw `req.url` before URL normalization, then go through `handleCatalog`.
  - `respondCatalog` and `respondCatalogJson` add the policies and never CORS.
  - The preflight refuses catalog paths.
  - The helper handle exposes `catalog`.
- `src/service/catalog_page.js` (new)
  - `ASSETS`: the allowlist.
  - `readAsset(name)`: exact own-key lookup, with no decoding or path joining.
  - `securityHeaders()`, `CONTENT_SECURITY_POLICY`, `assetUrl()`.
  - `renderPage(token)`: a placeholder body. Task 2.2 replaces the body and adds the `view_model.js` script tag.
- `src/layer/catalog/page.js` (new, placeholder). Reads `LAHE.protocol` and the meta tag and writes one status line. Task 2.2 replaces it whole.
- `src/shared/manifest.js`: `planned` is off for `catalog_page.js` and `page.js`, and on nowhere else.
- `docs/CONTRACTS.md`
  - An `origin.removed` row in the event table.
  - The `health` response shape with `catalog_seen_at`.
  - A new section, "The Library routes and the Library token (D11 amendment)". It holds the route table, the per-route check table, the check order and codes, the serving headers, the preflight rule, the token meta tag, the asset allowlist, the new error codes and a stated residual risk.
- `test/unit/catalog_auth.test.js` (new, 13 tests). Covers every Auth and serving line in the plan's Test List, plus a refused list leaving `catalog_seen_at` alone. Each test runs a real helper on port 0 with a temporary state dir and sends raw `node:http` requests, so the tests set Host, Origin and `Sec-Fetch-Site` directly.

## Deviations

- **Asset names.** The allowlist names are:
  - `protocol.js`, `page.js`, `view_model.js`
  - `.lahe-doc-style.css`
  - `.lahe-fonts/<font>.woff2`

  The style bundle keeps its usual name so its own relative font URLs (`./.lahe-fonts/...`) resolve under `/catalog/assets/`. The architecture lists the same set but gave no names.
- **The check block lives in `auth.js`, not `protocol.js`.** The plan does not list `protocol.js` among this task's files. `protocol.headerOf` and `tokensEqual` are not exported, so `auth.js` has its own small copies.
- **The CSP adds a few rules** beyond `script-src 'self'` and `frame-ancestors 'none'`: `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`. It sets no `default-src`, so Task 2.2 is free to use inline style attributes. `X-Content-Type-Options: nosniff` is added to every catalog response too.
- **Host is stricter than on the review routes.** It must be exactly `127.0.0.1:<port>` or `localhost:<port>`, per the architecture. `[::1]` and a Host with no port are refused.

## Surprises

- **A request with no Host header never reaches the helper.** Node's HTTP parser answers it with an empty 400 first. The test checks for exactly that.
- **Before this task, `OPTIONS /catalog` from a registered loopback origin got a 204 with approval headers.** The old preflight approved any path for a registered origin. The new test caught it while red.
- **The traversal test passed while red,** because every catalog path was already a 404. I proved it by mutation instead: with a naive `path.join` plus decode in `readAsset`, the test fails.

## Follow-ups (other tasks)

- **Task 2.1:** replace the four stubs in `CATALOG_HANDLERS`, and call `deps.catalog.markSeen(now)` only after an authenticated list. The request body arrives already parsed as `request.body`.
- **Task 2.2:** replace the body in `renderPage` and add the `view_model.js` script tag. The head, meta tag and headers stay. The page script should read names from `LAHE.protocol`.
- **Task 3.2:** the cross-site browser spec on three lanes is still owed. This task proves the checks at the HTTP level only.

## Cleanup needed

Nothing in the repo. One scratch probe script sits in the session scratchpad (`nohost.js`). It is under `/tmp`, so it needs no removal.
