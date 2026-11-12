---
read-when: Building or reviewing slice C4 of the TypeScript migration.
---

# C4 spec: the protocol, rebuilt as `src/contract/`

`src/shared/protocol.js` is the wire: every byte that leaves the repo for an agent, a browser or a person typing a script tag. It holds the route tables, the headers, the per-request check block, the error body, the event line, the draft flush policy, the reply line, the script tag, the agent commands, the agent liveness words and the Library's constants. This slice rebuilds it as seventeen small modules in `src/contract/`, one job each, plus one temporary bridge module that gives the 192 unconverted callers the old flat namespace.

## 1. Scope

**Old file.** `src/shared/protocol.js`: 2,277 lines, of which 899 are comment lines, 132 blank and 1,246 code (counted by `c4_count_lines.py`, first-non-space definition, which matches the recon's 899). It loads in three places today: Node (`require`), the review layer bundle (entry 13 of `LAYER_FILES`, as `window.LAHE.protocol`), and the Library page, which loads it raw from `src/` until S0c moves that page to `dist/lahe-library.js`.

The counting scripts this spec names (`c4_count_lines.py`, `c4_callers.py`, `c4_pins.py`, `c4_fill.py`) ran from the spec writer's scratchpad on 2026-11-12 and are not kept; rerun the same scans if a count matters.

**Old test file owned by this slice.** `test/unit/protocol_wire.test.js`: 551 lines, 41 test cases. Thirty other unit test files and one browser spec hold cases that pin or call a protocol export; section 5 accounts for each.

**New modules.** All in `src/contract/`, which imports nothing outside itself. Imports between these modules are listed in section 4.

| Module | Job |
| --- | --- |
| `json-object.ts` | Narrows an `unknown` JSON value to a plain object, for the parsers below |
| `safe-id.ts` | The one safe-id rule for ids that become path components |
| `service-contract.ts` | The API version, the service contract number and the verdict on a running helper's number |
| `helper-address.ts` | Where the helper listens, and which Host headers name it |
| `review-write.ts` | What `review.write` accepts in its body: registerable origins, the origin limit, the notes flag |
| `site-addresses.ts` | Site names, the pages port table, Host classification and site origins |
| `headers.ts` | Header names, client values, the JSON content type and the signed-request wire |
| `routes.ts` | The four route tables, the auth modes and route lookup |
| `request-checks.ts` | The per-request check block for review routes |
| `error-body.ts` | The HTTP status for a code, and the one error body shape |
| `events.ts` | The `events.jsonl` line: vocabulary, fields, building, encoding and parsing |
| `flush.ts` | The draft flush policy and the keepalive size check |
| `replies.ts` | The reply line, the reply files and the reply poll |
| `script-tag.ts` | The script tag: attributes, opt-in values, alias checks and the tag writer |
| `agent-commands.ts` | CLI exit codes, the wake feed, and the one spelling of each command an agent runs |
| `agent-liveness.ts` | Monitor files, the liveness words and timings, the overdue rule and the hand-off message |
| `library.ts` | The Library's constants, its legacy pick-up note and its log line |
| `protocol.ts` | The bridge: re-exports every module above, for the forwarder and the browser registration only. Removed in F1 |

That is seventeen modules plus the bridge. `json-object.ts` is small and generic; C3's record parsers can reuse it.

**Forwarder.** `src/shared/protocol.js` becomes `module.exports = require("../contract/protocol.ts");`, listed in the manifest's `FORWARDERS`. Its bundle entry becomes the generated registration S0c built for converted browser modules (as `elapsed` did), registered as `LAHE.protocol` in both bundles: the review layer and the Library page.

**Folder doc.** `docs/ongoing/code/contract.md` gains one section per new module (section 9). C1 creates the file; if it has not, this slice creates it with the frontmatter and opening that `docs/ongoing/code/README.md` and `server-sites.md` show. Either way it adds only its own sections.

**New tests.** `test/unit/contract/<module>.test.ts`, one file per module that has behavior. `test/unit/protocol_wire.test.js` moves with `git mv` to `test/unit/contract/request-checks.test.ts` and is rewritten; the other new files are created.

## 2. Behavior

Each statement is something a caller, a person or an agent can observe, and each is checkable by a test. Exact strings are exact. Where a statement lists a table, the test compares the whole table, because every value in it goes on the wire or in front of a person.

### `safe-id.ts`

- **B1.** `isSafeId(value)` is true exactly when `value` is a string of 1 to 64 characters whose first character is an ASCII letter or digit and whose others are ASCII letters, digits, `.`, `_` or `-`. True: `"rev_a"`, `"a"`, 64 `a`s, `"s.1-x_2"`. False: 65 `a`s, `""`, `".hidden"`, `"-a"`, `"../etc"`, `"a b"`, `"a/b"`, `7`, `null`, `undefined`.
- **B2.** `SAFE_ID` is a regular expression with no flags whose `source` is `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Callers build other patterns from it.

### `service-contract.ts`

- **B3.** `API_VERSION` is `"v1"` and `SERVICE_CONTRACT` is `17`.
- **B4.** `CONTRACT_VERDICT` is `{CURRENT: "current", OLDER: "older", NEWER: "newer"}`.
- **B5.** `helperContractVerdict(health)` reads `health.service_contract`. An integer below `SERVICE_CONTRACT` gives `"older"`, equal gives `"current"`, above gives `"newer"`: 13, 14, 15 and 16 are older, 17 is current, 18 is newer. A missing field, a non-integer (`"17"`, `16.5`, `null`), or a `health` that is not an object (`null`, `undefined`, `"x"`) gives `"older"`.
- **B6.** `docs/ongoing/code/contract.md` holds a history table row for the current `SERVICE_CONTRACT`: a line matching `^\| <SERVICE_CONTRACT> \| \S`.

### `helper-address.ts`

- **B7.** `DEFAULT_PORT` is `7817`, `DEFAULT_HOST` is `"127.0.0.1"`, and `DEFAULT_HELPER_ORIGIN` is `"http://127.0.0.1:7817"`.
- **B8.** `hostAllowed(host)` is true when `host` is a non-empty string that, after one trailing `:<digits>` is removed, is exactly `127.0.0.1`, `localhost` or `[::1]`. Any port passes. True: `"127.0.0.1:7817"`, `"localhost"`, `"[::1]"`, `"[::1]:9"`. False: `"::1"` (its `:1` is read as a port, leaving `:`), `"LOCALHOST"`, `"evil.example.com"`, `"127.0.0.1.nip.io:7817"`, `"library.lahe.localhost"`, `""`, `undefined`, `["localhost"]`.

### `review-write.ts`

- **B9.** `LOOPBACK_ORIGIN_HOSTS` is `["localhost", "127.0.0.1", "[::1]"]` and `ORIGIN_LIMIT` is `16`.
- **B10.** `isRegisterableOrigin(origin)` is true for the string `"null"`, and for an `http` or `https` origin on a loopback host that is written exactly as a browser serializes an origin: lowercase scheme, the host as listed in B9, and a port only when it is not the scheme's default, with no leading zeros and no larger than 65535. Nothing may follow: no path, not even `/`, no query, no fragment, no credentials. True: `"null"`, `"http://localhost:3000"`, `"https://127.0.0.1:8443"`, `"http://[::1]:5000"`, `"http://localhost"`, `"http://localhost:0"`. False: `"http://localhost:3000/"`, `"http://localhost:3000/x"`, `"http://localhost:3000?"`, `"http://localhost:80"`, `"https://localhost:443"`, `"http://localhost:03000"`, `"http://localhost:65536"`, `"http://localhost:"`, `"HTTP://localhost:3000"`, `"http://LOCALHOST:3000"`, `"http://u:p@localhost:3000"`, `"http://127.1:3000"`, `"ftp://localhost"`, `"http://evil.example"`, `""`, `3000`, `null`.
- **B11.** `acceptsNotesFlag(body)` is true only when `body` is an object whose `notes` is the boolean `true`. `{notes: "true"}`, `{notes: 1}`, `{notes: false}`, `{}`, `null` and `"notes"` give false.

### `site-addresses.ts`

- **B12.** `PAGES` is exactly: `PORT` 1483, `PORT_ENV` `"LAHE_PAGES_PORT"`, `SUFFIX` `"lahe.localhost"`, `PRINTED_ENDING` `"lahe.localhost"`, `PRINTED_ENDING_REASON` `"every browser treats .localhost names as this computer and as secure, with no setup"`, `PORT_FREE_OFF_REASON` `"the port-80 forward is not set up"`, `LAHE_NAMES_OFF_REASON` `"the .lahe option is not set up"`, `LIBRARY_NAME` `"library"`, `MAX_LABELS` 4, `LABEL_MAX` 63, `NAME_MAX` 150, `RESERVED_NAMES` `["library", "lahe", "www", "api"]`, `MODE_SITES` `"sites"`, `CORP` `"same-origin"`. The reason strings are printed by `lahe status` and the start log line.
- **B13.** `isSiteLabel(value)` is true for a string of 1 to 63 characters made of lowercase ASCII letters and digits in runs joined by single dashes. True: `"a"`, `"a1"`, `"my-site"`, 63 `a`s. False: 64 `a`s, `"-a"`, `"a-"`, `"a--b"`, `"xn--abc"`, `"A"`, `"a_b"`, `"a.b"`, `""`, `5`.
- **B14.** `isSiteName(value)` is true for a string of at most 150 characters that is one to four site labels joined by `.`. True: `"a"`, `"a.b"`, `"a.b.c.d"`. False: `"a.b.c.d.e"`, `"a..b"`, `"a."`, `".a"`, `"A.b"`, `""`.
- **B15.** `HOST_FAMILY` is `{API: "api", LIBRARY: "library", PAGE: "page", BAD: "bad"}`.
- **B16.** `classifyHost(host, {pagesPort, laheNames})` returns:
  - `{family: "api"}` for any host `hostAllowed` accepts (B8);
  - for `<name>.lahe.localhost` with no port or with `:<pagesPort>`: `{family: "library", name: "library"}` when the name is `library`, `{family: "page", name}` when the name is a site name, and `{family: "bad"}` otherwise. Any other port gives `{family: "bad"}`, for the Library too: `library.lahe.localhost:9999` and `library.lahe.localhost:7817` are bad when the pages port is 1483;
  - for `<name>.lahe` with no port or with `:<pagesPort>`, and only when `laheNames` is `true`: `{family: "page", name}` for a site name other than `library`. `library.lahe` is bad whether or not `laheNames` is set;
  - `{family: "bad"}` for everything else: a trailing dot (`"a.b.lahe."`), uppercase (`"A.b.lahe"`), five labels, a foreign name, `""`, a non-string.
  The `api` and `bad` results carry no `name` key.
- **B17.** `siteOrigin(name, port)` is `"http://<name>.lahe.localhost:<port>"`, and `"http://<name>.lahe.localhost"` when `port` is 80.
- **B18.** `siteNameFromOrigin(origin, pagesPort, laheNames)` returns the site name for `http://<name>.lahe.localhost` with no port or `:<pagesPort>`, and, only when `laheNames` is `true`, for `http://<name>.lahe` the same two ways. It returns `null` for the Library's name, a name that is not a site name, any other port, `https`, a non-string, and a `.lahe` origin when `laheNames` is not `true`. Examples with pages port 1483: `"http://a.b.lahe.localhost"` and `"http://a.b.lahe.localhost:1483"` give `"a.b"`; `"http://a.b.lahe.localhost:9999"` gives `null`; `"http://a.b.lahe"` gives `null` without `laheNames` and `"a.b"` with it; `"http://library.lahe"` and `"https://a.b.lahe"` give `null`.

### `headers.ts`

- **B19.** `HEADER` is exactly: `CLIENT` `"x-lahe-client"`, `TOKEN` `"x-lahe-token"`, `REQUEST_ID` `"x-lahe-request-id"`, `CONTENT_TYPE` `"content-type"`, `ORIGIN` `"origin"`, `HOST` `"host"`, `SEC_FETCH_SITE` `"sec-fetch-site"`, `SEC_FETCH_MODE` `"sec-fetch-mode"`, `SEC_FETCH_DEST` `"sec-fetch-dest"`, `CLI_SECRET` `"x-lahe-cli-secret"`, `PROOF_TS` `"x-lahe-proof-ts"`, `PROOF_NONCE` `"x-lahe-proof-nonce"`, `PROOF` `"x-lahe-proof"`, `PROOF_REPLY` `"x-lahe-proof-reply"`.
- **B20.** `CLIENT_LAYER` is `"layer"`, `CLIENT_CLI` is `"cli"`, `CLIENT_CATALOG` is `"catalog"`, and `JSON_CONTENT_TYPE` is `"application/json"`.
- **B21.** `PROOF.REQUEST_PREFIX` is `"lahe-proof-v1"`, `PROOF.REPLY_PREFIX` is `"lahe-proof-reply-v1"`, `PROOF.WINDOW_MS` is 30000. `PROOF.TS_PATTERN` accepts 1 to 16 ASCII digits and nothing else; `PROOF.NONCE_PATTERN` accepts exactly 32 lowercase hex digits; `PROOF.MAC_PATTERN` accepts exactly 64 lowercase hex digits. Uppercase hex is refused by both. `SUMMARY_VERSION` is 1.

### `routes.ts`

- **B22.** `BASE` is `"/lahe/v1"`. `AUTH` is `{NONE: "none", REVIEW_TOKEN: "review_token", CATALOG_TOKEN: "catalog_token", CLI_SECRET: "cli_secret", CLI_PROOF: "cli_proof"}`.
- **B23.** `ROUTES`, in this order, with these names, methods, paths, auth modes and `mutating` values, and no other entries:

  | name | method | path | auth | mutating |
  | --- | --- | --- | --- | --- |
  | `health` | GET | `/lahe/v1/health` | none | false |
  | `events.append` | POST | `/lahe/v1/events` | review_token | true |
  | `library.get` | GET | `/lahe-layer.js` | none | false |
  | `review.write` | POST | `/lahe/v1/review` | review_token | true |
  | `review.read` | GET | `/lahe/v1/review` | review_token | false |
  | `records.read` | GET | `/lahe/v1/records` | review_token | false |
  | `replies.poll` | GET | `/lahe/v1/replies` | review_token | false |
  | `window.claim` | POST | `/lahe/v1/window` | review_token | true |
  | `window.release` | POST | `/lahe/v1/window/release` | review_token | true |
  | `review.end` | POST | `/lahe/v1/end` | review_token | true |

- **B24.** `CATALOG_ROUTES`, in this order, every one with auth `catalog_token`:

  | name | method | path | mutating | checks |
  | --- | --- | --- | --- | --- |
  | `catalog.page` | GET | `/catalog` | false | `sec_fetch_site: ["none", "same-origin"]`, `top_level_navigation: true`, `token: false`, `json_body: false`, `origin: null` |
  | `catalog.asset` | GET | `/catalog/assets/`, with `prefix: true` | false | `sec_fetch_site: ["none", "same-origin"]`, `token: false`, `json_body: false`, `origin: null` |
  | `catalog.list` | GET | `/lahe/v1/catalog/list` | false | `sec_fetch_site: ["same-origin"]`, `token: true`, `json_body: false`, `origin: null` |
  | `catalog.open` | POST | `/lahe/v1/catalog/open` | true | `sec_fetch_site: ["same-origin"]`, `token: true`, `json_body: true`, `origin: "exact"` |
  | `catalog.star` | POST | `/lahe/v1/catalog/star` | true | as `catalog.open` |
  | `catalog.rename` | POST | `/lahe/v1/catalog/rename` | true | as `catalog.open` |
  | `catalog.request` | POST | `/lahe/v1/catalog/request` | true | as `catalog.open` |

  Only `catalog.page` carries `top_level_navigation`, and only `catalog.asset` carries `prefix`.
- **B25.** `SITE_ROUTES` is `site.bind` (POST `/lahe/v1/site/bind`) then `review.retire` (POST `/lahe/v1/review/retire`), both auth `cli_secret` and mutating. `SUMMARY_ROUTES` is `summary.read` (GET `/lahe/v1/summary`, not mutating) then `summary.open` (POST `/lahe/v1/summary/open`, mutating, `refuse_origin: true`), both auth `cli_proof`. Only `summary.open` carries `refuse_origin`.
- **B26.** Route names are unique across the four lists.
- **B27.** `route(name)` returns the entry with that name from whichever list holds it. For a name no list holds, it throws an `Error` whose message is `unknown route: <name>. Routes are listed in src/contract/routes.ts`.
- **B28.** `CATALOG_PAGE_PATH` is `"/catalog"`, `CATALOG_TOKEN_META` is `"lahe-catalog-token"`, and `HEALTH_FIELD` is `{CATALOG_SEEN_AT: "catalog_seen_at"}`.

### `request-checks.ts`

- **B29.** `CHECK` is `{HOST: "host", CUSTOM_HEADER: "custom_header", CONTENT_TYPE: "content_type", REVIEW_KNOWN: "review_known", TOKEN: "token", ORIGIN: "origin", SEC_FETCH_SITE: "sec_fetch_site", SEC_FETCH: "sec_fetch", PROOF: "proof"}`. `CHECKS` lists `{name, code}` in that order with codes `PROTO_BAD_HOST`, `PROTO_MISSING_CUSTOM_HEADER`, `PROTO_UNSUPPORTED_MEDIA_TYPE`, `PROTO_UNKNOWN_REVIEW`, `PROTO_UNAUTHORIZED`, `PROTO_FORBIDDEN_ORIGIN`, `PROTO_CROSS_SITE`, `AUTH_REFUSED`, `AUTH_REFUSED`.
- **B30.** `checkRequest({routeName, headers, review}, config)` checks a request to a route in `ROUTES` in this order, and reports the first check that fails: host, custom header, content type, review known, token, origin. A refusal is `{ok: false, check, code, log}`, where `code` is the check's code from B29 and `log` is `refused <routeName>: check <check> failed`, followed by ` (<detail>)` when the check has a detail.
- **B31.** **Host**, on every route including the open ones: the Host header must pass `hostAllowed` (B8). The detail is the header value as text, so a missing header gives `(null)`. Example log: `refused events.append: check host failed (evil.example.com)`.
- **B32.** **Open routes** (`health`, `library.get`): once the host passes, the result is `{ok: true, review: null, origin}` where `origin` is the Origin header or `null`. No other check runs, and `config` may be `null`.
- **B33.** **Custom header**: `x-lahe-client` must be exactly `"layer"` or `"cli"`. `"catalog"`, any other value, or none is refused with no detail.
- **B34.** **Content type**, on mutating routes only: the part of the Content-Type header before any `;`, trimmed and lowercased, must be `application/json`. `"application/json; charset=utf-8"` and `"Application/JSON"` pass. The detail is that media type, or `none` when the header is missing. A GET route skips this check, with or without a body type.
- **B35.** **Review known**: refused when `config` is `null` or has no `reviews`, when `review` is not a safe id, or when `config.reviews` has no own entry for it. A review id that names an inherited property (`"constructor"`, `"toString"`) is refused. The detail is the review value as text.
- **B36.** **Token**: refused, with no detail, when the registered token is missing or empty, when `x-lahe-token` is missing or not a string, or when the two differ in any way, including one being a prefix of the other.
- **B37.** **Origin**: the Origin header, or `"null"` when the header is missing or empty, must be in the review's registered origins. The detail is that effective origin. A file page's `null` origin passes only when the review registered `"null"`. An origin given anywhere in the request object other than the header (for example a top-level `origin` field) is ignored.
- **B38.** A request that passes every check gives `{ok: true, review, origin}` with the review id and the effective origin from B37.
- **B39.** Header names match in any letter case: `Host`, `X-Lahe-Token` and `CONTENT-TYPE` are read like their lowercase forms.
- **B40.** Every route in `ROUTES` except `health` and `library.get` refuses a request with no custom header and a request with no token, and every mutating one refuses a request with a `text/plain` body type. This is the old `requiredHeaders` promise, now checked through `checkRequest`.
- **B41.** `checkRequest` throws for a route name that is not in `ROUTES`, including a Library, site or summary route name. Those routes have their own credentials, checked in the server.

### `error-body.ts`

- **B42.** `statusFor(code)` returns: 400 for `PROTO_BAD_REQUEST`, `PROTO_BAD_HOST`, `PROTO_MISSING_CUSTOM_HEADER`; 415 for `PROTO_UNSUPPORTED_MEDIA_TYPE`; 401 for `PROTO_UNAUTHORIZED` and `AUTH_REFUSED`; 403 for `PROTO_FORBIDDEN_ORIGIN`, `PROTO_NOT_OWNER`, `PROTO_CROSS_SITE`; 404 for `PROTO_UNKNOWN_REVIEW`, `PROTO_UNKNOWN_ITEM`; 409 for `PROTO_STALE_REV`, `PROTO_SECOND_WINDOW`, `PROTO_SECOND_INSTANCE`, `PROTO_NOT_OPENABLE`, `PROTO_REQUEST_PENDING`, `PROTO_NO_AGENT`, `PROTO_CONFIRM_NEEDED`, `PROTO_NO_LAUNCH`, `SUMMARY_VERSION`; 410 for `PROTO_REVIEW_RETIRED`; 429 for `PROTO_QUEUE_FULL`; 500 for `PROTO_CATALOG_UNREADABLE`; and 500 for any other code, including `"SOMETHING_UNMAPPED"` and inherited property names such as `"toString"`.
- **B43.** `errorBody(code, detail, requestId, check)` returns `{error: {code, message, remedy, detail, check, request_id}}`. `code` is the code as given (an old alias stays an alias), `message` and `remedy` are the failure table's for that code, and `detail`, `check` and `request_id` are `null` when not given. Example: `errorBody("PROTO_FORBIDDEN_ORIGIN", "https://attacker.example", "req_1", "origin")` has `error.code` `"PROTO_FORBIDDEN_ORIGIN"`, `error.check` `"origin"`, `error.request_id` `"req_1"`. A code the failure table does not know throws the failure table's own error.

### `events.ts`

- **B44.** `EVENT` maps `REVIEW_CREATED`, `ORIGIN_REGISTERED`, `ORIGIN_REMOVED`, `PAGE_VISITED`, `ITEM_CREATED`, `ITEM_CONTENT`, `ITEM_READY`, `ITEM_DELETED`, `ITEM_REOPENED`, `ITEM_CLOSED`, `REPLY_SEEN`, `REPLY_FOLDED`, `REPLY_REJECTED`, `REVIEW_ARCHIVED`, `REVIEW_ADOPTED` to `review.created`, `origin.registered`, `origin.removed`, `page.visited`, `item.created`, `item.content`, `item.ready`, `item.deleted`, `item.reopened`, `item.closed`, `reply.seen`, `reply.folded`, `reply.rejected`, `review.archived`, `review.adopted`. `EVENT_TYPES` is those fifteen values, in that order, and nothing else.
- **B45.** `EVENT_FIELD` is `{EVENT: "event", EVENT_ID: "event_id", TS: "ts", SEQ: "seq", REVIEW: "review", ITEM: "item", REV: "rev", PAGE_PATH: "page_path", PAGE_TITLE: "page_title", PAGE_SEQ: "page_seq", SOURCE_HINT: "source_hint", RECEIVED_AT: "received_at"}`, and `IDEMPOTENCE_KEY` is `"event_id"`.
- **B46.** `newEvent(input)` returns an object whose first keys are, in order, `event`, `event_id`, `ts`, `seq`, `review`, `item`, `rev`, `page_path`, `page_title`, `page_seq`, `source_hint`, followed by the keys of `input.payload` that are not among those. `ts` is `input.ts` when given and non-empty, else the current time as an ISO string. `seq`, `rev` and `page_seq` are the input's value when it is a number, else `null`. `item`, `page_path`, `page_title` and `source_hint` are the input's value when it is non-empty, else `null`. A payload key that names a base field (`event_id`, `review`, `ts`, ...) is ignored, so a payload can never change the event's identity. A payload that is not an object adds nothing. Two events for the same item and revision with different `event_id`s are both kept as distinct events.
- **B47.** `newEvent` throws when `event` is not in `EVENT_TYPES` (message `newEvent: event must be one of <EVENT_TYPES joined by ", ">, got <event>`), when `event_id` is missing, empty or not a string (message `newEvent: event_id is required and is client-minted; idempotence is by event_id`), and when `review` is not a safe id (message `newEvent: review must be a safe id, got <review>`).
- **B48.** `encodeEventLine(event)` is the JSON of the event followed by one `"\n"`. The result has no other newline even when a string value holds newlines, tabs and quotes, and `parseEventLine` of the line without its newline gives back the same values.
- **B49.** `parseEventLine(line)` returns `{ok: true, event}` with every field of the line kept, when the line is a JSON object whose `event` is in `EVENT_TYPES` and whose `event_id` is a non-empty string. Otherwise `{ok: false, reason}`: `not JSON: <parser message>` for text that is not JSON; `not an object` for JSON that is `null`, a number, a string, a boolean or an array; `unknown event type <value>` for a missing or unknown `event`; `missing event_id, which is the idempotence key` for a missing or empty `event_id`. It never throws.

### `flush.ts`

- **B50.** `FLUSH` is exactly `{HELPER_DEBOUNCE_MS: 750, DRAFT_FLOOR_MS: 10000, RUN_DRAFT_FLOOR_MS: 30000, PRESS_QUIET_MS: 3000, PRESS_CAP_MS: 10000, IMMEDIATE_ON: ["blur", "hide", "ready", "navigation", "unload"], KEEPALIVE_MAX_BYTES: 65536}`.
- **B51.** `fitsKeepalive(body)` measures a string body in UTF-8 bytes and any other body as the UTF-8 bytes of its JSON, and is true when that is at most 65536. `"x"` repeated 65536 times fits and 65537 does not; `"é"` repeated 32768 times (65536 bytes) fits and 32769 does not; one emoji counts 4 bytes and one lone surrogate counts 3, as a browser's encoder does; an object whose JSON is over the limit does not fit.

### `replies.ts`

- **B52.** `REPLY_FIELD` is `{ITEM: "item", REV: "rev", STATUS: "status", AGENT: "agent", REASON: "reason", TEXT: "text", FILES: "files", NEEDS_SEE: "user_needs_to_see_reply", PROOFREAD: "proofread", SUGGESTIONS: "suggestions"}`. `REPLY_STATUS` is `{HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question"}` and `REPLY_STATUSES` is `["handled", "not_handled", "question"]`.
- **B53.** `parseReplyLine(line, options)` never throws, whatever string it is given. Every refusal is `{ok: false, code: "REPLY_LINE_MALFORMED", reason}`.
- **B54.** Text that is not JSON is refused with reason `not JSON: <parser message>`; JSON that is not an object, or is an array, with `a reply line must be a JSON object`.
- **B55.** A `status` outside `REPLY_STATUSES` is refused with `status must be one of handled, not_handled, question, got <status as JSON>`: `got "done"` for `"done"`, `got undefined` when missing.
- **B56.** Each status requires fields: `handled` needs `item`, `rev`, `status`; `not_handled` also `reason`; `question` also `text`. `item` must be a string with a non-space character, `rev` a number, and `reason` or `text`, where required, a string with a non-space character. A line that fails is refused with `status <status> needs <its required fields joined by ", ">; missing or wrong type: <each failing field once, in required order>`. Example: `{"item":"c_1","rev":2,"status":"not_handled","reason":"   "}` gives `status not_handled needs item, rev, status, reason; missing or wrong type: reason`. A line with no `item` names `item` once.
- **B57.** An accepted line gives `{ok: true, reply, reason: null}` where `reply` has `item`, `rev`, `status`, `agent`, `reason` (the string, else `null`), `text` (the string, else `null`), `files` (a copy of the list, else `[]`), and `user_needs_to_see_reply`, which is `true` only for the boolean `true`; `"yes"`, `1`, `null`, `{}` and a missing field give `false` and do not cost the line.
- **B58.** `agent` is the line's `agent` when it is a non-empty string, else `options.filenameAgent` when given, else `null`. The line's agent wins over the filename's.
- **B59.** A line carrying `proofread` or `suggestions` is a proofread. It is refused unless the status is `question` (`proofread and suggestions belong on a question reply only`) and `proofread` is the boolean `true` (`proofread must be true when suggestions are given`). `suggestions`, `[]` when missing, is refused with: `suggestions must be a list`; `suggestions holds <n> fixes, more than 400`; `suggestion <i> must be an object`; `suggestion <i> block must be a whole number from 0`; `suggestion <i> from must be a non-empty string`; `suggestion <i> to must be a string`; `suggestion <i> from or to is over 200000 characters`. An accepted proofread carries `proofread: true` and `suggestions` as a list of `{block, from, to}` with any other keys dropped. A reply that is not a proofread has neither key.
- **B60.** `SUGGESTIONS_MAX` is 400 and `SUGGESTION_TEXT_MAX` is 200000. A list of exactly 400 is accepted and 401 refused; a `from` or `to` of 200000 characters is accepted and 200001 refused.
- **B61.** `REPLY_FILE` is `{SINGLE: "replies.jsonl", PATTERN, prefix: "replies-", suffix: ".jsonl"}`, where `PATTERN` matches `replies.jsonl` and `replies-<agent>.jsonl` exactly when `<agent>` is a safe id (B1), with the agent as group 1.
- **B62.** `agentFromFilename(name)` gives `{ok: true, agent: null, reason: null}` for `"replies.jsonl"`, `{ok: true, agent: "claude", reason: null}` for `"replies-claude.jsonl"`, and `{ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl"}` for anything else, including `"replies-../../etc/passwd.jsonl"`, `"replies-.jsonl"`, `"notes.txt"`, a name with 65 agent characters, and a non-string.
- **B63.** `REPLY_POLL.INTERVAL_MS` is 5000 and `REPLY_CURSOR_FIELD` is `"seq"`.
- **B64.** `nextReadOffset(recorded, size)` uses `recorded` when it is a number above 0, else 0. When `size` is below that offset the file was rewritten, and the result is `{offset: 0, refold: true}`; otherwise `{offset, refold: false}`. `(120, 400)` gives `{offset: 120, refold: false}`, `(400, 120)` gives `{offset: 0, refold: true}`, `(null, 50)` gives `{offset: 0, refold: false}`. It throws `nextReadOffset: fileSize must be a number` when `size` is not a finite number of 0 or more.
- **B65.** `splitCompleteLines(chunk)` gives every complete line (ended by `"\n"`) in `lines`, and the text after the last newline in `remainder`. `'{"a":1}\n{"b":2}\n{"c":3 half'` gives two lines and remainder `'{"c":3 half'`; a chunk ending in a newline gives remainder `""`; `""` gives no lines and remainder `""`.

### `script-tag.ts`

- **B66.** `SCRIPT_ATTR` is `{REVIEW: "data-lahe-review", TOKEN: "data-lahe-token", HELPER: "data-lahe-helper", FALLBACK: "data-lahe-fallback", FRAMES: "data-lahe-frames", START: "data-lahe-start", NOTES: "data-lahe-notes", DOCUMENT: "data-lahe-document", ALIASES: "data-lahe-aliases", PATH_ALIASES: "data-lahe-path-aliases", SPELLINGS: "data-lahe-spellings"}`. `SCRIPT_SELECTOR` is `"script[data-lahe-review]"`. `FRAMES_ALLOW` is `"allow"`, `START_HIDDEN` is `"hidden"`, `NOTES_ON` and `DOCUMENT_ON` are `"true"`, and `ALIAS_MAX` is 16.
- **B67.** `SCRIPT_FALLBACK_ONERROR` is exactly `var s=document.createElement('script');s.src=this.getAttribute('data-lahe-fallback');document.head.appendChild(s)`, and holds no `>` and no `"`.
- **B68.** `scriptTag(options)` writes one line per attribute, each after eight spaces, in this order, and ends with `        defer></script>`:
  ```
  <script src="<src>"
          data-lahe-review="<review>"
          data-lahe-token="<token>"
          data-lahe-helper="<helper, default http://127.0.0.1:7817>"
          data-lahe-fallback="<fallback>"            only when fallback is given and non-empty
          onerror="<SCRIPT_FALLBACK_ONERROR>"        with the fallback line
          data-lahe-notes="true"                     only when notes is true
          data-lahe-document="true"                  only when document is true
          data-lahe-aliases="<JSON>"                 when aliases is given, even as []
          data-lahe-path-aliases="<JSON>"            when pathAliases is given
          data-lahe-spellings="<JSON>"               when spellings is given
          defer></script>
  ```
  The output for `{src: "http://127.0.0.1:7817/lahe-layer.js", review: "rev_a", token: "tok_abc", fallback: "lahe-layer.js"}` is byte for byte the string pinned in today's `protocol_wire.test.js` ("the script tag carries the offline fallback when one is named"). Without a fallback there is no `onerror` and no `data-lahe-fallback`.
- **B69.** The JSON lists are written with `&`, `"`, `<` and `>` replaced by `&amp;`, `&quot;`, `&lt;` and `&gt;`. Aliases `["http://127.0.0.1:51001", "http://localhost:51001"]` give `data-lahe-aliases="[&quot;http://127.0.0.1:51001&quot;,&quot;http://localhost:51001&quot;]"`.
- **B70.** `scriptTag` throws, before writing anything, with these messages: `scriptTag: src is required (the path to the built library)` for a missing or empty `src`; `scriptTag: review must be a safe id`; `scriptTag: token is required; absent configuration fails closed` for a missing or empty `token`; `scriptTag: aliases must be a list`, `scriptTag: at most 16 aliases`, `scriptTag: an alias must be a loopback http origin, not <JSON>`; `scriptTag: pathAliases must be a list`, `scriptTag: at most 16 path aliases`, `scriptTag: a path alias must be an absolute path, not <JSON>`; `scriptTag: spellings must be a list`, `scriptTag: at most 16 spellings`, `scriptTag: a spelling is "origin path", not <JSON>`.
- **B71.** `isLoopbackPortOrigin(value)` is true for `http://127.0.0.1:<1 to 5 digits>` and `http://localhost:<1 to 5 digits>`, and false for `https`, `[::1]`, no port, a path, uppercase, and non-strings.
- **B72.** `isPathAlias(value)` is true for `/` followed by up to 511 characters, none of them `"`, `'`, `<`, `>`, `\` or whitespace. `"/"` and `"/a/b-c.html"` are true; `"a"`, `"/a b"`, `"/a\"b"` and a 513-character path are false.
- **B73.** `isSpellingOrigin(value)` is true for `http://` followed by 1 to 253 of lowercase letters, digits, `.` and `-`, and an optional `:<1 to 5 digits>`. `isSpelling(value)` is true for `"<origin> <path>"`, split at the first space, where the origin half passes `isSpellingOrigin` and the path half passes `isPathAlias`. `"http://a.lahe.localhost:1483 /doc.md"` is true; `" /doc.md"`, `"http://a /x y"` and `"https://a /x"` are false.

### `agent-commands.ts`

- **B74.** `CLI_EXIT` is `{OK: 0, HELPER_UNREACHABLE: 2, UNKNOWN_REVIEW: 3, BAD_USAGE: 4, SESSION_CLOSED: 5, SESSION_TAKEN_OVER: 6}`.
- **B75.** `WAKE` is `{FILE: "wake.log", KIND: {WORK: "work", TAKEOVER: "takeover", CLOSED: "closed", ENDED: "ended"}, FIELD: {AT: "at", KIND: "kind", REVIEW: "review", ITEM: "item", REV: "rev", DRAIN: "drain"}}`.
- **B76.** `stateDirFlag(dir)` is `""` for a missing, empty or non-string `dir`, and otherwise ` --state-dir <word>`, where the word is `dir` itself when it holds only `A-Z a-z 0-9 _ @ % + = : , . / -`, and otherwise `dir` in single quotes with each `'` written as `'\''`. `"/tmp/lahe-state"` stays bare; `"/Users/a b/Library/Application Support/lahe"` becomes `'/Users/a b/Library/Application Support/lahe'`.
- **B77.** `drainCommand(session, dir)` is `lahe status --session <session> --json --quiet` plus `stateDirFlag(dir)`.
- **B78.** `monitorCommand(sessions, dir, revisions)` is `lahe monitor`, then ` --session <id>` for each session in order (one id or a list), each followed by ` --handoff-rev <n>` when `revisions` holds an integer for that id, then `stateDirFlag(dir)`. Ids are written as given and not checked, so a placeholder such as `<agent-session-id>` is written unchanged. `(["s_a", "s_b"], null)` gives `lahe monitor --session s_a --session s_b`; `("s_1", "/tmp/lahe-state")` gives `lahe monitor --session s_1 --state-dir /tmp/lahe-state`.
- **B79.** `takeoverCommand(session, dir, request)` is `lahe session takeover <session>` plus `stateDirFlag(dir)`, plus ` --request <request>` only when `request` is a safe id.

### `agent-liveness.ts`

- **B80.** `MONITOR` is `{HEARTBEAT_FILE: "monitor.json", ACTIVITY_FILE: "activity.json", DELIVERED_FILE: "delivered.json", INTERVAL_SECONDS: 15, FRESH_INTERVALS: 3, HEARTBEAT_FIELD: {PID: "pid", HANDOFF_REV: "handoff_rev", AT: "at", PRIMARY: "primary"}, ACTIVITY_FIELD: {AT: "at"}, HEARTBEAT_FRESH_MS: 45000}`.
- **B81.** `AGENT_LIVENESS.STATE` is `{WORKING: "working", WAITING: "waiting", NO_AGENT: "no_agent", NONE: "none"}`. `AGENT_LIVENESS.FIELD` is `{STATE: "state", UNANSWERED: "unanswered", OLDEST_UNANSWERED_AT: "oldest_unanswered_at", LAST_REPLY_AT: "last_reply_at", LISTENING: "listening", MONITOR_AT: "monitor_at", ACTIVITY_AT: "activity_at", SESSION_ID: "session_id", STATE_DIR_FLAG: "state_dir_flag_needed", OLDEST_ITEM: "oldest_unanswered_item", NAME: "session_name", NAME_FROM_PAGE: "session_name_from_page", PRESENCE: "presence"}`. `AGENT_LIVENESS.PRESENCE` is `{LISTENING: "listening", WORKING: "working", AWAY: "away"}`.
- **B82.** The words the reviewer reads, exactly:
  - `TEXT`: `working` `"agent is working, {age}"`, `waiting` `"nothing back yet, {age}"`, `no_agent` `"nobody has picked this up, {age}"`, and no entry for `none`.
  - `CONNECTION`: `connected` `"agent listening"`, `absent` `"no agent listening"`.
  - `DETAIL`: `helper_up` `"The helper is answering this page, so comments and edits reach it as you make them."`, `helper_down` `"The helper is not answering right now, so your work is being kept in this browser until it is."`, `agent_connected` `"An agent has this review open."`, `agent_absent` `"No agent has this review open."`, `agent_unknown` `"Whether an agent has this review open cannot be checked on this computer."`, `agent_named` `"The agent on this review is named {name}."`, `replied` `"The agent last replied {reply} ago."`, `never_replied` `"The agent has not replied on this review yet."`, `waiting` `"Your oldest unanswered item has been waiting {age}."`, `stored` `"Your comments and edits are stored in this browser and in the helper's log on disk."`, `save` `"You can get your own copy any time: use Copy review or Export review to file in the menu."`.
  - `PROMINENT`: `BANNER.no_agent` `"Nobody has picked up your comments in {age}."`, `BANNER.waiting` `"Nothing has come back on your comments in {age}."`, `CHECK` `"Check your agent's window first. It may have stopped, or it may be waiting on you."`, `CHECK_NAMED` `"Check the agent named {name} first. It may have stopped, or it may be waiting on you."`, `HANDOFF_BUTTON` `"Copy a message for a new agent"`, `COPIED` `"Copied. Paste it into a new agent and it will pick up your comments."`, `COPY_FAILED` `"Could not copy. Select the message below and copy it yourself."`, `CARD` `"waiting {age}"`, `TOAST_LABEL` `"Comments waiting"`, `TOAST_CHECK` `"Check your agent's window."`, `TOAST_CHECK_NAMED` `"Check the agent named {name}."`, `TOAST_OPEN` `"Open the rail to hand this doc to a new agent."`.
  None of the `PROMINENT` words contains `monitor`, `heartbeat`, `wake`, `liveness`, `token` or `session`, and none contains an em dash.
- **B83.** `AGENT_LIVENESS.QUIET_MS` is 30000, `ACTIVE_MS` 600000, `STALE_MS` 600000, `RECENT_COMMAND_MS` 600000 and `NO_AGENT_LOUD_MS` 120000. `ACTIVE_MS` equals `RECENT_COMMAND_MS`.
- **B84.** `livenessOverdue(state, waitedMs)` is false when `state` has no `TEXT` entry (`"none"`, an unknown string, `null`), when `waitedMs` is not a finite number, when it is below `QUIET_MS`, and for `"working"` at any wait. For `"no_agent"` it is true from `NO_AGENT_LOUD_MS` on (false at `QUIET_MS` and at `NO_AGENT_LOUD_MS - 1`). For `"waiting"` it is true from `STALE_MS` on (false at `QUIET_MS + 1000` and at `STALE_MS - 1`).
- **B85.** `handoffMessage(handoff)` returns plain text, lines joined by `"\n"`:
  1. `Please take over my live Lahe review<named>. <why>` where `<named>` is `, the session named <name as JSON>` when a non-empty name is given (so `lahe "updates"` is written `"lahe \"updates\""`) and empty otherwise. `<why>` is `The agent that was working on it stopped answering my comments, and I am asking you to continue it.` from the rail, and `I am handing it to you from the Lahe Library so you can continue it.` from the Library.
  2. an empty line;
  3. when the session id is a safe id: `Run this command:`, an empty line, four spaces and the takeover command (B79), an empty line. Otherwise: ``Run `lahe session list<flag>` to find the session for this document, then take it over with:``, an empty line, `    lahe session takeover <session-id><flag>`, an empty line. `<flag>` is `stateDirFlag` of the Library's state dir, and empty from the rail;
  4. from the rail only, when the state-dir flag is needed: `This review keeps its files outside Lahe's default folder, so add --state-dir with the folder the earlier agent's lahe commands used. If you cannot find it, ask me.` and an empty line;
  5. `It prints the commands to catch up. Then work every comment that is waiting and reply to each one, and keep watching for new ones.`
- **B86.** From the Library, the takeover command carries the Library's state dir (quoted as B76 says) and the request id when it is a safe id; the message never contains `stopped answering` or `ask me`. From the rail, it never contains a filesystem path, and a missing session id never produces the text `null` or `undefined`. In both, everything after the first line is the same for the same session, name and state dir, and the first sentence is the same.

### `library.ts`

- **B87.** `CATALOG` is exactly: `REQUEST_EXPIRY_MS` 1800000, `LIBRARY_SEEN_MS` 120000, `WORKING_MS` 120000, `LIBRARY_SESSION_IDLE_MS` 1800000, `CREATED_BY_LIBRARY` `"library"`, `QUEUE_CAP` 5, `REPROJECT_MAX_BYTES` 5242880, `POLL_MS` 15000, `ANSWER_SHOWN_MS` 86400000, `ANSWER_TEXT_MAX` 500, `DEFAULT_VIEW_DAYS` 7, `FOLD_CUTOFF` `"2026-09-17T04:00:00Z"`, `NOT_WORK_EVENTS` `["origin.registered", "origin.removed", "page.visited", "review.adopted", "reply.seen"]`.
- **B88.** `legacyPickupNote(review)` is `It belongs to no session. Serving it takes review <review> into your session, with its old comments; drain it for any still waiting.`
- **B89.** `CATALOG_LOG` is `{PREFIX: "catalog", ACTION: {OPEN: "open", STAR: "star", UNSTAR: "unstar", PICKUP: "pickup", LAUNCH: "launch"}, FORMAT: "catalog <action> review=<id> age_days=<n>"}`. `catalogLogLine(action, review, ageDays)` is `catalog <action> review=<review> age_days=<ageDays>`.
- **B90.** `scripts/catalog_opens.py` still reads the log prefix, the Open action and the default view days from `src/contract/library.ts` and counts Opens (its existing test passes).

### `protocol.ts` (the bridge) and the forwarder

- **B91.** `require("src/shared/protocol.js")` returns an object with every export of the seventeen modules under its own name, and nothing named `AGENT_LIVENESS.handoffMessage`, `AGENT_LIVENESS.overdue` or `CATALOG_LEGACY_NOTE`.
- **B92.** Every name a current caller reads (section 3, after the renames in section 4) is defined on that object, and `window.LAHE.protocol` in both built bundles is the same set of names.

## 3. Callers

193 files reach `protocol.js` today: 47 under `src/`, 3 under `scripts/`, 105 unit test files, 31 browser test files and 7 fixtures and helpers. Counted by `c4_callers.py`, which finds each file's binding (a `require`, a layer factory parameter, `ns.protocol` or `window.LAHE.protocol`) and lists the members it reads outside comments. One Python script, `scripts/catalog_opens.py`, reads the file's text instead; it is in section 8.

"Breaks" marks a file that reads an export this slice renames or removes. The slice edits those call sites (section 4 says how). Every other file keeps working through the forwarder with no edit.

Two findings from the scan:

- `test/unit/addresses.test.js` passes `pages: protocol.PAGES.SWITCH_ON`, which has never existed, so it passes `undefined`. That is not this slice's to fix; it is listed for the board in section 10.
- Eight exports have no reader outside the file, not even a test: `ALLOWED_HOST_NAMES`, `CLIENTS`, `CATALOG_API_BASE`, `checkNamed`, `STATUS_FOR_CODE`, `byteLength`, `REPLY_REQUIRED`, `reviewCommand`. Six more are read only by tests: `requiredHeaders`, `SUGGESTIONS_MAX`, `SUGGESTION_TEXT_MAX`, `REPLY_CURSOR_FIELD`, `SCRIPT_FALLBACK_ONERROR`, `takeoverCommand`.

#### src (47)

| File | Reads | Change |
| --- | --- | --- |
| `src/cli/codex_monitor.js` | `CLI_EXIT`, `MONITOR` |  |
| `src/cli/commands/add.js` | `CLIENT_CLI`, `CLI_EXIT`, `CONTRACT_VERDICT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `EVENT`, `HEADER`, `JSON_CONTENT_TYPE`, `SAFE_ID`, `SCRIPT_ATTR`, `SERVICE_CONTRACT`, `helperContractVerdict`, `isSafeId`, `newEvent`, `route`, `scriptTag` |  |
| `src/cli/commands/hook.js` | `CLI_EXIT`, `MONITOR`, `isSafeId`, `monitorCommand`, `stateDirFlag` |  |
| `src/cli/commands/install.js` | `CLI_EXIT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `PAGES` |  |
| `src/cli/commands/library.js` | `CATALOG`, `CATALOG_LEGACY_NOTE`, `CATALOG_PAGE_PATH`, `CLI_EXIT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `PAGES`, `SAFE_ID`, `isSafeId`, `siteOrigin`, `stateDirFlag` | **breaks:** legacyPickupNote |
| `src/cli/commands/menubar.js` | `CLI_EXIT` |  |
| `src/cli/commands/monitor.js` | `CLI_EXIT`, `MONITOR`, `SAFE_ID`, `drainCommand`, `isSafeId`, `monitorCommand` |  |
| `src/cli/commands/reply.js` | `CLI_EXIT`, `REPLY_FIELD`, `REPLY_FILE`, `REPLY_STATUS`, `REPLY_STATUSES`, `SAFE_ID`, `isSafeId` |  |
| `src/cli/commands/review.js` | `CLIENT_CLI`, `CLI_EXIT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `HEADER`, `JSON_CONTENT_TYPE`, `PAGES`, `isSafeId`, `route`, `siteOrigin` |  |
| `src/cli/commands/serve.js` | `CLI_EXIT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `PAGES`, `SAFE_ID`, `isSafeId` |  |
| `src/cli/commands/session.js` | `AGENT_LIVENESS`, `CATALOG`, `CLI_EXIT`, `CONTRACT_VERDICT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `HEALTH_FIELD`, `SAFE_ID`, `helperContractVerdict`, `isSafeId` |  |
| `src/cli/commands/status.js` | `CATALOG_LEGACY_NOTE`, `CLIENT_CLI`, `CLI_EXIT`, `DEFAULT_HOST`, `HEADER`, `PAGES`, `SAFE_ID`, `isSafeId`, `route`, `stateDirFlag` | **breaks:** legacyPickupNote |
| `src/cli/commands/style.js` | `CLI_EXIT` |  |
| `src/cli/commands/write.js` | `CLI_EXIT` |  |
| `src/cli/index.js` | `CLI_EXIT`, `DEFAULT_PORT` |  |
| `src/layer/catalog/page.js` | `CATALOG`, `CATALOG_TOKEN_META`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route` |  |
| `src/layer/catalog/view_model.js` | `AGENT_LIVENESS`, `CATALOG`, `LOOPBACK_ORIGIN_HOSTS`, `PAGES`, `isSiteName` | **breaks:** handoffMessage |
| `src/layer/export.js` | `CLIENT_LAYER`, `DEFAULT_HELPER_ORIGIN`, `HEADER`, `route` |  |
| `src/layer/index.js` | `ALIAS_MAX`, `DEFAULT_HELPER_ORIGIN`, `DOCUMENT_ON`, `EVENT`, `FRAMES_ALLOW`, `NOTES_ON`, `SCRIPT_ATTR`, `SCRIPT_SELECTOR`, `START_HIDDEN`, `isPathAlias`, `isSpelling` |  |
| `src/layer/overlay.js` | `AGENT_LIVENESS` | **breaks:** handoffMessage; livenessOverdue |
| `src/layer/store.js` | `EVENT`, `EVENT_FIELD` |  |
| `src/layer/sync.js` | `AGENT_LIVENESS`, `CLIENT_LAYER`, `CONTRACT_VERDICT`, `DEFAULT_HELPER_ORIGIN`, `EVENT`, `EVENT_FIELD`, `FLUSH`, `HEADER`, `JSON_CONTENT_TYPE`, `SERVICE_CONTRACT`, `fitsKeepalive`, `helperContractVerdict`, `newEvent`, `route` |  |
| `src/layer/tab_done.js` | `EVENT`, `EVENT_FIELD`, `newEvent` |  |
| `src/service/addresses.js` | `siteOrigin` |  |
| `src/service/agent_sessions.js` | `AGENT_LIVENESS`, `CATALOG`, `CLI_EXIT`, `MONITOR`, `WAKE`, `drainCommand`, `isSafeId`, `monitorCommand`, `stateDirFlag` |  |
| `src/service/auth.js` | `AUTH`, `CHECK`, `CHECKS`, `CLIENT_CATALOG`, `CLIENT_CLI`, `HEADER`, `JSON_CONTENT_TYPE`, `PAGES`, `PROOF`, `checkRequest`, `hostAllowed`, `route`, `statusFor` |  |
| `src/service/catalog_actions.js` | `AGENT_LIVENESS`, `CATALOG`, `CATALOG_LOG`, `MONITOR`, `catalogLogLine`, `isSafeId`, `statusFor` |  |
| `src/service/catalog_launch.js` | `AGENT_LIVENESS`, `isSafeId` | **breaks:** handoffMessage |
| `src/service/catalog_page.js` | `CATALOG_TOKEN_META`, `route` |  |
| `src/service/catalog_reader.js` | `AGENT_LIVENESS`, `CATALOG`, `MONITOR`, `isSafeId` |  |
| `src/service/catalog_requests.js` | `AGENT_LIVENESS`, `CATALOG`, `isSafeId` |  |
| `src/service/catalog_sites.js` | `siteOrigin` |  |
| `src/service/catalog_store.js` | `isSafeId` |  |
| `src/service/heal.js` | `route`, `scriptTag` |  |
| `src/service/index.js` | `BASE`, `CATALOG`, `CHECK`, `DEFAULT_HOST`, `DEFAULT_PORT`, `HEADER`, `HOST_FAMILY`, `JSON_CONTENT_TYPE`, `PAGES`, `PROOF`, `classifyHost`, `errorBody`, `siteNameFromOrigin`, `statusFor` |  |
| `src/service/log.js` | `EVENT`, `EVENT_FIELD`, `EVENT_TYPES`, `IDEMPOTENCE_KEY`, `encodeEventLine`, `parseEventLine` |  |
| `src/service/page_routes.js` | `ALIAS_MAX`, `DEFAULT_HOST`, `DEFAULT_PORT`, `DOCUMENT_ON`, `PAGES`, `SCRIPT_ATTR`, `isLoopbackPortOrigin`, `isPathAlias`, `isSafeId`, `isSpellingOrigin`, `route`, `scriptTag`, `siteNameFromOrigin`, `siteOrigin` |  |
| `src/service/projection.js` | `EVENT`, `EVENT_FIELD`, `REPLY_POLL` |  |
| `src/service/replies.js` | `EVENT`, `REPLY_FIELD`, `agentFromFilename`, `isSafeId`, `newEvent`, `nextReadOffset`, `parseReplyLine`, `splitCompleteLines` |  |
| `src/service/reviews.js` | `API_VERSION`, `CLIENT_LAYER`, `DEFAULT_HOST`, `DEFAULT_PORT`, `EVENT`, `EVENT_FIELD`, `SERVICE_CONTRACT`, `isLoopbackPortOrigin`, `isSafeId`, `newEvent` |  |
| `src/service/routes.js` | `AGENT_LIVENESS`, `API_VERSION`, `CATALOG_ROUTES`, `EVENT`, `EVENT_FIELD`, `LOOPBACK_ORIGIN_HOSTS`, `ORIGIN_LIMIT`, `PAGES`, `ROUTES`, `SERVICE_CONTRACT`, `SITE_ROUTES`, `SUMMARY_ROUTES`, `SUMMARY_VERSION`, `acceptsNotesFlag`, `isRegisterableOrigin`, `isSafeId`, `newEvent`, `siteOrigin`, `statusFor` |  |
| `src/service/self_stop.js` | `CATALOG` |  |
| `src/service/sites.js` | `PAGES`, `isSafeId`, `isSiteLabel` |  |
| `src/service/state_dir.js` | `MONITOR`, `SAFE_ID`, `WAKE`, `agentFromFilename`, `isSafeId` |  |
| `src/service/static_servers.js` | `DEFAULT_HOST`, `isSafeId` |  |
| `src/service/summary.js` | `CATALOG`, `REPLY_FILE`, `SUMMARY_VERSION` |  |
| `src/service/wake_feed.js` | `WAKE`, `drainCommand` |  |

#### scripts (3)

| File | Reads | Change |
| --- | --- | --- |
| `scripts/compact_draft_history.js` | `EVENT`, `EVENT_FIELD`, `isSafeId`, `parseEventLine` |  |
| `scripts/measure_draft_write_cost.js` | `EVENT` |  |
| `scripts/measure_moved_lookup.js` | `EVENT`, `newEvent`, `route`, `siteOrigin` |  |

#### test/unit (105)

| File | Reads | Change |
| --- | --- | --- |
| `test/unit/add_command.test.js` | `CLI_EXIT`, `EVENT`, `SERVICE_CONTRACT`, `route`, `scriptTag` |  |
| `test/unit/addresses.test.js` | `PAGES` |  |
| `test/unit/adopt_old_records.test.js` | `EVENT`, `newEvent`, `route`, `siteOrigin`, `statusFor` |  |
| `test/unit/agent_liveness.test.js` | `AGENT_LIVENESS`, `CATALOG`, `EVENT`, `EVENT_FIELD`, `MONITOR`, `newEvent`, `route` |  |
| `test/unit/always_on.test.js` | `BASE`, `DEFAULT_HOST`, `SERVICE_CONTRACT` |  |
| `test/unit/batch_reply_own_answers.test.js` | `CLI_EXIT`, `EVENT`, `newEvent`, `parseReplyLine` |  |
| `test/unit/catalog_auth.test.js` | `CATALOG_TOKEN_META`, `CHECK`, `CLIENT_CATALOG`, `CLIENT_LAYER`, `HEADER`, `HEALTH_FIELD`, `JSON_CONTENT_TYPE`, `route` |  |
| `test/unit/catalog_kind_rule.test.js` | `isSafeId` |  |
| `test/unit/catalog_launch.test.js` | `CATALOG` |  |
| `test/unit/catalog_lifetime.test.js` | `CATALOG`, `CATALOG_PAGE_PATH`, `CATALOG_TOKEN_META`, `CLIENT_CATALOG`, `CLIENT_LAYER`, `CLI_EXIT`, `DEFAULT_HOST`, `DEFAULT_PORT`, `EVENT`, `HEADER`, `HEALTH_FIELD`, `JSON_CONTENT_TYPE`, `newEvent`, `route` |  |
| `test/unit/catalog_opens_script.test.js` | `CATALOG`, `CATALOG_LOG`, `catalogLogLine` |  |
| `test/unit/catalog_reader.test.js` | `CATALOG`, `EVENT`, `MONITOR`, `newEvent` |  |
| `test/unit/catalog_requests.test.js` | `CATALOG`, `MONITOR` |  |
| `test/unit/catalog_routes.test.js` | `CATALOG`, `CATALOG_PAGE_PATH`, `CATALOG_TOKEN_META`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `MONITOR`, `catalogLogLine`, `route` |  |
| `test/unit/catalog_view_model.test.js` | `AGENT_LIVENESS`, `CATALOG` | **breaks:** handoffMessage |
| `test/unit/choice_kernel.test.js` | `CLI_EXIT`, `DOCUMENT_ON`, `EVENT`, `SCRIPT_ATTR`, `newEvent`, `scriptTag` |  |
| `test/unit/choice_press_hold.test.js` | `EVENT`, `FLUSH` |  |
| `test/unit/cli_dispatch.test.js` | `CLI_EXIT` |  |
| `test/unit/codex_monitor.test.js` | `CLI_EXIT`, `EVENT`, `newEvent` |  |
| `test/unit/comments_follow_move.test.js` | `EVENT`, `newEvent`, `route`, `siteOrigin` |  |
| `test/unit/compact_draft_history.test.js` | `EVENT`, `encodeEventLine`, `newEvent` |  |
| `test/unit/done_tab_replies.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/draft_flush_cadence.test.js` | `EVENT`, `FLUSH` |  |
| `test/unit/each_page_comments.test.js` | `EVENT`, `newEvent`, `route`, `siteOrigin` |  |
| `test/unit/editing_surface.test.js` | `EVENT` |  |
| `test/unit/end_review.test.js` | `CLIENT_LAYER`, `EVENT`, `HEADER`, `JSON_CONTENT_TYPE`, `WAKE`, `newEvent`, `route` |  |
| `test/unit/fix_round_f3_service.test.js` | `EVENT`, `SUGGESTIONS_MAX`, `SUGGESTION_TEXT_MAX`, `parseReplyLine` |  |
| `test/unit/fix_round_f3_sync.test.js` | `NOTES_ON`, `SCRIPT_ATTR`, `SERVICE_CONTRACT`, `scriptTag` |  |
| `test/unit/framed_boot.test.js` | `FRAMES_ALLOW`, `SCRIPT_ATTR` |  |
| `test/unit/handoff_page_names.test.js` | `AGENT_LIVENESS`, `CLI_EXIT` | **breaks:** handoffMessage |
| `test/unit/heal_script_line.test.js` | `DEFAULT_HOST`, `DEFAULT_PORT`, `route`, `scriptTag` |  |
| `test/unit/held_release_clock.test.js` | `EVENT`, `EVENT_FIELD`, `newEvent` |  |
| `test/unit/helper_contract_cli.test.js` | `SERVICE_CONTRACT` |  |
| `test/unit/helper_not_replaced.test.js` | `DEFAULT_HOST` |  |
| `test/unit/helper_reads_only_the_tail.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/helper_self_stop.test.js` | `CLI_EXIT`, `DEFAULT_HOST` |  |
| `test/unit/holder_tie.test.js` | `EVENT`, `newEvent`, `siteOrigin` |  |
| `test/unit/hook_stop.test.js` | `monitorCommand` |  |
| `test/unit/install_command.test.js` | `CLI_EXIT`, `DEFAULT_HOST`, `PAGES` |  |
| `test/unit/launch_by_kind.test.js` | `statusFor` |  |
| `test/unit/launch_folder.test.js` | `isSafeId` |  |
| `test/unit/lean_agent_output.test.js` | `CLI_EXIT`, `EVENT`, `newEvent` |  |
| `test/unit/library_address.test.js` | `CATALOG_TOKEN_META`, `CHECK`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route` |  |
| `test/unit/library_command.test.js` | `CATALOG`, `CATALOG_PAGE_PATH`, `CLI_EXIT`, `DEFAULT_PORT`, `drainCommand`, `monitorCommand` |  |
| `test/unit/library_command_sites.test.js` | `CATALOG_PAGE_PATH`, `CLI_EXIT` |  |
| `test/unit/library_handoff.test.js` | `AGENT_LIVENESS`, `takeoverCommand` | **breaks:** handoffMessage |
| `test/unit/library_link_navigation.test.js` | `CATALOG_ROUTES`, `CATALOG_TOKEN_META`, `CHECK`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route` |  |
| `test/unit/library_open_sites.test.js` | `CATALOG_TOKEN_META`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route` |  |
| `test/unit/library_serve.test.js` | `CLI_EXIT`, `EVENT` |  |
| `test/unit/library_session_autoclose.test.js` | `CATALOG` |  |
| `test/unit/library_trusted_paths.test.js` | `CLI_EXIT` |  |
| `test/unit/linked_docs_mappers.test.js` | `siteOrigin` |  |
| `test/unit/log_caps_round2.test.js` |  |  |
| `test/unit/log_run.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/mark_done.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/menubar_cli.test.js` | `CLI_EXIT` |  |
| `test/unit/menubar_summary.test.js` | `CATALOG`, `EVENT`, `newEvent` |  |
| `test/unit/monitor_command.test.js` | `CLI_EXIT`, `EVENT`, `MONITOR`, `newEvent` |  |
| `test/unit/monitor_sessions.test.js` | `CLI_EXIT`, `MONITOR`, `drainCommand`, `monitorCommand` |  |
| `test/unit/no_stale_excuse.test.js` | `AGENT_LIVENESS`, `CLI_EXIT`, `EVENT`, `newEvent`, `parseReplyLine` |  |
| `test/unit/one_review_per_file.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/outbox_coalescing.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/page_routes_carried.test.js` | `scriptTag` |  |
| `test/unit/pages_port_choice.test.js` | `PAGES` |  |
| `test/unit/projection_incremental.test.js` | `EVENT`, `EVENT_FIELD`, `newEvent`, `parseEventLine` |  |
| `test/unit/projection_review_json.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/protocol_wire.test.js` | `AUTH`, `CHECK`, `CONTRACT_VERDICT`, `DEFAULT_HELPER_ORIGIN`, `DEFAULT_PORT`, `EVENT`, `EVENT_TYPES`, `FLUSH`, `HEADER`, `IDEMPOTENCE_KEY`, `REPLY_CURSOR_FIELD`, `REPLY_FIELD`, `REPLY_POLL`, `ROUTES`, `SCRIPT_ATTR`, `SCRIPT_FALLBACK_ONERROR`, `SCRIPT_SELECTOR`, `SERVICE_CONTRACT`, `acceptsNotesFlag`, `agentFromFilename`, `checkRequest`, `drainCommand`, `encodeEventLine`, `errorBody`, `fitsKeepalive`, `helperContractVerdict`, `monitorCommand`, `newEvent`, `nextReadOffset`, `parseEventLine`, `parseReplyLine`, `requiredHeaders`, `route`, `scriptTag`, `splitCompleteLines`, `statusFor` | **breaks:** requiredHeaders removed; FLUSH prose fields removed; route prose fields removed |
| `test/unit/quiet_tab_polling.test.js` | `route` |  |
| `test/unit/rebuild_not_the_agents_job.test.js` | `EVENT`, `EVENT_FIELD`, `newEvent` |  |
| `test/unit/remount_contract.test.js` | `DEFAULT_HELPER_ORIGIN`, `DOCUMENT_ON`, `SCRIPT_ATTR` |  |
| `test/unit/reopened_edit.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/reply_command.test.js` | `CLI_EXIT`, `EVENT`, `REPLY_FIELD`, `agentFromFilename`, `newEvent`, `parseReplyLine` |  |
| `test/unit/reply_folding.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/reply_proofread.test.js` | `CLI_EXIT`, `EVENT`, `newEvent`, `parseReplyLine` |  |
| `test/unit/reply_seen.test.js` | `CATALOG`, `EVENT`, `EVENT_TYPES`, `encodeEventLine`, `newEvent` |  |
| `test/unit/reply_toast.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/review_adopt.test.js` | `EVENT` |  |
| `test/unit/review_binds_used_review.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/review_command.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/review_follows_document.test.js` | `AGENT_LIVENESS`, `EVENT`, `newEvent`, `route`, `siteOrigin` |  |
| `test/unit/review_json_skip.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/review_retire.test.js` | `EVENT`, `newEvent`, `route`, `siteOrigin`, `statusFor` |  |
| `test/unit/review_write_hardening.test.js` | `ORIGIN_LIMIT` |  |
| `test/unit/reword_not_handled_floor.test.js` | `EVENT`, `FLUSH`, `newEvent` |  |
| `test/unit/run_refusal_real_route.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/service_helper.test.js` | `API_VERSION`, `CLIENT_LAYER`, `DEFAULT_HOST`, `EVENT`, `HEADER`, `JSON_CONTENT_TYPE`, `newEvent`, `route` |  |
| `test/unit/service_paths.test.js` | `EVENT`, `newEvent` |  |
| `test/unit/session_list.test.js` | `AGENT_LIVENESS`, `CLI_EXIT`, `EVENT`, `newEvent` |  |
| `test/unit/session_names.test.js` | `AGENT_LIVENESS`, `CLI_EXIT`, `EVENT`, `newEvent` |  |
| `test/unit/sites_binding.test.js` | `route` |  |
| `test/unit/sites_cli.test.js` | `EVENT`, `newEvent`, `route` |  |
| `test/unit/sites_dispatch.test.js` | `HOST_FAMILY`, `classifyHost`, `route` |  |
| `test/unit/sites_lahe_names.test.js` | `classifyHost`, `route`, `siteNameFromOrigin` |  |
| `test/unit/sites_mappers.test.js` | `scriptTag`, `siteOrigin` |  |
| `test/unit/status_catalog.test.js` | `AGENT_LIVENESS`, `CATALOG`, `CLI_EXIT` | **breaks:** handoffMessage |
| `test/unit/status_command.test.js` | `CLI_EXIT`, `EVENT`, `PAGES`, `newEvent` |  |
| `test/unit/stop_holds.test.js` | `DEFAULT_HOST` |  |
| `test/unit/style_command.test.js` | `CLI_EXIT` |  |
| `test/unit/summary_routes.test.js` | `CATALOG`, `CHECK`, `CLIENT_CATALOG`, `CLIENT_CLI`, `EVENT`, `HEADER`, `JSON_CONTENT_TYPE`, `SUMMARY_VERSION`, `newEvent`, `route` |  |
| `test/unit/sync_client.test.js` | `EVENT`, `FLUSH`, `IDEMPOTENCE_KEY`, `REPLY_CURSOR_FIELD`, `REPLY_POLL`, `route` | **breaks:** FLUSH prose fields removed |
| `test/unit/target_mtime.test.js` | `route` |  |
| `test/unit/unanswered_prominence.test.js` | `AGENT_LIVENESS` | **breaks:** handoffMessage; livenessOverdue |
| `test/unit/wake_feed.test.js` | `EVENT`, `WAKE`, `newEvent` |  |
| `test/unit/withdraw_from_ready_flush.test.js` | `FLUSH` |  |
| `test/unit/write_command.test.js` | `CLI_EXIT`, `NOTES_ON`, `SCRIPT_ATTR` |  |

#### test/browser (31)

| File | Reads | Change |
| --- | --- | --- |
| `test/browser/ac1_walk.spec.js` | `scriptTag` |  |
| `test/browser/auto_reload.spec.js` | `CLIENT_CLI`, `JSON_CONTENT_TYPE`, `SCRIPT_ATTR`, `route` |  |
| `test/browser/catalog_cross_site.spec.js` | `CATALOG_PAGE_PATH`, `CATALOG_TOKEN_META`, `CHECK`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route`, `statusFor` |  |
| `test/browser/catalog_library.spec.js` |  |  |
| `test/browser/catalog_page.spec.js` | `AGENT_LIVENESS`, `CATALOG_PAGE_PATH`, `CLIENT_CATALOG`, `HEADER`, `JSON_CONTENT_TYPE`, `route` | **breaks:** handoffMessage |
| `test/browser/change_highlight.spec.js` | `CLIENT_CLI`, `JSON_CONTENT_TYPE`, `SCRIPT_ATTR`, `route` |  |
| `test/browser/comments_follow_move.spec.js` | `EVENT`, `newEvent`, `siteOrigin` |  |
| `test/browser/duplicate_tab.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/each_page_comments.spec.js` | `EVENT`, `newEvent`, `siteOrigin` |  |
| `test/browser/file_origin.spec.js` | `BASE`, `CLIENT_LAYER`, `HEADER`, `JSON_CONTENT_TYPE` |  |
| `test/browser/harness_second_origin.spec.js` | `CHECK`, `CHECKS`, `EVENT`, `route`, `statusFor` |  |
| `test/browser/helper_contract_layer.spec.js` | `SERVICE_CONTRACT` |  |
| `test/browser/helper_restart_holds.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/install_walk_3b.spec.js` | `scriptTag` |  |
| `test/browser/markdown_pandoc.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/menubar_summary.spec.js` | `HEADER`, `SUMMARY_VERSION`, `route` |  |
| `test/browser/multi_page_review.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/probable_place.spec.js` | `CLIENT_CLI`, `JSON_CONTENT_TYPE`, `SCRIPT_ATTR`, `route` |  |
| `test/browser/quiet_tab_polling.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/r10_offline_fallback.spec.js` | `route`, `scriptTag` |  |
| `test/browser/reload_claim.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/reveal_deck.spec.js` | `CLIENT_CLI`, `JSON_CONTENT_TYPE`, `SCRIPT_ATTR`, `route` |  |
| `test/browser/review_follows_document.spec.js` | `EVENT`, `newEvent`, `siteOrigin` |  |
| `test/browser/stable_addresses_mappers.spec.js` | `EVENT`, `newEvent`, `route`, `scriptTag`, `siteOrigin` |  |
| `test/browser/static_site_folder.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/steady_reload.spec.js` | `CLIENT_CLI`, `JSON_CONTENT_TYPE`, `SCRIPT_ATTR`, `route` |  |
| `test/browser/support/catalog_world.js` | `DEFAULT_PORT` |  |
| `test/browser/support/refusing_helper.js` | `route` |  |
| `test/browser/support/with_layer.js` | `DOCUMENT_ON`, `SCRIPT_ATTR` |  |
| `test/browser/tmp_image_pick.spec.js` | `SCRIPT_ATTR` |  |
| `test/browser/window_goodbye.spec.js` | `SCRIPT_ATTR` |  |

#### test/other (7)

| File | Reads | Change |
| --- | --- | --- |
| `test/fixtures/app/server.js` | `scriptTag` |  |
| `test/fixtures/catalog_state.js` | `CATALOG` |  |
| `test/fixtures/catalog_state_build.js` | `CATALOG`, `DEFAULT_HOST`, `EVENT`, `MONITOR`, `newEvent` |  |
| `test/fixtures/menubar/state.js` | `EVENT`, `newEvent` |  |
| `test/fixtures/servers/protocol-service.js` | `API_VERSION`, `EVENT`, `HEADER`, `ROUTES`, `agentFromFilename`, `checkRequest`, `encodeEventLine`, `errorBody`, `isSafeId`, `parseEventLine`, `parseReplyLine`, `splitCompleteLines`, `statusFor` |  |
| `test/helpers/free_port.js` | `DEFAULT_PORT` |  |
| `test/helpers/helper_contract_preload.js` | `SERVICE_CONTRACT` |  |

## 4. Module design

### Rules every module follows

- **No Node and no DOM.** `src/contract` has `lib: es2024` and no `types`. So the old code's `URL`, `TextEncoder` and `Buffer` are not available. `isRegisterableOrigin` becomes one regular expression plus a port check (B10 lists the cases that prove it matches what `new URL(origin).origin` did), and `fitsKeepalive` counts UTF-8 bytes by code point (B51).
- **Tables are `as const` objects or tuples** with a union derived from them (`(typeof EVENT)[keyof typeof EVENT]`, `(typeof ROUTES)[number]["name"]`). No `enum`, no `namespace`, no parameter properties, named exports only, no top-level `await`.
- **Boundary functions take `unknown`.** Every function below whose first parameter is `unknown` is called by today's code with data from a request, a file, a tag attribute or a JSON line, and returns a typed result or a typed refusal without throwing (except where B lists a throw). Functions that take typed parameters are called with the helper's or the CLI's own values; they still keep the runtime checks B lists, because 192 JavaScript callers cannot be typed yet and because the script tag's values land inside an HTML attribute.
- **No casts.** Narrowing from `unknown` uses `typeof`, `Array.isArray`, `in`, `Object.hasOwn`, the `isJsonObject` guard below, and type predicates whose body is the check. A branded value is made only by its predicate.
- **Constants computed from other constants** (`BASE`, `DEFAULT_HELPER_ORIGIN`, `HEARTBEAT_FRESH_MS`) are computed, with an explicit type where `isolatedDeclarations` asks for one.

### Imports between modules

`json-object`, `safe-id`, `helper-address`, `headers` and `flush` import nothing. `service-contract` and `review-write` import `json-object`. `routes` imports `service-contract`. `site-addresses` imports `helper-address`. `request-checks` imports `routes`, `headers`, `helper-address`, `safe-id` and C1's `failures` (for the code type only). `error-body` imports `request-checks` (the check-name type) and C1's `failures`. `events` imports `safe-id` and `json-object`. `replies` imports `safe-id` and `json-object`. `script-tag` imports `safe-id` and `helper-address`. `agent-commands` imports `safe-id`. `agent-liveness` imports `agent-commands` and `safe-id`. `library` imports `events`. `protocol` imports all of them. There are no cycles.

### `json-object.ts`

```ts
export type JsonObject = Readonly<Record<string, unknown>>;
export function isJsonObject(value: unknown): value is JsonObject;
```

True for a non-null object that is not an array. Every parser below reads fields with `value["field"]` after this guard.

### `safe-id.ts`

```ts
declare const safeIdBrand: unique symbol;
export type SafeId = string & { readonly [safeIdBrand]: true };
export const SAFE_ID: RegExp;
export function isSafeId(value: unknown): value is SafeId;
```

`SafeId` is branded because a review id, a session id, an agent name and a request id are all plain strings that become path components or command arguments. One brand, not one per kind: they share one rule, and separate `ReviewId` and `SessionId` brands belong to the slices that model reviews and sessions (C3, SV3), which can build them on this predicate.

### `service-contract.ts`

```ts
export const API_VERSION: "v1";
export const SERVICE_CONTRACT: 17;
export const CONTRACT_VERDICT: { readonly CURRENT: "current"; readonly OLDER: "older"; readonly NEWER: "newer" };
export type ContractVerdict = (typeof CONTRACT_VERDICT)[keyof typeof CONTRACT_VERDICT];
export function helperContractVerdict(health: unknown): ContractVerdict;
```

`health` is a parsed `/health` answer from a running helper: a boundary.

### `helper-address.ts`

```ts
export const DEFAULT_PORT: 7817;
export const DEFAULT_HOST: "127.0.0.1";
export const DEFAULT_HELPER_ORIGIN: string;
export function hostAllowed(hostHeader: unknown): boolean;
```

The allowed host names are a module-private tuple. `ALLOWED_HOST_NAMES` is no longer exported.

### `review-write.ts`

```ts
export const LOOPBACK_ORIGIN_HOSTS: readonly ["localhost", "127.0.0.1", "[::1]"];
export const ORIGIN_LIMIT: 16;
export function isRegisterableOrigin(origin: unknown): boolean;
export function acceptsNotesFlag(body: unknown): boolean;
```

### `site-addresses.ts`

```ts
declare const siteNameBrand: unique symbol;
export type SiteName = string & { readonly [siteNameBrand]: true };
export const PAGES: { readonly PORT: 1483; /* ...every key of B12, as const */ };
export function isSiteLabel(value: unknown): boolean;
export function isSiteName(value: unknown): value is SiteName;
export const HOST_FAMILY: { readonly API: "api"; readonly LIBRARY: "library"; readonly PAGE: "page"; readonly BAD: "bad" };
export type HostClass =
  | { readonly family: "api" }
  | { readonly family: "library"; readonly name: "library" }
  | { readonly family: "page"; readonly name: SiteName }
  | { readonly family: "bad" };
export interface HostOptions { readonly pagesPort?: number; readonly laheNames?: boolean }
export function classifyHost(hostHeader: unknown, options?: HostOptions): HostClass;
export function siteOrigin(name: string, port: number): string;
export function siteNameFromOrigin(origin: unknown, pagesPort: number, laheNames?: boolean): SiteName | null;
```

`HostClass` is a union on `family`, so the server's dispatch can switch on it and the compiler refuses a missed family. The old label check's `xn--` and third-character tests are not carried: the label pattern already refuses every `--`, so they could never fire. One pattern for `<name>.lahe.localhost` and one for `<name>.lahe` serve both `classifyHost` and `siteNameFromOrigin`, instead of the four the old file spelled.

### `headers.ts`

```ts
export const HEADER: { readonly CLIENT: "x-lahe-client"; /* ...every key of B19 */ };
export const CLIENT_LAYER: "layer";
export const CLIENT_CLI: "cli";
export const CLIENT_CATALOG: "catalog";
export type ReviewClient = typeof CLIENT_LAYER | typeof CLIENT_CLI;
export const JSON_CONTENT_TYPE: "application/json";
export const PROOF: {
  readonly REQUEST_PREFIX: "lahe-proof-v1";
  readonly REPLY_PREFIX: "lahe-proof-reply-v1";
  readonly WINDOW_MS: number;
  readonly TS_PATTERN: RegExp;
  readonly NONCE_PATTERN: RegExp;
  readonly MAC_PATTERN: RegExp;
};
export const SUMMARY_VERSION: 1;
```

`CLIENTS` is no longer exported; `request-checks` holds the two review clients as a private tuple typed `readonly ReviewClient[]`.

### `routes.ts`

```ts
export const BASE: string;
export const AUTH: { readonly NONE: "none"; readonly REVIEW_TOKEN: "review_token"; readonly CATALOG_TOKEN: "catalog_token"; readonly CLI_SECRET: "cli_secret"; readonly CLI_PROOF: "cli_proof" };
export type Auth = (typeof AUTH)[keyof typeof AUTH];
export type HttpMethod = "GET" | "POST";

interface RouteFields {
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly mutating: boolean;
}
export interface ReviewRoute extends RouteFields { readonly auth: "none" | "review_token" }
export interface CatalogChecks {
  readonly sec_fetch_site: readonly ("none" | "same-origin")[];
  readonly top_level_navigation?: true;
  readonly token: boolean;
  readonly json_body: boolean;
  readonly origin: "exact" | null;
}
export interface CatalogRoute extends RouteFields { readonly auth: "catalog_token"; readonly prefix?: true; readonly checks: CatalogChecks }
export interface SiteRoute extends RouteFields { readonly auth: "cli_secret" }
export interface SummaryRoute extends RouteFields { readonly auth: "cli_proof"; readonly refuse_origin?: true }

export const ROUTES: readonly [/* the ten entries of B23, as const satisfies readonly ReviewRoute[] */];
export const CATALOG_ROUTES: readonly [/* B24 */];
export const SITE_ROUTES: readonly [/* B25 */];
export const SUMMARY_ROUTES: readonly [/* B25 */];

export type ReviewRouteName = (typeof ROUTES)[number]["name"];
export type CatalogRouteName = (typeof CATALOG_ROUTES)[number]["name"];
export type SiteRouteName = (typeof SITE_ROUTES)[number]["name"];
export type SummaryRouteName = (typeof SUMMARY_ROUTES)[number]["name"];
export type RouteName = ReviewRouteName | CatalogRouteName | SiteRouteName | SummaryRouteName;
export type AnyRoute = (typeof ROUTES | typeof CATALOG_ROUTES | typeof SITE_ROUTES | typeof SUMMARY_ROUTES)[number];

export function route<N extends RouteName>(name: N): Extract<AnyRoute, { readonly name: N }>;
export const CATALOG_PAGE_PATH: "/catalog";
export const CATALOG_TOKEN_META: "lahe-catalog-token";
export const HEALTH_FIELD: { readonly CATALOG_SEEN_AT: "catalog_seen_at" };
```

- The four lists stay four lists, in the same order, because `src/service/routes.js` binds a handler map to each and matches paths by walking them. `auth` is the discriminant, so the server's check dispatch (today three `if`s in `auth.js`) can become an exhaustive switch when SV3 converts it.
- The snake_case keys (`sec_fetch_site`, `top_level_navigation`, `json_body`, `refuse_origin`) stay: `auth.js` reads them by those names, and the lint allows snake_case object keys.
- `route` looks a name up across the four lists with `Array.prototype.find` and a type predicate, and throws B27's error for a name no list holds. A typed caller cannot pass an unknown name; the throw serves the JavaScript callers and the Library page.
- Route entries no longer carry `why`, `request` or `response`. No code read them; they were comments stored as strings. Their text moves to the folder doc (section 9), and three old test assertions on them are replaced (section 5).
- `CATALOG_API_BASE` is a private constant used to build the Library's paths. `requiredHeaders` is removed; B40 states its promise as behavior.

### `request-checks.ts`

```ts
export const CHECK: { readonly HOST: "host"; /* ...B29 */ };
export type CheckName = (typeof CHECK)[keyof typeof CHECK];
export const CHECKS: readonly [/* { name, code } x 9, as const, in B29's order */];
export type CheckCode = (typeof CHECKS)[number]["code"];

export type HeaderValue = string | readonly string[] | undefined;
export type RequestHeaders = Readonly<Record<string, HeaderValue>>;
export interface CheckInput {
  readonly routeName: ReviewRouteName;
  readonly headers: RequestHeaders;
  readonly review?: unknown;
}
export interface RegisteredReview { readonly token: string; readonly origins: readonly string[] }
export interface ReviewAuthConfig { readonly reviews: Readonly<Record<string, RegisteredReview>> }

export interface CheckRefusal {
  readonly ok: false;
  readonly check: CheckName;
  readonly code: CheckCode;
  readonly log: string;
}
export type CheckResult =
  | { readonly ok: true; readonly review: null; readonly origin: string | null }
  | { readonly ok: true; readonly review: SafeId; readonly origin: string }
  | CheckRefusal;

export function checkRequest(request: CheckInput, config: ReviewAuthConfig | null): CheckResult;
```

- The checks run as one ordered list of small pure checks, each returning a refusal or nothing, so adding a check is one entry and the order is visible in one place. The refusal builder is private; `checkNamed` is gone because `CHECKS` is now indexed through a private record keyed by `CheckName`.
- `review` is `unknown` because it comes from a query string or a body; B35 narrows it with `isSafeId`, so the passing result carries a `SafeId`.
- The token comparison stays constant time in plain code (no `node:crypto` in `contract`): it walks the longer length and folds every character difference, so timing does not reveal how much of a guess matched.
- A header value that is a list (Node gives one for a repeated header) is read as its comma-joined text, as `String()` did.

### `error-body.ts`

```ts
export function statusFor(code: string): number;
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly remedy: string | null;
    readonly detail: FailureDetail | null;
    readonly check: CheckName | null;
    readonly request_id: string | null;
  };
}
export function errorBody(code: FailureCode, detail?: FailureDetail | null, requestId?: string | null, check?: CheckName | null): ErrorBody;
```

`FailureCode` and `FailureDetail` are whatever C1's `failures.ts` exports for the code a `failure()` takes and the detail it stores; if C1 names them differently, use its names. `statusFor` keeps taking any string, because callers pass codes that arrive in other modules' results; the status table is a private `as const` record looked up with `Object.hasOwn`. `STATUS_FOR_CODE` is no longer exported.

### `events.ts`

```ts
export const EVENT: { readonly REVIEW_CREATED: "review.created"; /* ...B44 */ };
export type EventType = (typeof EVENT)[keyof typeof EVENT];
export const EVENT_TYPES: readonly EventType[];
export const EVENT_FIELD: { readonly EVENT: "event"; /* ...B45 */ };
export const IDEMPOTENCE_KEY: "event_id";

export interface NewEventInput {
  readonly event: EventType;
  readonly event_id: string;
  readonly review: SafeId;
  readonly ts?: string;
  readonly seq?: number | null;
  readonly item?: string | null;
  readonly rev?: number | null;
  readonly page_path?: string | null;
  readonly page_title?: string | null;
  readonly page_seq?: number | null;
  readonly source_hint?: string | null;
  readonly payload?: JsonObject;
}
export interface WireEvent {
  readonly event: EventType;
  readonly event_id: string;
  readonly ts: string;
  readonly seq: number | null;
  readonly review: SafeId;
  readonly item: string | null;
  readonly rev: number | null;
  readonly page_path: string | null;
  readonly page_title: string | null;
  readonly page_seq: number | null;
  readonly source_hint: string | null;
  readonly [payloadField: string]: unknown;
}
export interface LoggedEvent {
  readonly event: EventType;
  readonly event_id: string;
  readonly [field: string]: unknown;
}
export type EventLineParse = { readonly ok: true; readonly event: LoggedEvent } | { readonly ok: false; readonly reason: string };

export function newEvent(input: NewEventInput): WireEvent;
export function encodeEventLine(event: JsonObject): string;
export function parseEventLine(line: string): EventLineParse;
```

- `LoggedEvent` types only the two fields `parseEventLine` checks; every other field stays `unknown`. The old parser returned the object untouched while callers assumed `seq` and `review` were well formed; typing them without checking would be a lie, and checking them would make the parser stricter, which the architecture puts in its own fix. The readers that need `seq` (the log, the projection) narrow it when they convert.
- `newEvent` keeps its runtime checks (B47) for the JavaScript callers. Payload keys are copied as own data properties, so a payload key named `__proto__` becomes a plain field instead of changing the event's prototype.

### `flush.ts`

```ts
export const FLUSH: {
  readonly HELPER_DEBOUNCE_MS: 750;
  readonly DRAFT_FLOOR_MS: 10000;
  readonly RUN_DRAFT_FLOOR_MS: 30000;
  readonly PRESS_QUIET_MS: 3000;
  readonly PRESS_CAP_MS: 10000;
  readonly IMMEDIATE_ON: readonly ["blur", "hide", "ready", "navigation", "unload"];
  readonly KEEPALIVE_MAX_BYTES: number;
};
export type ImmediateFlushReason = (typeof FLUSH.IMMEDIATE_ON)[number];
export function fitsKeepalive(body: unknown): boolean;
```

`FLUSH` loses four prose fields that no code acted on: `TO_BROWSER_STORAGE`, `TRANSPORT_ON_UNLOAD`, `SEND_BEACON_IS_FORBIDDEN` and `OVERSIZE_FALLBACK`. Their rules move to the folder doc. `byteLength` becomes private.

### `replies.ts`

```ts
export const REPLY_FIELD: { readonly ITEM: "item"; /* ...B52 */ };
export const REPLY_STATUS: { readonly HANDLED: "handled"; readonly NOT_HANDLED: "not_handled"; readonly QUESTION: "question" };
export type ReplyStatus = (typeof REPLY_STATUS)[keyof typeof REPLY_STATUS];
export const REPLY_STATUSES: readonly ReplyStatus[];
export const SUGGESTIONS_MAX: 400;
export const SUGGESTION_TEXT_MAX: 200000;

export interface Suggestion { readonly block: number; readonly from: string; readonly to: string }
interface ReplyCommon {
  readonly item: string;
  readonly rev: number;
  readonly agent: string | null;
  readonly reason: string | null;
  readonly text: string | null;
  readonly files: readonly unknown[];
  readonly user_needs_to_see_reply: boolean;
}
type NoProofread = { readonly proofread?: never; readonly suggestions?: never };
type Proofread = { readonly proofread: true; readonly suggestions: readonly Suggestion[] };
export type Reply =
  | (ReplyCommon & NoProofread & { readonly status: "handled" })
  | (ReplyCommon & NoProofread & { readonly status: "not_handled"; readonly reason: string })
  | (ReplyCommon & (NoProofread | Proofread) & { readonly status: "question"; readonly text: string });

export type ReplyParse =
  | { readonly ok: true; readonly reply: Reply; readonly reason: null }
  | { readonly ok: false; readonly code: "REPLY_LINE_MALFORMED"; readonly reason: string };
export interface ReplyParseOptions { readonly filenameAgent?: string | null }
export function parseReplyLine(line: string, options?: ReplyParseOptions): ReplyParse;

export const REPLY_FILE: { readonly SINGLE: "replies.jsonl"; readonly PATTERN: RegExp; readonly prefix: "replies-"; readonly suffix: ".jsonl" };
export type ReplyFileAgent =
  | { readonly ok: true; readonly agent: SafeId | null; readonly reason: null }
  | { readonly ok: false; readonly agent: null; readonly reason: string };
export function agentFromFilename(filename: unknown): ReplyFileAgent;

export const REPLY_POLL: { readonly INTERVAL_MS: 5000 };
export const REPLY_CURSOR_FIELD: "seq";
export function nextReadOffset(recordedOffset: unknown, fileSize: number): { readonly offset: number; readonly refold: boolean };
export function splitCompleteLines(chunk: string): { readonly lines: readonly string[]; readonly remainder: string };
```

- `Reply` is a union on `status`. A `not_handled` reply always has a reason and a `question` always has text, and proofread fields exist only on a question and only together. Those are the states the old code's comments promised; the types now hold them.
- `files` stays `readonly unknown[]`: the old parser copied the list without checking its members, and checking them would make it stricter. The fold narrows it when SV4 converts it.
- The required-field table (`REPLY_REQUIRED`) becomes private. `REPLY_FILE.PATTERN` is built from the same character class as `SAFE_ID`, so the two cannot drift (B61 tests the parity).
- `REPLY_POLL` loses `RESET_ON_SHRINK` and `HOLD_TORN_FINAL_LINE`, which no code read; `nextReadOffset` and `splitCompleteLines` are those rules.
- `SUGGESTIONS_MAX` and `SUGGESTION_TEXT_MAX` restate record's run ceilings because `record.js` converts after this slice (C3). `fix_round_f3_service.test.js` keeps holding them equal. C3 should make one module import the other's numbers.

### `script-tag.ts`

```ts
export const SCRIPT_ATTR: { readonly REVIEW: "data-lahe-review"; /* ...B66 */ };
export const ALIAS_MAX: 16;
export const FRAMES_ALLOW: "allow";
export const START_HIDDEN: "hidden";
export const NOTES_ON: "true";
export const DOCUMENT_ON: "true";
export const SCRIPT_SELECTOR: string;
export const SCRIPT_FALLBACK_ONERROR: string;

export type LoopbackPortOrigin = `http://127.0.0.1:${number}` | `http://localhost:${number}`;
export type PathAlias = `/${string}`;
export type Spelling = `http://${string} /${string}`;
export function isLoopbackPortOrigin(value: unknown): value is LoopbackPortOrigin;
export function isPathAlias(value: unknown): value is PathAlias;
export function isSpellingOrigin(value: unknown): boolean;
export function isSpelling(value: unknown): value is Spelling;

export interface ScriptTagOptions {
  readonly src: string;
  readonly review: SafeId;
  readonly token: string;
  readonly helper?: string;
  readonly fallback?: string;
  readonly notes?: boolean;
  readonly document?: boolean;
  readonly aliases?: readonly LoopbackPortOrigin[];
  readonly pathAliases?: readonly PathAlias[];
  readonly spellings?: readonly Spelling[];
}
export function scriptTag(options: ScriptTagOptions): string;
```

- The three list attributes share one private writer: check it is a list of at most `ALIAS_MAX`, check each member with its predicate, then JSON with the four entities of B69. The old file had three copies, and two of them did not escape `<` and `>`; their predicates already refuse both, so the output is unchanged.
- The predicates are type guards to template literal types, so the layer, which reads these lists off a tag attribute, gets typed lists from its filter with no cast.
- `src`, `token`, `helper` and `fallback` are written as given, unescaped, as today. All four come from the CLI or the helper, never from a page.

### `agent-commands.ts`

```ts
export const CLI_EXIT: { readonly OK: 0; readonly HELPER_UNREACHABLE: 2; readonly UNKNOWN_REVIEW: 3; readonly BAD_USAGE: 4; readonly SESSION_CLOSED: 5; readonly SESSION_TAKEN_OVER: 6 };
export type CliExitCode = (typeof CLI_EXIT)[keyof typeof CLI_EXIT];
export const WAKE: { readonly FILE: "wake.log"; readonly KIND: { /* B75 */ }; readonly FIELD: { /* B75 */ } };
export type WakeKind = (typeof WAKE.KIND)[keyof typeof WAKE.KIND];
export function stateDirFlag(stateDir: string | null | undefined): string;
export function drainCommand(sessionId: string, stateDir?: string | null): string;
export function monitorCommand(
  sessions: string | readonly string[],
  stateDir?: string | null,
  handoffRevisions?: Readonly<Record<string, number>> | null
): string;
export function takeoverCommand(sessionId: string, stateDir?: string | null, requestId?: string | null): string;
```

Session ids are `string`, not `SafeId`: the hook and the skill tests print commands with a placeholder id (B78). `reviewCommand` is removed; nothing called it. `shellWord` stays private.

### `agent-liveness.ts`

```ts
export const MONITOR: { /* B80, with HEARTBEAT_FRESH_MS computed as INTERVAL_SECONDS * FRESH_INTERVALS * 1000 */ };
export const AGENT_LIVENESS: {
  readonly STATE: { /* B81 */ };
  readonly FIELD: { /* B81 */ };
  readonly PRESENCE: { /* B81 */ };
  readonly TEXT: { readonly working: string; readonly waiting: string; readonly no_agent: string };
  readonly CONNECTION: { readonly connected: string; readonly absent: string };
  readonly DETAIL: { /* B82 */ };
  readonly PROMINENT: { /* B82 */ };
  readonly QUIET_MS: 30000;
  readonly ACTIVE_MS: 600000;
  readonly STALE_MS: 600000;
  readonly RECENT_COMMAND_MS: 600000;
  readonly NO_AGENT_LOUD_MS: 120000;
};
export type LivenessState = (typeof AGENT_LIVENESS.STATE)[keyof typeof AGENT_LIVENESS.STATE];
export type Presence = (typeof AGENT_LIVENESS.PRESENCE)[keyof typeof AGENT_LIVENESS.PRESENCE];
export function livenessOverdue(state: unknown, waitedMs: unknown): boolean;

export type Handoff =
  | {
      readonly from: "rail";
      readonly sessionId: string | null;
      readonly name: string | null;
      readonly stateDirFlagNeeded: boolean;
    }
  | {
      readonly from: "library";
      readonly sessionId: string | null;
      readonly name: string | null;
      readonly stateDir: string | null;
      readonly request: string | null;
    };
export function handoffMessage(handoff: Handoff): string;
```

- `AGENT_LIVENESS` is data only. The old file hung `overdue` and `handoffMessage` on it as properties after building it; they are now top-level functions.
- `livenessOverdue` takes `unknown` because the rail calls it with the state straight off the helper's answer.
- `Handoff` is a union on `from`. The old signature took four positional arguments, one of which (`stateDirFlagNeeded`) the Library case ignored and two of which (`stateDir`, `request`) the rail case never had. Now each case carries only what it uses.
- `MONITOR.ACTIVITY_FRESH_MS` (three minutes) is removed: nothing read it, and its value contradicts the ten minutes `ACTIVE_MS` settled on.

### `library.ts`

```ts
export const CATALOG: { /* B87, with NOT_WORK_EVENTS built from EVENT */ };
export function legacyPickupNote(reviewId: string): string;
export const CATALOG_LOG: {
  readonly PREFIX: "catalog";
  readonly ACTION: { readonly OPEN: "open"; readonly STAR: "star"; readonly UNSTAR: "unstar"; readonly PICKUP: "pickup"; readonly LAUNCH: "launch" };
  readonly FORMAT: string;
};
export type CatalogLogAction = (typeof CATALOG_LOG.ACTION)[keyof typeof CATALOG_LOG.ACTION];
export function catalogLogLine(action: CatalogLogAction, reviewId: string, ageDays: number): string;
```

`CATALOG_LOG` is written with `PREFIX` as its first key and `ACTION` holding `OPEN: "open"` literally, and `CATALOG` holds `DEFAULT_VIEW_DAYS: 7` literally, because `scripts/catalog_opens.py` reads those three spellings from this file's text (section 8).

### `protocol.ts`

```ts
export * from "./json-object.ts";
export * from "./safe-id.ts";
/* ...one line per module above */
```

It exists for two readers only: the forwarder at `src/shared/protocol.js`, and S0c's generated registration that puts `LAHE.protocol` on the page for the unconverted layer and Library files. New `.ts` code imports the module it needs, never this one. F1 rewrites every import to the specific module and removes it.

### Exported names that change

| Old | New | Why | What each caller changes |
| --- | --- | --- | --- |
| `AGENT_LIVENESS.overdue(state, ms)` | `livenessOverdue(state, ms)` | A function is not table data | `src/layer/overlay.js:281` reads `protocol.livenessOverdue`; `unanswered_prominence.test.js` the same |
| `AGENT_LIVENESS.handoffMessage(id, name, flagNeeded, options)` | `handoffMessage({from, ...})` | One argument per case; no ignored flag | `overlay.js:5531` passes `{from: "rail", sessionId, name, stateDirFlagNeeded}`; `src/service/catalog_launch.js:183` and `src/layer/catalog/view_model.js:484` pass `{from: "library", sessionId, name, stateDir, request}` (`request: null` in the view model); the tests listed as "breaks" in section 3 the same |
| `CATALOG_LEGACY_NOTE(id)` | `legacyPickupNote(id)` | A function named like a constant, and lint wants camelCase | `src/cli/commands/library.js:413`, `src/cli/commands/status.js:972` |
| `requiredHeaders`, `checkNamed`, `reviewCommand` | removed | No reader, or a test-only reader whose promise B40 states | `protocol_wire.test.js` only |
| `ALLOWED_HOST_NAMES`, `CLIENTS`, `CATALOG_API_BASE`, `STATUS_FOR_CODE`, `REPLY_REQUIRED`, `byteLength` | private | No reader outside the module | none |
| route entries' `why`, `request`, `response`; `CHECKS[].why` | removed | Comments stored as strings | `protocol_wire.test.js` only |
| `FLUSH.TO_BROWSER_STORAGE`, `TRANSPORT_ON_UNLOAD`, `SEND_BEACON_IS_FORBIDDEN`, `OVERSIZE_FALLBACK`; `REPLY_POLL.RESET_ON_SHRINK`, `HOLD_TORN_FINAL_LINE`; `MONITOR.ACTIVITY_FRESH_MS` | removed | No code acted on them | `protocol_wire.test.js`; one assertion in `sync_client.test.js:433` |

Every other name keeps its spelling and its value.

## 5. Old tests, accounted for

The rule for cases outside `protocol_wire.test.js`, following S0b: a case **moves** to the new contract tests when every assertion in it is on a C4 export called with literal input, and it is removed from its old file in the same commit. A case that also drives another module **stays**, edited only where it calls a renamed export. "B" names the statement the new tests check.

### `test/unit/protocol_wire.test.js` (41 cases; the file moves to `test/unit/contract/request-checks.test.ts`)

| Old case | Disposition | Behavior |
| --- | --- | --- |
| the event type vocabulary is closed and complete | carried, to `events.test.ts` | B44 |
| idempotence is by event_id, never by item and rev | carried | B45, B46 |
| an event line is one line, whatever the page's text does | carried | B48 |
| an event without an event_id or with an unknown type is refused | carried | B47, B49 |
| the flush policy is pinned, and sendBeacon is forbidden | carried for the numbers; the three prose fields are dropped (D5) | B50 |
| an oversize unload body is a delay, not a loss | carried for `fitsKeepalive`; the `OVERSIZE_FALLBACK` wording is dropped (D5) | B51 |
| each status requires its own fields | carried, to `replies.test.ts` | B55, B56, B57 |
| user_needs_to_see_reply is optional, boolean, and lenient about anything else | carried | B57 |
| a malformed line is skipped with a reason, never thrown | carried; its two `failures.describe` assertions belong to C1 and are carried only if C1's spec has not mapped them (section 10) | B53, B54 |
| the line's agent beats the filename's agent | carried | B58 |
| the agent segment of a reply filename is a path component and is filtered | carried | B61, B62 |
| the reply poll tracks a byte offset, resets on truncation, and holds a torn line | carried | B63, B64, B65 |
| the library's reply cursor is a seq, not a timestamp | carried for `REPLY_CURSOR_FIELD`; the assertion on `route("replies.poll").request` is dropped (D5) | B63 |
| health carries the service contract that fences a rebuilt rail from a stale helper | carried for the integer; the assertion on `route("health").response` is dropped (D5). The server's health answer is pinned by the server's own tests | B3 |
| the current service contract says, in protocol.js, why an older helper must be replaced | rewritten to read `docs/ongoing/code/contract.md` (section 8) | B6 |
| a helper from before the Library is replaced: the Library's routes raised the service contract past 13 | dropped: implied by B3's exact value and B5's verdicts for 13 to 16 | B3, B5 |
| a well-formed request from a registered origin passes every check | carried | B38 |
| every refusal names the check that failed | carried | B30 to B37 |
| the read routes are checked exactly like the write route | carried | B33, B36, B37, B40 |
| absent configuration fails closed | carried | B35 |
| the origin is read from the header, never from the body | carried | B37 |
| a file page's null origin passes only when the review registered it | carried | B37 |
| only health and the library route need no credential, and every other route does | carried; the `requiredHeaders` half becomes refusals through `checkRequest` | B23, B32, B40 |
| the error body carries the code, the remedy, and the failed check | carried, to `error-body.test.ts` | B42, B43 |
| the script tag has the pinned attributes and the fixed default port | carried, to `script-tag.test.ts` | B7, B66, B68 |
| the script tag carries the offline fallback when one is named | carried, byte for byte | B67, B68 |
| the script tag refuses to be written without a token or with an unsafe review id | carried | B70 |
| the new failure codes exist and the pruned ones are gone | not C4's: a test of `failures.js`. Carried by C1 if C1's spec maps it, else moved verbatim to C1's failures test (section 10) | none here |
| an old spelling resolves to its canonical code and keeps its own name | the same | none here |
| telling a CSP refusal from a helper that is down is two codes, not one | the same | none here |
| the drain and monitor commands carry a state directory, quoted when the path needs it | carried, to `agent-commands.test.ts` | B76, B77, B78 |
| the service contract is 17: an old helper cannot retire a review, and one before 16 serves no pages itself | carried | B3 |
| the version check refuses a helper on contract 16 and accepts 17 | carried | B5 |
| run records get a longer draft floor, and other drafts keep 10 seconds | carried | B50 |
| a review write may mark the review as notes, and only as true | carried for `acceptsNotesFlag`; the assertion on `route("review.write").request` is dropped (D5) | B11 |
| the reply field names include proofread and suggestions | carried | B52 |
| the reply parser accepts a proofread question with suggestions | carried | B59 |
| an ordinary reply carries no proofread keys | carried | B57, B59 |
| the reply parser refuses suggestions on a handled reply | carried | B59 |
| the reply parser refuses suggestions of the wrong shape | carried | B59 |
| proofread must be the literal true | carried | B59 |

### Cases in other files that move

| File | Old case | Behavior |
| --- | --- | --- |
| `library_handoff.test.js` | the Library's message takes a session over with the real --state-dir, and blames nobody | B79, B85, B86 |
| `library_handoff.test.js` | with the default state dir the command has no --state-dir, and a human name is quoted | B85 |
| `library_handoff.test.js` | with no session to take, it points at the session list in the right state dir | B85 |
| `library_handoff.test.js` | the rail keeps its own opener for its own case | B85 |
| `library_handoff.test.js` | there is one hand-off builder: the Library's message is the rail's with only the opener changed | B86. Its `libraryHandoffMessage === undefined` assertion becomes B91's check that the old property names are gone |
| `library_handoff.test.js` | the rail's --state-dir question is not added in the Library form, which writes the folder instead | B85, B86 |
| `unanswered_prominence.test.js` | no agent listening: the line speaks at the quiet limit but is not loud yet | B84 |
| `unanswered_prominence.test.js` | an agent listening with nothing back: overdue after the stale limit, and not before | B84 |
| `unanswered_prominence.test.js` | an agent that is working is never overdue, however long the queue behind it | B84 |
| `unanswered_prominence.test.js` | nothing waiting, an unknown state, or no wait at all is never overdue | B84 |
| `unanswered_prominence.test.js` | the reviewer's words carry no tool jargon | B82 |
| `unanswered_prominence.test.js` | the handoff message names the session and the takeover command, in plain text | B85 |
| `unanswered_prominence.test.js` | with the state outside the default folder, the message says so without naming a path | B85, B86 |
| `unanswered_prominence.test.js` | a review with no agent session still gets a message that works | B85, B86 |
| `unanswered_prominence.test.js` | the handoff message names the session being taken over, quoted | B85 |
| `sites_lahe_names.test.js` | a .lahe Host is a page only once the .lahe check has passed | B16 |
| `sites_lahe_names.test.js` | library.lahe is never accepted, checked or not | B16 |
| `sites_lahe_names.test.js` | a port-free .lahe.localhost origin is the forward, and always names its site | B18 |
| `sites_lahe_names.test.js` | a .lahe origin names its site only once the .lahe check has passed | B18 |
| `sites_dispatch.test.js` | V8: a page Host with no port is accepted by the grammar | B16 |
| `sites_dispatch.test.js` | library.lahe.localhost at a port that is not the pages port is a bad Host, not the Library | B15, B16 |
| `fix_round_f3_service.test.js` | a reply line with too many suggestions is refused | B59, B60 |
| `no_stale_excuse.test.js` | a hand-appended refusal with a blank reason is rejected by the fold, not shown as an empty refusal | B56 |
| `monitor_sessions.test.js` | protocol.monitorCommand spells a relaunch for several sessions | B78 |
| `fix_round_f3_sync.test.js` | the script tag carries the notes attribute only for a notes review | B68 |
| `sites_mappers.test.js` | V70: the script tag carries the aliases as escaped JSON, and only when there are some | B68, B69, B70 |
| `agent_liveness.test.js` | the working window is two minutes, spelled once in CATALOG | B87 |

### Cases in other files that stay, edited for a renamed export

| File | Old case | Edit | Behavior relied on |
| --- | --- | --- | --- |
| `library_handoff.test.js` | the drain's handoff is the Library's message, with the drained state dir | `handoffMessage({from: "library", ...})` | B85 |
| `library_handoff.test.js` | catalog.list carries the state dir only when it is not the default, and the panel uses it | the file's `libraryHandoff` helper calls the new form | B85 |
| `unanswered_prominence.test.js` | the footer's loud line is the same rule, not a second one | `protocol.livenessOverdue` | B84 |
| `handoff_page_names.test.js` | a page-derived session name never appears in the drain's handoff | new call form | B85 |
| `handoff_page_names.test.js` | the Library's list marks a page-sourced name, and VM.handoffFor leaves it out | new call form | B85 |
| `status_catalog.test.js` | a pending request for the drained session gets past --quiet with nothing else ready | new call form | B85 |
| `status_catalog.test.js` | the drain names the document with the reader's display name, its path, and its session's hand-off message | new call form | B85 |
| `catalog_view_model.test.js` | with no agent, Pick this up and Launch show the hand-off panel instead of asking | new call form | B85 |
| `sync_client.test.js` | the flush policy is imported, not restated | its `SEND_BEACON_IS_FORBIDDEN` assertion is removed (D5); the rest stays | B50, B63 |
| `test/browser/catalog_page.spec.js` | with no agent attached, Pick this up and Launch show the hand-off message | new call form | B85 |

### Cases in other files that stay unchanged

These use a protocol export as an oracle while testing another module. They reach the new modules through the forwarder.

| File | Old case | Behavior relied on |
| --- | --- | --- |
| `adopt_old_records.test.js` | records.read takes the same token and Origin checks as every review route | B42 |
| `agent_liveness.test.js` | a footprint four minutes old is still an agent at work | B83 |
| `agent_liveness.test.js` | the heartbeat window is three of the monitor's own loops, and the rev still fences it | B80 |
| `batch_reply_own_answers.test.js` | a good batch of three writes three lines and prints three result lines, in order | B57 |
| `catalog_kind_rule.test.js` | the drain carries a dev-server row's origin, so the refusal can name it | B1 |
| `catalog_opens_script.test.js` | with --tz UTC, the summary prints Opens per working day and the older-than-7-days count | B87, B90 |
| `catalog_opens_script.test.js` | lines that are not catalog Opens are ignored, including a Library error line and a torn last line | B89, B90 |
| `catalog_routes.test.js` | Open, Star, Pick up and Launch through the real routes each write one catalog log line in the protocol.js format | B89 |
| `choice_kernel.test.js` | scriptTag writes data-lahe-document only when asked, and add's tag finder still matches it | B66, B68 |
| `each_page_comments.test.js` | a top-level load of a link address to a file with its own review and address is redirected there | B17 |
| `each_page_comments.test.js` | the redirect target comes from the registry, never from the request | B17 |
| `fix_round_f3_service.test.js` | a reply line whose from or to is over the run's byte ceiling is refused | B59, B60 |
| `fix_round_f3_service.test.js` | the suggestion bounds restate the run ceilings | B60 |
| `hook_stop.test.js` | the block reason is exactly the text the docs show | B78 |
| `hook_stop.test.js` | every step the block reason states is stated the same way in the skill | B78 |
| `launch_by_kind.test.js` | PROTO_NO_LAUNCH is a known failure with a remedy the page can show | B42 |
| `launch_folder.test.js` | every copy of the Launch steps cds into the folder, read from a file, quoted by AppleScript | B1 |
| `library_command.test.js` | lahe library with nobody attached mints a session with no reviews, attaches it, and prints its commands | B77, B78 |
| `monitor_sessions.test.js` | work in either session exits 0, with the drain for that session and a relaunch naming both | B77 |
| `monitor_sessions.test.js` | a takeover of either session fences it: its work captured in that poll is never delivered | B77 |
| `no_stale_excuse.test.js` | question with only a --reason is refused, because the fold needs text | B56, B74 |
| `reply_command.test.js` | a text with paragraph breaks and quotes is ONE physical line the fold can read | B57 |
| `reply_command.test.js` | the file is replies.jsonl alone and replies-<agent>.jsonl with --agent | B62 |
| `reply_proofread.test.js` | --proofread and --suggest write a question line with proofread and suggestions, which the parser accepts | B59 |
| `reply_seen.test.js` | V3: the rail and the helper call one unread rule, and it lives in record.js | B44 |
| `review_retire.test.js` | retire refuses another session's review, and needs the CLI secret | B42 |
| `review_retire.test.js` | a retired review no longer answers on its page, fails the Origin check, and takes no events | B42 |
| `session_names.test.js` | the name reaches the page in the liveness answer, next to the session id | B81 |
| `sync_client.test.js` | every event carries its own id, because idempotence is by event_id | B45 |

**Totals** (counted by `c4_fill.py` from the tables above). Old cases accounted for: 41 in `protocol_wire.test.js`, 27 moved from other files, 10 edited in place and 29 unchanged in place, so 107 in all. Of the 41: 36 carried (five of them with one prose assertion dropped under D5), 1 rewritten as a doc check, 1 dropped as implied (the "past 13" case), and 3 handed to C1 as failure-table tests. None is dropped silently.

**New cases with no old counterpart:** B1's long and leading-dot ids; B5's non-integer and non-object health; B8 and B10 in full (the regex rewrite needs every case `URL` used to decide); B13, B14 and B17; B21's patterns; B23 to B28 compared as whole tables; B31's missing-Host detail; B34's media-type forms; B35's inherited-property ids; B36's prefix token; B39; B41; B42 in full; B46's payload collisions; B49's array and non-object lines; B51's multi-byte cases; B54; B56's single-listed missing field and non-string reason (D6, D7); B60's boundaries; B65's edge cases; B69 to B73; B74, B75, B79; B80 to B83 as whole tables; B87 to B89; B91 and B92.

## 6. Deliberate differences

Each has its own test. "Noticed" marks one an agent or a person could see; those go on the progress page as departures. D6 and D7 are behavior fixes, so each is its own commit in the slice, so either can be reverted alone.

| # | Difference | Reason | Test | Noticed |
| --- | --- | --- | --- | --- |
| D1 | `handoffMessage` takes one object with `from: "rail"` or `from: "library"` instead of four positional arguments, and is a top-level export | The old form had an argument one case ignored and an options bag the other case never had | B85, B86, with both forms; B91 checks the old property is gone | no: the text is unchanged |
| D2 | `livenessOverdue` is a top-level export; `AGENT_LIVENESS` holds data only | Functions were attached to a constant table after it was built | B84; B91 | no |
| D3 | `CATALOG_LEGACY_NOTE` is `legacyPickupNote` | A function named like a constant | B88 | no |
| D4 | Nine exports go. Six with no outside reader become private (`ALLOWED_HOST_NAMES`, `CLIENTS`, `CATALOG_API_BASE`, `STATUS_FOR_CODE`, `REPLY_REQUIRED`, `byteLength`); `checkNamed`, `reviewCommand` and `requiredHeaders` are deleted | Dead surface; `requiredHeaders` was a test-only restatement of the checks | B40 replaces `requiredHeaders`; B91 lists the surface | no |
| D5 | Route entries lose `why`, `request` and `response`; `CHECKS` entries lose `why`; `FLUSH` loses four prose fields; `REPLY_POLL` loses two; `MONITOR.ACTIVITY_FRESH_MS` goes | Comments stored as strings, read by no code. The text moves to the folder doc. `ACTIVITY_FRESH_MS` also contradicted `ACTIVE_MS` | B23 to B25 and B50 compare whole tables, so the fields are absent | no |
| D6 | A required `reason` (on `not_handled`) or `text` (on `question`) must be a string. A line with `"reason": 5` used to fold as a refusal with no reason on the reviewer's card; it is now a malformed-line chip | The rule's own purpose was to stop a refusal with nothing in it; a non-string slipped through and was then dropped to `null`. The `Reply` type demands a string | B56: `{"item":"c_1","rev":1,"status":"not_handled","reason":5}` is refused, naming `reason` | **yes**: an agent that hand-writes a non-string reason gets a malformed-line chip instead of a blank refusal |
| D7 | The missing-field list names each field once. A line with no `item` said `missing or wrong type: item, item` | The old code checked `item` twice and listed both failures | B56: a line with no `item` gives `missing or wrong type: item` | **yes**, in the chip's wording |
| D8 | `parseEventLine` refuses a JSON array with `not an object` instead of `unknown event type undefined` | An array is not an object; the old reason was misleading | B49 | no: the reason reaches only the helper log |
| D9 | `checkRequest` throws for a route name outside `ROUTES` instead of running the review checks on a Library, site or summary route | Those routes have other credentials; running review checks on them was never right, and no caller does it | B41 | no |
| D10 | `nextReadOffset` throws for a size of `NaN` or `Infinity` too, not only for a negative size | A file size is always finite; the old check let `NaN` through | B64 | no |
| D11 | The unknown-route error names `src/contract/routes.ts` | The table moved | B27 | no: a developer's error |
| D12 | The Library page's bundle includes the failure table | `error-body.ts` imports it statically. The old raw page loaded `protocol.js` without `failures.js`, so `errorBody` would have thrown there; the page never calls it | B92 | no |

## 7. Fixed behavior tests touched

These must pass unchanged in what they assert. The rename edits in section 5 change how a test calls a function, never what it asserts.

- **Skill-wording tests** (`test/support/skill.js` users) that run code through this slice: `add_command.test.js` (the script tag `lahe add` writes and prints, exit codes), `status_command.test.js` (drain output, `printed_ending_reason`, hand-off messages, exit codes), `reply_command.test.js` (the reply line the fold must read), `no_stale_excuse.test.js` (blank reason and text, exit codes), `mark_done.test.js` and `session_fixes.test.js` (CLI runs). `stable_addresses_docs.test.js` and `review_format.test.js` are skill-wording tests that do not reach this slice's code, so they only have to keep passing. `hook_stop.test.js` is a skill-wording test too, by its own reading of the skill: its monitor command must keep matching the skill text (B78).
- **`review_format.test.js` and `export_text.test.js`** do not import the protocol, but the projection and the export run through modules that do (`projection.js` reads `EVENT` and `EVENT_FIELD`; the layer's `export.js` reads `route` and `HEADER`). They must pass unchanged.
- **CLI output tests:** `add_command`, `status_command`, `status_catalog`, `monitor_command`, `monitor_sessions`, `session_commands`, `session_names`, `library_command`, `library_command_sites`, `review_command`, `write_command`, `install_command`, `style_command`, `cli_dispatch`, `menubar_cli`, `sites_cli`, `codex_monitor`, `lean_agent_output`, `helper_contract_cli` (the older and newer helper verdicts, with `test/helpers/helper_contract_preload.js` reading `SERVICE_CONTRACT`).
- **Browser specs** run at the checkpoint, not by the builder. The 31 that import the protocol are listed in section 3. The ones that exercise this slice most directly: `r10_offline_fallback`, `install_walk_3b`, `ac1_walk` (the script tag and its fallback), `catalog_page`, `catalog_cross_site`, `catalog_library` (Library routes, headers and the hand-off message), `harness_second_origin` (`CHECKS`, `statusFor`), `file_origin` (the `null` origin), `helper_contract_layer` (the contract fence), `menubar_summary` (the proof headers), `stable_addresses_mappers`, `each_page_comments`, `review_follows_document`, `comments_follow_move` (`newEvent`, `siteOrigin`), and `rail_agent_liveness` and `stable_addresses_sites`, which read the liveness words on the rail. The builder may run one named spec when a change is browser-only; none of this slice's is.

## 8. Source-text tests

| Test | Reads today | Change |
| --- | --- | --- |
| `test/unit/protocol_wire.test.js:184-190` | `src/shared/protocol.js`, for a `// <SERVICE_CONTRACT>: ` comment line | Becomes a case in `test/unit/contract/service-contract.test.ts` that reads `docs/ongoing/code/contract.md` and requires a line matching `^\| <SERVICE_CONTRACT> \| \S` (B6). The comment history becomes that table (section 9). A bump with no row fails the gate |
| `scripts/catalog_opens.py:46,56-68`, run by `test/unit/catalog_opens_script.test.js` | `src/shared/protocol.js`, by regex, for `CATALOG_LOG = { PREFIX: "..."`, `ACTION: {... OPEN: "..."` and `DEFAULT_VIEW_DAYS: <n>` | Not in the plan's table; found by this scan. After the move the forwarder holds none of these, so the script would exit 2 and its test would fail. Change `PROTOCOL` in the script to `src/contract/library.ts` and its failure message to name that file. `library.ts` keeps the three spellings literal (section 4), and its folder doc section says why |
| `test/unit/catalog_auth.test.js:458,478,483` | the Library page's asset list, which names `protocol.js` | S0c owns this: it replaces the raw assets with `dist/lahe-library.js`. Nothing for C4 |
| `test/unit/sync_client.test.js:430-437` | not source text, but restated prose constants | One assertion removed (D5) |

No other test reads `protocol.js`'s text. The manifest still names the file (as a forwarder), so the manifest tests are unaffected.

## 9. Comments to move

Drafted as the sections this slice adds to `docs/ongoing/code/contract.md`, one per new module. The builder copies them, then corrects any detail the build changed. They hold the why and the traps; the `read-when` header of each `.ts` file does the routing.

> ### `json-object.ts`: narrowing parsed JSON
>
> The parsers in this folder take `unknown` and read fields only after `isJsonObject` has said the value is a plain object. An array is not one, even though `typeof` says `"object"`.
>
> ### `safe-id.ts`: ids that become path components
>
> Review ids, agent names, session ids and Library request ids all end up in a file path or a command line, so they share one rule. The first character is a letter or digit, which rules out `.` and `..`, hidden files, and an id that looks like a flag. Sixty-four characters is enough for every id Lahe mints. `replies-<agent>.jsonl` uses the same character class, built from this pattern so the two cannot drift.
>
> ### `service-contract.ts`: the contract number
>
> `API_VERSION` names the URL scheme and can stay `v1` while the helper's behavior moves on. The helper is long-running and shared: it keeps its modules in memory while it serves a freshly rebuilt browser bundle from disk, so a new rail can end up talking to yesterday's helper. `SERVICE_CONTRACT` is an integer bumped whenever a helper that old cannot safely back a newly built CLI or layer. The CLI and the layer read it from `/health`: an older helper is restarted; a newer one means this clone is behind, and it must not bounce a newer shared helper backward. A helper that reports no number is older.
>
> This is not the source-stamp check (`source_stamp.js`), which restarts a helper whose loaded files changed on disk. The contract number is what catches a different clone, or a helper started before a protocol change.
>
> **When you bump it,** add a row below in the same commit. `test/unit/contract/service-contract.test.ts` fails if the current number has no row.
>
> | Contract | What a helper below it lacks |
> | --- | --- |
> | 9 | `reply.at`, so it cannot back the timestamped rail. |
> | 10 | Wake-feed lines and `agent_liveness`, so a tail-armed agent would sleep through work and the rail could not tell whether an agent is watching. |
> | 11 | `user_needs_to_see_reply` in the reply fold, so a flagged reply would lose its flag and never badge the reviewer. |
> | 12 | Rendering on request: its static servers hand back raw Markdown from a source mount, so a document's links to other local documents download or 404. |
> | 13 | A window-session table on disk: it keeps it in memory, so replacing the helper throws every open page out of its review, and it leaves no `windows.json` for a CLI command to ask whether anybody is reviewing. |
> | 14 | The block allowlist and the size ceiling on free-writing run records, and `new_blocks` in the projection, so an agent would never see the reviewer's new text. |
> | 15 | The Library routes (`/catalog` and its API), the replay of `origin.removed`, the reopened-session sweep and `catalog_seen_at`, so `lahe library` would print a URL that 404s, and a restarted static server's stale origins would come back. |
> | 16 | Serving pages itself: no pages port, no site registry and no `site.bind`, so `lahe review` could not give a page its stable address. |
> | 17 | `review.retire`; it also takes events for a retired review, answers `records.read` for one review only, and binds a file into its own folder site even inside a reviewed folder, so one file could get two addresses. |
>
> ### `helper-address.ts`: where the helper listens
>
> Port 7817 is fixed by default and changed only with `--port`. A page has the port baked into its script tag and no way to learn a new one, so an ephemeral port would break reconnecting the first time the helper restarted.
>
> The helper binds loopback only, and the Host check allows only `127.0.0.1`, `localhost` and `[::1]`, at any port. That check is what stops DNS rebinding: a hostile name that resolves to 127.0.0.1 still arrives with its own name in Host. The check ignores the port on purpose; the listener already decides which port answers. The old list also named a bare `::1`, which could never match: stripping a trailing `:<digits>` turns it into `:`. A bare IPv6 address is not a valid Host anyway, so the new list leaves it out.
>
> ### `review-write.ts`: what `review.write` accepts
>
> A review is guarded by two factors: its token and its origin allowlist. The token is on the script tag, so any script on an allowed page can read it. `review.write` takes origins in its body, so if it accepted any origin, a script on an allowed page could add its own and leave the token as the only factor. So the route accepts only what `lahe add` legitimately sends: `"null"` (a page opened from a file) and `http` or `https` on a loopback host, at most 16 per review. Sixteen covers the ordinary spread (two loopback names, a few ports, both schemes) and refuses a caller that keeps adding. `lahe add` writing the review to disk may register wider origins, because there a person typed `--origin` at a terminal.
>
> The check matches what a browser sends in Origin, character for character. It is a regular expression and a port check, not `new URL`, because this folder has no DOM and no Node types. The tests list every case `URL` used to decide.
>
> The same narrowing applies to two flags. `only_recorded_pages` and `notes` are accepted as `true` and never as `false`: narrowing is the reviewer's choice, and widening a review back out is what a leaked token would ask for.
>
> ### `site-addresses.ts`: sites and Host classification
>
> A site is a folder, or one notes page, that the helper serves at `http://<name>.lahe.localhost:1483/<path>`. Only `site.bind` makes names, and only the CLI can call it. Every browser treats `.localhost` names as this computer and as secure with no setup, which is the reason `lahe status` prints.
>
> `classifyHost` runs first in every request, on both listeners, and sorts the Host into the API (a loopback name), the Library (`library.lahe.localhost`), a page (`<name>.lahe.localhost`, one to four labels), or bad. Whether a page name is registered is the registry's question, asked afterwards. The port is checked before the Library's name: the Library answers at the pages port or with no port (the port-80 forward), never at another.
>
> The short `.lahe` ending counts only once the helper has proved its own name server answers `.lahe` lookups on this computer (`addresses.js`), and never for the Library. Without that proof, a website that answers its own `.lahe` name could pass as a page. `siteNameFromOrigin` follows the same rule for an Origin header.
>
> Every page response carries `Cross-Origin-Resource-Policy: same-origin` (`PAGES.CORP`), so another site cannot embed it.
>
> ### `headers.ts`: headers and the signed-request wire
>
> - `x-lahe-client` has one job: to be a header a form or an image tag cannot set, so a CORS-simple request never reaches a handler. Review routes accept `layer` and `cli`. The Library page sends `catalog`, which review routes refuse on purpose: that page holds no review token.
> - `x-lahe-token` is the per-review token. Anything running on the reviewed page can read it, which is why it is scoped to one review and never to the machine.
> - `x-lahe-request-id` is echoed on every response, so a chip on the rail can be matched to a line in the helper log.
> - The `sec-fetch-*` headers are set by the browser and never by a script. The Library's routes read them to tell their own page from a document on another loopback port.
> - `x-lahe-cli-secret` is read from an owner-only file in the state folder and sent only by the CLI, so a page holding a review token still cannot name a file to serve.
> - The menu bar app proves it can read that secret without sending it. The signed string is these lines joined by single newlines, with no trailing newline. A request: `lahe-proof-v1`, the method, the path with its query exactly as sent, the timestamp in Unix milliseconds, the nonce, and the hex SHA-256 of the body. The answer: `lahe-proof-reply-v1`, the request's nonce, the status code, and the hex SHA-256 of the response body. A timestamp more than 30 seconds from the helper's clock either way is refused. The nonce is 16 random bytes as lowercase hex, and the MAC is a lowercase hex HMAC-SHA256 keyed by the CLI secret. A program squatting on the port learns one used proof and nothing else.
> - `summary.read` answers in version `SUMMARY_VERSION`. The app sends the version it was built for, and any other gets a signed 409.
>
> ### `routes.ts`: the route tables
>
> Four lists, on purpose. `ROUTES` is the per-review wire: the router binds a handler to every entry at load and matches paths exactly, so a route with no handler fails at start rather than in front of a reviewer. The Library's routes have their own credential and their own check table, and `catalog.asset` is a path prefix, so the helper binds them itself. Site routes take the CLI secret and refuse any request with an Origin header, so a page holding a review token can neither name a file nor move a rail. Summary routes take the CLI proof, refuse any Sec-Fetch header (a browser sends one on every loopback request; the menu bar app sends none), and never answer on the Library's host.
>
> Two routes need no credential, visibly, through `AUTH.NONE`: `health`, which carries liveness and version only, and `library.get`, which serves the tool's own public bytes, the same file that ships in the repo.
>
> **The Library's check table** (`checks` on each Library route): Host is always checked. `sec_fetch_site` lists the values allowed, and a missing header is refused. `token` means the `catalog` client header plus the Library token. `json_body` means the JSON content type. `origin: "exact"` means Origin must equal `http://` plus the request's Host. No Library route sends a CORS header, and preflight never approves one.
>
> `catalog.page` opens on any top-level navigation, from any site (a link in a document or an email, a bookmark, a typed address), and on a request with no Sec-Fetch headers at all. A cross-site navigation cannot read the page it loads, and the page sends `X-Frame-Options: DENY`, `frame-ancestors 'none'` and a same-origin opener policy, so it can be neither framed nor scripted by its opener. A fetch or an iframe asking for it is still refused. The page carries the Library token in a `<meta name="lahe-catalog-token">` tag, because its CSP (`script-src 'self'`) forbids an inline script. The Library token is minted in memory at each helper start and can list, open (restart recorded servers only), star, rename and queue a request. It cannot post to a review, read comment text or name a file to serve.
>
> **Requests and answers**, which the route entries used to carry as strings:
>
> | Route | Request | Answer |
> | --- | --- | --- |
> | `health` | | `{ok, version, api, service_contract, started_at, catalog_seen_at}` |
> | `events.append` | `{review, events: [event...]}` | `{accepted: [event_id...], seq}` |
> | `library.get` | | the built library, as `application/javascript` |
> | `review.write` | `{review, origins: [origin...], target_path?, source_path?, source_hint?, page_path?, only_recorded_pages?: true, notes?: true}` | `{origins, recorded_source, recorded_paths, only_recorded_pages, seq}` |
> | `review.read` | `?review=<id>` | the `review.json` projection, plus `{seq}` |
> | `records.read` | `?review=<id>&page_path=<location.pathname>` | `{records: [record...], seq}` |
> | `replies.poll` | `?review=<id>&since=<seq>&page_path=<location.pathname>` | `{events: [event...], seq, target_mtime, stamp_carriable, agent_liveness}` |
> | `window.claim` | `{review, window_id, session_secret?, takeover?, quiet?}` | grant `{granted: true, since, heartbeat_seconds, quiet_heartbeat_seconds, took_over, session_secret}`; refusal `{granted: false, since, heartbeat_seconds, quiet_heartbeat_seconds, reason, deposed}` |
> | `window.release` | `{review, session_secret}` | `{released}` |
> | `review.end` | `{review}` | `{ended_at, outstanding_kept}` |
> | `catalog.page` | | `text/html` |
> | `catalog.asset` | an allowlisted name after the path | the file |
> | `catalog.list` | | `{attached, sessions: [...]}` |
> | `catalog.open` | `{review, handoff, confirmed}` | `{url, request_id, not_asked}` |
> | `catalog.star` | `{review, starred}` | `{review, starred}` |
> | `catalog.rename` | `{review, name}` | `{review, name}` |
> | `catalog.request` | `{review, action, confirmed}` | `{request_id}` |
> | `site.bind` | `{review, root, mode: "folder" or "page-only", entry, mounts?: {prefix: dir}, linked?: [file]}` | `{name, origin, url, printed_ending}` |
> | `review.retire` | `{review, session}` | `{review, retired_at}` |
> | `summary.read` | `?v=<summary_version>` | the summary table in `docs/CONTRACTS.md`; `test/fixtures/menubar/summary.json` |
> | `summary.open` | `{review, summary_version}` | `{url}`, or `{url: null}` for a row only an agent can serve |
>
> Notes on single routes:
>
> - `replies.poll`'s cursor is a `seq`, never a timestamp or an offset. `target_mtime` is the requesting page's file time (ISO), or `null` when the file is missing; a changed value means the agent rebuilt the page, and the layer reloads it. `stamp_carriable` is `false` for a Markdown or plain-text source, which cannot hold a `data-lahe-id`, so the page check never asks an agent for one. `agent_liveness` is read off the review's own replies and the owning session's files, never taken from anything the agent said.
> - `window.claim`'s refusal names no holder and no secret. `quiet: true` says nobody is looking at that window, so it beats less often and the helper holds it longer. `deposed` is true only for the window an explicit "Review here instead" threw out, which the page acts on at once; every other refusal it waits out, because a helper being replaced looks the same.
> - `window.release` needs the session secret, as a heartbeat does; otherwise any window that can name a review could evict the real holder.
> - `review.end` archives, never truncates. `outstanding_kept` counts items still ready, through the projection. It once counted log lines, which made a ten-comment review report hundreds.
> - `records.read` returns only this review's records for the asking page (its own address, its site's old origins, and for an old Markdown review the rendered file's old path), never a draft. A page whose Origin is not a site address gets an empty list.
> - `review.retire` may be called only by the owning session. A retired review answers on no page, fails the Origin check and takes no events.
> - `catalog.request` takes ids only; extra body fields are dropped. `catalog.rename`'s name is display text for the Library and never reaches an agent.
>
> `HEALTH_FIELD.CATALOG_SEEN_AT` is the time of the last authenticated `catalog.list`. `lahe session close` reads it to decide whether the Library keeps the helper up.
>
> ### `request-checks.ts`: the per-request checks
>
> Loopback is not a boundary, so a page proves itself on every request. The checks run in a fixed order, each with a name and a failure code, and the helper logs the name of the one that failed, so "outside cannot get in" can be checked from the log rather than claimed:
>
> | Check | Why |
> | --- | --- |
> | host | The Host must name the helper, or a rebound DNS name reaches a handler with the browser's help |
> | custom_header | A form post or an image tag cannot set a custom header, so requiring one refuses every CORS-simple write |
> | content_type | Mutating routes take JSON only, which a simple request cannot send |
> | review_known | An unknown review id has no token to check against, so it is refused rather than defaulted |
> | token | Compared in full. Absent configuration fails closed |
> | origin | Read from the request's own header, never its body, and it must be one the add step registered |
> | sec_fetch_site | Library routes only: a document on another loopback port sends `same-site` and is the page most likely to run a script the reviewer did not write, so the Library's API takes exactly `same-origin` |
> | sec_fetch | Summary routes only: any Sec-Fetch header means a page is asking |
> | proof | Summary routes only: signed with the CLI secret, inside the window, with an unseen nonce, compared in constant time. The raw secret header is refused |
>
> `checkRequest` runs the first six, for review routes. The Library, site and summary checks live in the server (`auth.js`), which dispatches on the route's `auth` before calling it.
>
> The token comparison is constant time in plain code, because this folder cannot use `node:crypto` and the same code runs in the browser. Length is not hidden: tokens are fixed-length mints.
>
> A page opened from a file sends Origin `null`, or none; both count as `"null"`, which passes only when the add step registered it for that review. That is D11's stated residual risk.
>
> `sec_fetch` and `proof` fail with `AUTH_REFUSED`, which is not in the failure table. The server builds and signs those answers itself; never pass that code to `errorBody`.
>
> ### `error-body.ts`: status codes and the error shape
>
> Every non-2xx answer has one shape, `{error: {code, message, remedy, detail, check, request_id}}`, so the layer has one parser and the rail can list any of them without a special case. Messages and remedies live in the failure table (`failures.ts`); the Library page shows the remedy. A code with no status is a 500. `AUTH_REFUSED` and `SUMMARY_VERSION` have statuses here but are not failure-table codes, because their answers are signed by the server.
>
> ### `events.ts`: the event log line
>
> One JSON object per line of `events.jsonl`, so an interrupted write corrupts at most the last line, never history. `JSON.stringify` escapes every newline and control character inside a string, which keeps one event on one line whatever the page's text is.
>
> **Idempotence is by `event_id`, never by `(item, rev)`.** Drafts do not bump `rev`, and drafts go to the helper, so the log holds many events sharing an item and a revision with different content. Keying on `(item, rev)` would drop the later draft or make a reconnect's re-post ambiguous. `(item, rev)` belongs to the lifecycle.
>
> The client mints `event_id` and `ts`. The helper assigns `seq`, monotonic per review, which is the cursor every reader uses. The helper also stamps `received_at` with its own clock at append and overwrites anything a client sent under that name. It is the one time on an event a page cannot choose. `ts` is when the browser made the event, which for a held comment can be most of an hour before anyone could see it, so the rail's waiting clock starts at `received_at` and releasing Hold never trips the overdue alert at once.
>
> The vocabulary is closed: the projector, the merge rule and reply folding all switch on it. Event meanings beyond their names:
>
> - `origin.removed` `{origin}`: a restarted static server's earlier loopback origins, and only those, are removed. Recovery applies it in order with `origin.registered`, so a removed origin stays removed after a restart.
> - `item.content` is every content change, including every draft keystroke batch; it is the event the flush policy governs.
> - `item.closed` `{item, rev}`: the reviewer chose "Mark as done". An act at one revision, not a state claim: it carries no record, and the projection applies it only when the item is still outstanding at exactly that revision.
> - `reply.seen` `{item, stamp}`: the rail marked an agent reply read, naming it by its reply stamp. Not a lifecycle move; no agent acts on it.
> - `review.adopted` `{agent_session_id}`: a review from before sessions was taken into a session, once, by a Library pick-up. A review with a real session is never adopted.
>
> `parseEventLine` checks only `event` and `event_id`. Every other field comes back as written, typed `unknown`; narrow what you read.
>
> ### `flush.ts`: the draft flush policy
>
> This decides how fast the log grows and how much of a sentence a crash can cost.
>
> - Browser storage gets every keystroke, synchronously, with no debounce. A reload, a crash or a sleep costs nothing.
> - The helper gets queued events within 750ms.
> - An item whose queued events are all drafts goes to the helper at most once per 10 seconds. The browser already has every keystroke, so the helper's copy is a crash backup, and a few seconds of it is an acceptable loss. It is a deadline from the item's last draft post, not a timer that typing pushes back, and `flush` itself applies it, so the poll loop cannot get round it.
> - A free-writing run record's drafts carry the whole run, so they wait 30 seconds. A commit is never held.
> - Every event of a choice item waits until 3 seconds after the page's last press, so presses close together reach the helper in one post and wake the agent once, capped at 10 seconds from the first held press so steady clicking cannot hold work back.
> - `blur`, `hide`, `ready`, `navigation` and `unload` flush at once, past the debounce and the draft floor. `hide` is the tab being hidden, often the last thing a page hears before the browser discards it. Hold's gate still applies.
> - **The unload post uses `fetch` with `keepalive: true`, never `sendBeacon`.** `sendBeacon` cannot set the custom header or the JSON content type, so it would either drop the header or be refused during unload, when nothing is watching. Keepalive carries headers at the cost of a body limit of about 64KB across all in-flight keepalive requests. A body too large for it is already safe in browser storage and goes on the next load: the cap costs latency, never work.
>
> `fitsKeepalive` counts UTF-8 bytes by code point, as `TextEncoder` would; this folder has neither `TextEncoder` nor `Buffer`. A lone surrogate counts 3 bytes, as the browser's encoder writes it as U+FFFD.
>
> ### `replies.ts`: the reply line
>
> The reply line is the tool's public API to every agent: one appended JSON line per reply, in `replies.jsonl`, or `replies-<agent>.jsonl` when several agents work at once. The agent segment is a path component, held to the safe-id rule; a file whose segment fails is ignored and reported.
>
> `parseReplyLine` never throws. A helper that exits on one agent's typo takes the reviewer's session with it, which is worse than the failure it reports. A bad line is skipped, a `reply.rejected` event names the file, the line and the reason, and the rail shows a dismissible chip. A required `reason` or `text` that is blank counts as missing, so a hand-appended refusal with nothing in it becomes that chip rather than an empty refusal on the reviewer's card.
>
> When the filename's agent and the line's `agent` disagree, the line wins, because the line is what the reviewer sees on the card.
>
> `user_needs_to_see_reply` is how an agent says an answer deserves the reviewer's attention: an answer to them, a caveat, a judgment call, a change made differently than asked. It is what the unread badge counts. Optional fields are lenient: only the boolean `true` sets it, and anything else drops to `false` rather than costing the line, because losing a badge is smaller than losing the answer. `question` and `not_handled` replies reach the reviewer with or without it.
>
> A proofread is a question on a long hand-written run: the agent placed the words as written and lists fixes as `{block, from, to}`, where `block` indexes `new_blocks`. A hand-written line skips `lahe reply`'s checks and the rail applies the list on every paint, so the count is capped at one fix per block at the run's block ceiling and each string at the run's size ceiling. Those two numbers restate `record`'s `NEW_BLOCKS_MAX` and `NEW_BLOCKS_MAX_BYTES`, because `record` converts after this module; `fix_round_f3_service.test.js` holds them equal. The text cap counts characters, not bytes.
>
> **The reply poll.** The helper polls each `replies*.jsonl` every 5 seconds as a safety scan for idle reviews; active pages, CLI reads and event appends trigger the same fold at once. It tracks a byte offset per file. A file shorter than its offset was rewritten, not appended to, so the offset resets to zero and the file is folded again, which is safe because folding is idempotent. A final line with no newline is held until it completes, so a torn write is never half-parsed. The layer's own cursor is a `seq`: two events in one millisecond are ordinary, and a clock that steps backwards would silently skip work.
>
> ### `script-tag.ts`: the script tag
>
> The one line a person or an agent types by hand, so its form is public.
>
> **The tag carries two sources.** The primary `src` is the helper's own URL (`http://127.0.0.1:<port>/lahe-layer.js`), which resolves from any folder, origin and depth; a relative path resolves against wherever the page is served, and 404s the first time that is another folder. The fallback is a copy of the library beside the page, named by a relative path in `data-lahe-fallback` and loaded by the inline `onerror` when the primary fails. It is what lets a page opened while the helper is down still load the library: the rail appears, says the helper is unreachable, records into browser storage, and posts everything when the helper comes back. Under a strict CSP that refuses inline handlers the fallback cannot run; the primary still loads there, and `lahe add` prints that caveat.
>
> The injected fallback script carries no data attributes on purpose: its `document.currentScript` has none, so boot falls through to `SCRIPT_SELECTOR` and reads the config off the original tag.
>
> **The `onerror` text uses single quotes only and holds no `>`.** It sits inside a double-quoted attribute, and `EXISTING_TAG` in `server/sites/script-line.ts` scans the attributes with `[^>]*`, so a `>` would cut the match short and the line could no longer be found, replaced or removed.
>
> **Opt-ins**, never written by `lahe add`:
>
> - `data-lahe-frames="allow"` boots inside an iframe anyway. The library refuses to boot in a frame because a reveal.js speaker-notes window embeds the deck in an iframe, and the embedded copy fought the real window for the review's window claim. A page that deliberately reviews an embedded document sets this.
> - `data-lahe-start="hidden"` starts in present mode: nothing of the library's shows until the reviewer presses the show and hide chord. For a deck presented more often than reviewed.
>
> Each opt-in takes one value; anything else is ignored, so a typo falls to the safe default rather than a guess.
>
> **Attributes the helper writes:**
>
> - `data-lahe-notes="true"` marks a `lahe write` notes review. The layer reads it at boot, before the helper has answered, so an empty notes page can open for typing and no other empty page does.
> - `data-lahe-document="true"` marks a page the helper serves itself as a document, added at response time and never written to disk. The layer arms choice buttons only when it is there.
> - `data-lahe-aliases` lists the page's site's old page-server origins (`http://127.0.0.1:<port>`), so comments made at an old address show at the new one.
> - `data-lahe-path-aliases` lists the page's old paths; only an old Markdown review has one (its page was the rendered `/<name>-<hash>.html`, its new address is the source). Read only together with an old origin.
> - `data-lahe-spellings` lists the page's other addresses in its review, as `"origin path"` strings: a link address on another page's site, or an old address.
>
> The three lists are JSON in a double-quoted attribute, so `&`, `"`, `<` and `>` are written as entities, and each member is checked before it is written. `src`, `token`, `helper` and `fallback` are written as given: they come from the CLI or the helper, never from a page.
>
> ### `agent-commands.ts`: exit codes, the wake feed and command spellings
>
> **Exit codes.** 2, 3 and 4 are the caller-error set every command shares; a command reaches for `BAD_USAGE` rather than inventing another number. 5 (the session was closed) and 6 (another agent took it over) exist because a host reads a monitor's exit code to decide whether to relaunch it. "Stop relaunching" and "someone else owns this now" are different instructions from "you typed it wrong". When they were all `BAD_USAGE`, a closed session's monitor was relaunched forever.
>
> **The wake feed** is one append-only file per agent session, `<state>/agent-sessions/<id>/wake.log`, so a host with no push channel can get one: `tail -n 0 -f wake.log` wakes on a line and costs nothing while quiet. It is never rewritten and never rotated, because `tail -f` follows an inode, and an atomic replace leaves the tail watching a deleted file forever, silently. Its lines are pointers, not payloads: "there is work, run the drain". A line never carries reviewer text, because intent reaches an agent only through `review.json`, where the trust classes and fencing live (D12); a wake line with text in it would be a second, unfenced instruction channel.
>
> Kinds: `work` (a ready item landed in a review this session owns), `takeover`, `closed` (nothing more will be appended), and `ended` (the reviewer pressed End review; it names the review and no item). **`ended` is not stop.** An ended review's unanswered items are still the reviewer's requests, so the answer is the same drain followed by the end-of-review routine. Only `takeover` and `closed` mean stop. Without `ended`, an ended review drained to zero ready items, which looks exactly like a review the agent has kept up with, so the agent read "finished" as "quiet" and waited.
>
> **One spelling of each command.** The drain, monitor and takeover commands are printed by `lahe review`, `lahe session takeover`, the monitor, the wake lines, the hook and the rail's hand-off message. Several spellings of one command is how an agent ends up running a new one.
>
> **The state-dir rule.** Pass the state folder when it is not the default. A command copied out of a review kept in a custom folder would otherwise resolve the default when run, and report no work while items wait a few paths away. Callers decide with `state_dir.flagFor`, which returns `null` when the default already resolves to the same place, so the flag is not noise on every command. A path a person chose can hold a space, so it is quoted for the shell when it needs to be.
>
> `takeoverCommand` adds `--request <id>` for a Library hand-off: naming the request is what lets the takeover through while the session's agent is still listening.
>
> ### `agent-liveness.ts`: what the rail may say about an agent
>
> The rail once showed what the agent said about itself, which is how a chat claiming "monitoring is active" sat over seven unanswered items. Everything here comes from files the helper and the monitor write, never from a claim.
>
> **Silence only matters when something is waiting.** A review with every item answered and an agent sitting quietly is the normal, healthy, most common state, and a rail that says anything there cries wolf on nearly every open session. So nothing unanswered means nothing said (`none` has no words). The other states exist only while an item waits, and report how long it has waited, which is always knowable, about the reviewer's own work, and cannot be faked:
>
> - `working`: the agent ran a lahe command or landed a reply recently. Mid-task is not alarming however long the queue.
> - `waiting`: nothing has come back for a while.
> - `no_agent`: nothing has come back and the machine can see nothing is listening: no process holds the wake feed open, no live monitor, no recent command. A different next move for the reviewer, so a different state.
>
> `listening` is `true`, `false`, or `null` for "cannot tell", which is the answer on any host where the machine cannot be asked. `null` never produces a claim either way. `session_name` is display text; `session_name_from_page` marks a name read off a page title, which the rail shows but the hand-off message leaves out, because that message is a new agent's first prompt. `state_dir_flag_needed` is a boolean on purpose: the page is never sent a filesystem path.
>
> `presence` is what the Library may say whether or not anything waits: `listening` (a live monitor heartbeat on this handoff revision, or a process holding the wake feed), `working` (neither, but a lahe command within `CATALOG.WORKING_MS`), `away` (the Library says when it was last active).
>
> **The words** are spelled once, here; they used to be copied into the layer, and a renamed state then looked exactly like a healthy rail with nothing to say. They are in the reviewer's words, with no monitors, heartbeats or wake feeds. `{age}` is filled by whoever draws the line, off its own clock, so a helper repeating an unchanged answer cannot freeze a growing number. `CONNECTION` is the quiet indicator the line wears the rest of the time: two words, no verb, `null` when the machine cannot be asked. `DETAIL` is the hover text, everything the tool knows about the connection. `PROMINENT` is the loud half: a banner and a word on each late card, shown only while the wait is overdue.
>
> **The timings.** The line speaks at 30 seconds (`QUIET_MS`), when a person who just typed starts wondering, and the clock starts on submitted work only: a draft waits on nobody. An agent counts as working for 10 minutes after a command or reply (`ACTIVE_MS`), the same as how long a command counts as somebody being on the review (`RECENT_COMMAND_MS`), because a model thinking through a hard comment leaves no footprint; at three minutes that quiet read as an empty chair. A wait with nothing happening goes loud at 10 minutes (`STALE_MS`); nothing about listeners buys quiet there, because a file tail can be armed all afternoon over an agent that stopped reading. "Nobody has picked this up" speaks at 30 seconds like the others but goes loud only at 2 minutes (`NO_AGENT_LOUD_MS`), since not seeing a listener is weak evidence. `CATALOG.WORKING_MS` is much shorter than `ACTIVE_MS` on purpose: that window decides whether a person is told another agent has the session, while this one only withholds an accusation.
>
> **`livenessOverdue` is the one rule** for "this wait is overdue". The footer going loud, a late card turning amber and the banner all read it, so the three cannot disagree.
>
> **`handoffMessage`** is what the reviewer pastes into a fresh agent; the rail's banner and the Library (its drain's Launch prompt and its copy panel) both build it here. It is written to the new agent, so it names the command, and pasting it is the human's explicit request that `lahe session takeover` requires. It carries the command and nothing else from the wire: no token, no secret. From the rail, the earlier agent stopped answering and the page knows only whether a state-dir flag is needed, so it asks for the folder. From the Library, the session may be closed or the reviewer wants a new agent, so the opener blames nobody, and the helper knows the folder, so it writes it. Never pass a page-derived name.
>
> **Monitor files.** The heartbeat (`monitor.json`) and the activity stamp (`activity.json`) are separate files because `session.json` is rewritten by takeover, and a heartbeat in it would race that. `delivered.json` holds the items a monitor already printed to the agent at this handoff revision, so a relaunch with only those unanswered waits instead of printing them again and exiting at once. The monitor polls every 15 seconds and writes its heartbeat once per loop, so a heartbeat more than three loops (45 seconds) old means the process is gone, not slow. A monitor watching several sessions writes one heartbeat into each, all naming the same `primary` (its first `--session`), so the Library can say which agent is watching a session it picked up.
>
> ### `library.ts`: the Library's constants and log line
>
> Every number the Library's rules use is spelled here once, and every expiry and freshness check takes `now` as an argument, so tests pass a clock instead of shrinking a constant. An unanswered request expires after 30 minutes. A Library poll in the last 2 minutes keeps the helper up when the last session closes. A session bare `lahe library` started (marked `created_by: "library"` in its `session.json`, written by the CLI) closes once it owns no reviews and its agent has been quiet for 30 minutes. At most 5 requests are pending across the Library. The reader re-projects review logs up to 5 MiB. The page polls every 15 seconds, which is also how long a server probe is cached. An answer stays on its row for a day, and `lahe library answer` takes at most 500 characters. Sessions active in the last 7 days are open in the default view. Reviews created before midnight US Eastern on 2026-09-17 can fold into one row per folder.
>
> **`last`** for a review is the time inside its newest event that is work on the document, by the reviewer or the agent. `NOT_WORK_EVENTS` are not: an Open's origin swap, a visit, an adoption and a reviewer reading a reply. Compaction rewrites the log without adding an event, so the file's modified time is never read for `last`.
>
> A legacy pick-up has no session, so it is served as a fresh review and its comments stay where they are; `legacyPickupNote` is the one wording of that, for the drain and `lahe library serve`.
>
> **The log line**, one per action: `catalog <open|star|unstar|pickup|launch> review=<id> age_days=<n>`, where `age_days` is whole days from the review's `last` to the action. **Trap:** `scripts/catalog_opens.py` reads `PREFIX`, `ACTION.OPEN` and `DEFAULT_VIEW_DAYS` from this file's text with regular expressions. Keep `PREFIX` the first key of `CATALOG_LOG` and all three as literals, or the script exits 2 and `catalog_opens_script.test.js` fails.
>
> ### `protocol.ts`: the bridge
>
> Re-exports every module in this list under one namespace, for two readers only: the forwarder at `src/shared/protocol.js`, which unconverted JavaScript requires, and the browser registration that puts `LAHE.protocol` on the page for unconverted layer and Library files. New TypeScript imports the module it needs. The finishing slice removes this file.

**Dropped as dead history:**

- Owner codes and import lists: "Owner: 0A-wire", "Imported by: ... (1A) ... (1B) ... (3A)", "Stated once, here, so 1B does not invent it", and the four-part tour of the file at its top.
- Requirement and review ids that no longer resolve to anything a reader can open: AC8, R10, R36, V31, "Finding 4", "security review 4", and the board row `LAHE-held-release-waiting-clock`.
- Dated attributions to Ken (2026-09-16, 2026-09-22); the rules they produced are kept, without the date.
- "There is no session exchange and no machine-wide run token: both belonged to the archived send model."
- The prose that `FLUSH`, `REPLY_POLL` and the route and check tables carried as strings, except where it is kept above.
- The note that `failures` is `undefined` on the Library page: S0c's bundle removes that case.

Decision numbers D1, D5, D6, D11 and D12 are kept where they explain, because they resolve in the original architecture document under `docs/features/20260812.01_live_agentic_html_editor/`.

## 10. Open questions

Decided here, unless the orchestrator says otherwise:

- **Liveness words and command spellings stay in `contract`,** not `domain`. They are vocabulary that crosses the boundary (the rail, the Library, the CLI and the hook all print them), and moving them would put C4's code in another slice's folder.
- **The bridge is `src/contract/protocol.ts`,** matching the target layout's path, because the forwarder and the registration each need one module.

For the orchestrator:

1. **The three failure-table cases in `protocol_wire.test.js`** ("the new failure codes exist...", "an old spelling resolves...", "telling a CSP refusal..."). They test `failures.js`, which is C1's. If C1's spec maps them, C4 drops them as covered there; if not, C4 moves them verbatim into C1's failures test file. Please check C1's spec and say which.
2. **S0c's registration must serve both bundles.** The Library page reads `window.LAHE.protocol` too. If S0c's generated registration covers only the review layer, C4 needs it extended for `dist/lahe-library.js`, or raises it before building.
3. **Board rows to add:** `addresses.test.js` passes the nonexistent `protocol.PAGES.SWITCH_ON` (always `undefined`); "the layer never calls `sendBeacon`" has no real test now that the hollow constant is gone, and a `no-restricted-properties` lint rule in the browser projects would enforce it (slice B9 or the lint owner); C3 should make `record`'s run ceilings and the reply suggestion caps one source; docs that name `src/shared/protocol.js` (`CONTRACTS.md`, `LIBRARY.md`, `FREE_WRITING.md`, `CHOICE_BUTTONS.md`, `OUTBOX_COALESCING.md`, `DIAGRAMS_PLAN.md`) stay correct while the forwarder exists and should be swept with F1's import rewrite.
4. **D6 and D7 are visible to agents** (a malformed-line chip where there was a blank refusal, and a reworded chip reason). They are listed for the progress page as departures. If the orchestrator would rather ship them as separate board rows, drop both from the slice; nothing else depends on them.

## Orchestrator decisions (2026-11-12)

1. **The three failure-table cases** belong to C1, which owns `failures.js`. C4 drops them from `protocol_wire.test.js` once C1 has carried them. If C1's spec does not map them, the orchestrator tells the C1 builder to carry them as they are.
2. **Both bundles use the same registration.** S0c builds one code path, driven by `LAYER_FILES` and `CATALOG_PAGE`. C4 changes only its manifest entries.
3. **The board items** are listed in the plan's "Board rows to add" and filed at checkpoint 1. The `sendBeacon` lint rule goes to B9.
4. **D6 and D7 stay in C4,** each as its own commit, recorded as departures on the progress page.
5. **`scripts/catalog_opens.py`** belongs to C4. It points its regex at the new Library module.
6. **D12 (the Library bundle includes the failure table)** is expected. S0c keeps today's behavior, which omits it, and C4 changes it on purpose.
