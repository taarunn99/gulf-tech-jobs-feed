# gulf-tech-jobs-feed

Collects public job postings in the UAE and the Gulf from open career-site pages, every 15 minutes, and keeps the ones first seen in the last 48 hours.

## What is in here

| File | What |
|---|---|
| `collect.mjs` | the collector (Node 20+, no dependencies) |
| `sources.json` | the career sites it reads |
| `data/latest.json` | postings first seen in the last 48 hours: title, company, place, link, dates |
| `data/meta.json` | the last run: real start and end time, rows per source, errors, reachability tests |
| `data/seen.json` | the id of every posting that is listed now, with the time it was first seen |

## Rules

- Public pages and feeds only. No login, no key, no CAPTCHA, and the collector says what it is in its user agent.
- Only paths that the site's robots.txt allows.
- Facts only: title, company, place, link and dates. No job description text is copied.
- Scheduled runs on GitHub can start late. `data/meta.json` has the real start time of the last run.

## Row format

```json
{ "id": "successfactors:host:123", "source": "successfactors", "company": "...", "title": "...", "location": "Dubai, United Arab Emirates",
  "url": "https://...", "posted_at": null, "posted_precision": "unknown", "second_hand": false, "first_seen": "2026-11-18T10:07:00.000Z" }
```

`posted_precision` is `exact` (the employer's publish time), `day` (only the day is known) or `unknown` (the site shows no first posting date; use `first_seen`).

## Run it yourself

```
node collect.mjs
```
