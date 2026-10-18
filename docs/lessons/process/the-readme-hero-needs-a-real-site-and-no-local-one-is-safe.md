---
title: The README hero needs a real website, and none of Ken's local sites is safe to screenshot
category: process
symptoms: [retake the README screenshot, README hero looks plain, steady-thread dev server will not start, pending migrations, herald has private data, screenshot a public site with the rail, hero-thread.jpg]
applies_to: ["docs/images/hero-thread.jpg", "README.md"]
first_seen: 2026-10-14
confirmed: 2026-10-14
status: live
---

## What happens

A hero taken on a plain Markdown demo page gets rejected as too plain. Ken wants the rail over a real, designed website. The obvious local sites both fail. The Steady Thread dev server (`bin/rails server` in `steady-thread/code`) stops at boot with pending migrations, and running them would change Ken's dev database. Herald on port 3400 holds private data, and this repo is public.

## Why

The README is public, so the page under the rail must be public too. A dev server shows whatever state Ken's local database is in, and it is not yours to migrate.

## What to do instead

Serve the public https://steady-thread.com through a small local Node proxy. The proxy adds the Lahe script tag to each HTML response and drops any CSP meta tag. Run a temp helper with `startService` from `test/helpers/service.js`, never the real one. Make the agent's "fix" in the proxy: swap the words in the HTML after the reply, so the live site never changes. Shoot at 1440x900 and device scale 2, then convert with `sips` to a JPEG, quality 85, 1800 wide.

The script that does all of this is kept at `~/Documents/lahe-readme-hero/capture_st.js`. It reads `LAHE_BUNDLE` (the bundle to test) and `CARD_DIR` (where to write card close-ups).
