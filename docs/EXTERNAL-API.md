# External intelligence API (for Sigar Vote)

For the current aggregate-only dashboard integration, use
[DASHBOARD-INTEGRATION-API.md](DASHBOARD-INTEGRATION-API.md): `/all` schema 2.0 and
the `/field-work` extension. Deployment of the local update is still required.

> ### Status, as of this commit
>
> **Live**: `/summary`, `/registrations`, `/surveys`, `/coverage`, `/all`,
> `/projects`, plus `/areas`, `/volunteers` and `/activity` — the four built
> to the Sigar Vote brief, documented in SIGAR-VOTE-API.md.
>
> **Still specified but not deployed** (they return 404), marked as such below:
> `/registrations/report`, `/candidates`, `/tasks`, `/tasks/{id}/answers`
> and `/projects/summary`.


> You asked for an API the Sigar Vote team can consume: how many people are
> registered, where (LGA/ward/polling unit and GPS), survey answers and where
> they came from, and membership counts rolled up by polling unit, ward, LGA
> and senatorial region. This is that API.

Base URL: `https://<your-deployed-server>/api/external/v1`
Local dev: `http://localhost:4000/api/external/v1`

## Authentication

Every request needs an API key in an `X-API-Key` header:

```bash
curl https://your-server/api/external/v1/summary \
  -H "X-API-Key: kwarax10_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Keys are created and revoked from **Platform accounts → External API keys**
in the app (superadmin/admin only). The full key is shown **once**, at
creation — only a prefix is stored, so if it's lost the only fix is revoking
it and creating a new one.

| Situation | Response |
|---|---|
| No key sent | `401 { "error": "Missing API key..." }` |
| Invalid or revoked key | `401 { "error": "Invalid or revoked API key." }` |
| More than 120 requests/minute on one key | `429 { "error": "Rate limit exceeded..." }` |

120 req/min is generous for a dashboard polling on a schedule; if Sigar Vote
needs more, raise the limit in `server/external.js` (`rateLimited`) rather
than working around it.

## What's deliberately left out

This API hands real people's names and locations to a system outside this
one, so the fields are scoped on purpose: **name, level (Unit Promoter /
Grassroot), status, LGA/ward/polling unit, and GPS location** for
registrations; **question/answer pairs and location** for surveys.

**Phone number, NIN, PVC number, and bank details are never returned by
this API**, regardless of query params. Those are the most sensitive fields
on file and weren't part of the request — if Sigar Vote genuinely needs one
of them, that's a separate conversation, not a query parameter.

---

## `GET /all` — everything in one call


If you're building a consuming app, **start here**. One request returns every
aggregate this API produces, so you don't make ten round trips and stitch them
together.

```bash
curl "https://your-server/api/external/v1/all" -H "X-API-Key: ..."
```

```json
{
  "generated_at": "2026-09-23T09:00:00.000Z",
  "summary":              { "totals": {...}, "coverage": {...}, "surveys": {...} },
  "registrations_report": { "completeness": {...}, "duplicates": {...}, ... },
  "coverage":             { "by_polling_unit": [...], "by_ward": [...], "by_lga": [...],
                            "by_state_constituency": [...],
                            "by_federal_constituency": [...],
                            "by_senatorial_district": [...] },
  "candidates":           [ ... all 50 seats ... ],
  "tasks":                [ ... with their questions ... ],
  "survey_answers":       [ ... tallied answers per survey ... ],
  "projects":             { "summary": {...}, "rows": [...], "total": 42 },
  "notes":                { ... caveats you should read ... }
}
```

**Person-level rows are not included by default.** "Every registration" is
800,000 rows at full scale, and nobody wants that arriving by accident. The
aggregates are counts, so they stay small no matter how many people register.

Ask for the raw lists explicitly, and they come back capped:

```bash
# adds a capped page of registrations and survey responses
curl ".../all?include=registrations,surveys&limit=1000" -H "X-API-Key: ..."
```

For the complete lists, page through `/registrations` and `/surveys` — they
have `total` and `next_offset` for exactly that.

Every section of `/all` is produced by the same code as its individual
endpoint, so the two can never disagree about the numbers.

## The endpoints at a glance

| Endpoint | What it gives you |
|---|---|
| **`GET /all`** | **Everything below in one call** |
| `GET /summary` | Headline registration and survey totals |
| `GET /registrations` | Every registered person: who, level, where, GPS |
| `GET /registrations/report` | Data quality: completeness, duplicates, growth per day |
| `GET /coverage` | People per polling unit, ward, LGA and constituency |
| `GET /candidates` | All 50 seats, with nominees and projects per candidate |
| `GET /tasks` | Task and survey definitions, including the questions |
| `GET /tasks/{id}/answers` | Tallied answers for one survey, ready to chart |
| `GET /surveys` | Individual survey responses with location |
| `GET /projects` | What candidates have promised to build, and where |
| `GET /projects/summary` | Project totals by sector, scale, status and LGA |

## `GET /summary`

Headline numbers — good for a landing dashboard tile.

```bash
curl .../summary -H "X-API-Key: ..."
```

```json
{
  "generated_at": "2026-09-17T11:10:29.569Z",
  "totals": {
    "registered": 7, "verified": 0, "pending": 0,
    "flagged": 7, "rejected": 0,
    "unit_promoters": 7, "grassroots": 0
  },
  "coverage": { "lgas": 2, "wards": 2, "polling_units": 3 },
  "surveys": { "count": 0, "responses": 0 }
}
```

## `GET /registrations`

Every registered person: who, what level, where, and their GPS location at
registration.

**Query params** (all optional): `lga`, `ward`, `polling_unit`, `level`
(`mobiliser` = Unit Promoter, `grassroot` = Grassroot), `status`
(`pending`/`verified`/`flagged`/`rejected`), `since` (ISO date, registered
on/after), `limit` (default 200, max 1000), `offset`.

```bash
curl ".../registrations?lga=Ibadan%20North&level=mobiliser&limit=50" \
  -H "X-API-Key: ..."
```

```json
{
  "total": 7, "limit": 50, "offset": 0, "next_offset": null,
  "rows": [{
    "id": 1, "code": "KWARA-RP5FRG", "name": "Kunle Adewale",
    "level": "mobiliser", "status": "flagged",
    "lga": "Ibadan North", "ward": "Ibadan North Ward 01",
    "polling_unit": "Ibadan North Ward 01 / PU 001",
    "location": { "lat": 7.3775, "lng": 3.947, "accuracy": 12 },
    "registered_at": "2026-09-15T16:50:31.688Z"
  }]
}
```

`location` is `null` if GPS wasn't captured at registration.

## `GET /surveys`

Task/survey submissions, with each answer resolved to its question's label
(not a raw question ID), plus where the respondent was when they answered.

**Query params**: `lga`, `ward`, `polling_unit`, `status`, `task_id`,
`limit`, `offset` — same pagination as `/registrations`.

```bash
curl ".../surveys?ward=Akinyele%20Ward%2003&limit=20" -H "X-API-Key: ..."
```

```json
{
  "total": 1, "limit": 20, "offset": 0, "next_offset": null,
  "rows": [{
    "id": 12, "task_id": 3, "task_title": "Ward needs assessment",
    "answers": [
      { "question": "Biggest concern in your ward", "value": "Water supply" },
      { "question": "Would you attend a town hall?", "value": "Yes" }
    ],
    "status": "reviewed",
    "lga": "Akinyele", "ward": "Akinyele Ward 03",
    "polling_unit": "Akinyele Ward 03 / PU 002",
    "location": { "lat": 7.41, "lng": 3.91, "accuracy": 20 },
    "submitted_at": "2026-09-16T09:12:00.000Z"
  }]
}
```

If the submission itself has no GPS, `location` falls back to the
respondent's own registered location.

## `GET /registrations/report`

> **Not deployed.** This endpoint is specified but is not in the running
> service — calling it returns 404. The description below is kept as the
> specification to build to, not as something to integrate against today.


The state of the register itself — how complete and how trustworthy the data
is, rather than how much of it there is.

It reports on missing fields and duplicates **without returning any of them**:
you get *"14 records share a phone number with another record"*, never the
phone numbers.

```json
{
  "generated_at": "2026-09-23T09:00:00.000Z",
  "total": 1240,
  "by_status": [{ "status": "verified", "n": 980 }, { "status": "pending", "n": 210 }],
  "by_level":  [{ "level": "mobiliser", "n": 400 }, { "level": "grassroot", "n": 840 }],
  "completeness": {
    "missing_phone": 0, "missing_pvc": 96, "missing_nin": 310,
    "missing_bank_details": 41, "missing_gps": 12,
    "missing_polling_unit": 3, "bank_name_confirmed": 612
  },
  "duplicates": {
    "phone": { "groups": 7, "records": 14 },
    "account_number": { "groups": 2, "records": 5 }
  },
  "high_risk_records": 23,
  "registrations_per_day": [{ "day": "2026-09-22", "n": 87 }]
}
```

`registrations_per_day` covers the last 30 days, newest first.

## `GET /candidates`

> **Not deployed.** This endpoint is specified but is not in the running
> service — calling it returns 404. The description below is kept as the
> specification to build to, not as something to integrate against today.


All 50 elective seats, and what each candidate has actually done.

**Query params**: `office` (`Governor`, `Senator`, `House of Representatives`,
`House of Assembly`), `constituency`.

```json
{
  "total": 50,
  "rows": [{
    "id": 12,
    "name": "Sen. Yunus Abiodun Akintunde",
    "office": "Senator",
    "constituency": "Kwara Central",
    "scope_type": "senatorial",
    "nominees": { "total": 4, "verified": 3 },
    "projects": { "count": 7, "units": 23 },
    "reports_filed": 1
  }]
}
```

Candidates are public figures standing for election, so names, offices and
constituencies are returned. Their login details never are.

## `GET /tasks`

> **Not deployed.** This endpoint is specified but is not in the running
> service — calling it returns 404. The description below is kept as the
> specification to build to, not as something to integrate against today.


Task and survey definitions, **including the questions asked**.

**Query params**: `type` (`survey`, `rally`, `canvass`, `meeting`, …), `period`
(`YYYY-MM`).

```json
{
  "rows": [{
    "id": 4,
    "title": "Ward needs assessment",
    "type": "survey",
    "period": "2026-09",
    "status": "open",
    "points": 5,
    "mandatory": true,
    "targets": { "level": "all", "scope_type": "state", "scope_value": null },
    "due_at": "2026-09-30T23:59:59.000Z",
    "questions": [
      { "id": "q1", "label": "Biggest concern in your ward", "type": "select",
        "options": ["Water", "Roads", "Electricity", "Security"] }
    ],
    "submissions": { "total": 412, "approved": 380 }
  }]
}
```

## `GET /tasks/{id}/answers`

> **Not deployed.** This endpoint is specified but is not in the running
> service — calling it returns 404. The description below is kept as the
> specification to build to, not as something to integrate against today.


The same survey, **already tallied** — every question, every distinct answer,
and how many people gave it. Use this rather than pulling every response from
`/surveys` and counting them yourself.

```json
{
  "task": { "id": 4, "title": "Ward needs assessment", "type": "survey", "period": "2026-09" },
  "responses": 412,
  "questions": [{
    "id": "q1",
    "question": "Biggest concern in your ward",
    "answered": 408,
    "answers": [
      { "answer": "Water", "count": 190 },
      { "answer": "Roads", "count": 142 },
      { "answer": "Electricity", "count": 76 }
    ]
  }]
}
```

Answers are sorted most common first. Use `/surveys` instead when you need
individual responses with their locations.

## `GET /projects`


What each candidate has committed to build, where, and how far along it is.

**Read `status` before you display any of this.** Most rows are `promised` —
an intention, not work that has started. The three values are `promised`,
`ongoing`, `completed`. Presenting a promise as a delivered project would
misrepresent a candidate.

**Query params**: `lga`, `ward`, `sector`, `scale` (`small`/`medium`/`large`),
`status`, `since` (ISO date), `limit`, `offset`.

```bash
curl ".../projects?scale=medium&status=promised" -H "X-API-Key: ..."
```

```json
{
  "total": 12, "limit": 200, "offset": 0, "next_offset": null,
  "rows": [{
    "id": 1,
    "title": "Moniya Market Solar Lighting",
    "project": "Ward-level solar streetlights",
    "off_framework": false,
    "sector": "Electricity & Public Lighting",
    "scale": "medium",
    "status": "promised",
    "quantity": 6,
    "need": "Traders close early for lack of light.",
    "timeline": "Q1 2027",
    "lga": "Akinyele", "ward": "IKEREKU",
    "candidate": { "name": "Ajao Olugbega", "office": "House of Assembly",
                   "constituency": "Akinyele I" },
    "sites": [{ "lat": 7.545, "lng": 3.905, "label": "beside the market" }],
    "created_at": "2026-09-22T10:14:00.000Z"
  }]
}
```

`quantity` is how many of that thing go in that ward. `sites` are the exact
pins where they were placed — often fewer than `quantity`, or empty, because
a candidate can state a number before deciding the exact spots.

`off_framework` is `true` when the candidate typed their own project rather
than picking one of the framework's 360 options.

Candidate names and offices are included: they are public figures standing for
election. Budgets and implementing partners are not exposed.

## `GET /projects/summary`

> **Not deployed.** This endpoint is specified but is not in the running
> service — calling it returns 404. The description below is kept as the
> specification to build to, not as something to integrate against today.


The same data pre-aggregated, for a dashboard tile.

```json
{
  "generated_at": "2026-09-23T09:00:00.000Z",
  "totals": { "projects": 12, "units": 47, "candidates": 5, "wards": 9 },
  "by_sector": [{ "sector": "Water, Sanitation & Hygiene (WASH)", "projects": 4, "units": 18 }],
  "by_scale":  [{ "scale": "medium", "projects": 7, "units": 31 }],
  "by_status": [{ "status": "promised", "projects": 9, "units": 38 }],
  "by_lga":    [{ "lga": "Akinyele", "projects": 6, "units": 21 }]
}
```

## `GET /coverage`

Membership counts (Unit Promoters + Grassroots together — both are "members"
in this app) rolled up at every geographic level: polling unit, ward, LGA,
senatorial district, federal constituency, and state assembly constituency.

Call it with no params to get every level in one response, or narrow it with
`?level=` to get just one:

```bash
curl ".../coverage?level=senatorial_district" -H "X-API-Key: ..."
```

Valid values for `level`: `polling_unit`, `ward`, `lga`,
`senatorial_district`, `federal_constituency`, `state_constituency`.

Every level carries the same measures: total people, the two membership tiers
split out, and where they are in verification.

```json
{
  "generated_at": "2026-09-23T09:00:00.000Z",
  "level": "senatorial_district",
  "rows": [{
    "name": "Kwara Central",
    "lgas": 11, "wards": 24, "polling_units": 96,
    "members": 412,
    "unit_promoters": 120,
    "grassroots": 292,
    "verified": 330, "pending": 58, "flagged": 20, "rejected": 4
  }]
}
```

At `polling_unit` level each row carries `lga`, `ward` and `polling_unit`
instead of `name`; at `ward` level, `lga` and `ward`; at `lga` level, `lga`.
The counts are identical at every level, so one rendering handles all six.

Without `?level=`, the response has all six as top-level keys:
`by_polling_unit`, `by_ward`, `by_lga`, `by_senatorial_district`,
`by_federal_constituency`, `by_state_constituency`.

All six levels partition the state, so the rows at any one level add up to
the `/summary` total. State Assembly constituencies that split an LGA
(`Akinyele I` / `Akinyele II`, and the split Ibadan LGAs) are counted by ward,
so each member is counted in exactly one of them.

`wards` and `polling_units` count distinct places, not distinct names --
ward and polling-unit names repeat across the state ("WARD I", "Unit 001").

---

## Pagination

`/registrations` and `/surveys` use `limit`/`offset`. `next_offset` in the
response is either the offset to fetch next, or `null` when you've reached
the end — loop until it's `null` rather than computing pages yourself.

## Rotating a key

There's no "edit" — revoke the old key from **Platform accounts → External
API keys** and create a new one. Update Sigar Vote's config with the new
key before or right after revoking the old one to avoid a gap.

## Checking it works

After a deploy, run the smoke test against the live server with a real key:

```bash
node server/check-external-api.js https://your-server kwarax10_live_xxx
```

It checks that auth is enforced, every endpoint answers, pagination reaches
every record, no phone/NIN/PVC/bank field leaks, and each coverage level adds
up to the `/summary` total. It only reads.

Sigar Vote should call this API from its server, not from a browser: if
`ALLOWED_ORIGINS` is set, browsers on other origins are refused by CORS.
