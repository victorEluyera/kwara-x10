# 10x → Sigar Vote API

The current aggregate dashboard snapshot (`/all`, schema 2.0) and field-response
extension are documented in [DASHBOARD-INTEGRATION-API.md](DASHBOARD-INTEGRATION-API.md).
Its complete project list, official location codes and field-work aggregates
supersede the older `/all` descriptions below. Individual older endpoints retain
their existing contracts.

Server to server, JSON, API key. Read-only.

Base: `https://<host>/api/external/v1`
Header: `X-API-Key: <key>` (issued under Platform accounts → API keys)

Nothing sensitive crosses this boundary: **no NIN, no BVN, no bank details, no
PVC number and no photographs of identity documents.** There is a test that
fails if any of those columns is ever selected here.

## Fetching only what changed

Every endpoint takes `?since=<ISO timestamp>`:

```
GET /api/external/v1/projects?since=2026-09-01T00:00:00Z
```

Store the `generated_at` from each response and send it back as `since` next
time. An unparseable `since` is a **400**, not a silent full export — a caller
who thinks they have a delta and is quietly handed everything builds on that
for months.

Paging: `?limit=` (default 1000, max 5000) and `?offset=`. Responses carry
`total`, `count` and `next_offset` — keep going until `next_offset` is null.

---

## 1. `GET /areas` — counts per area

`?level=lga|ward|polling_unit` (default `ward`).

Per area: `registered`, `verified`, `pending`, `unit_promoters`, `grassroots`,
`last_registration`. Plus a `targets` block: **3,510 unit promoters** and
**35,100 engagements**, programme-wide, *not* split by LGA.

> If a figure of 750,000 is in circulation, it did not come from this system.
> 3,510 is what 10x holds as the promoter target.

## 2. `GET /volunteers` — one row per person

For matching against the PDP membership register, so each person is counted
once. `?level=unit_promoter|grassroot` to narrow.

`member_id`, `member_code`, `full_name`, `phone`, `level`, `status`, `lga`,
`ward`, `polling_unit`, `registered_at`.

## 3. `GET /projects` — one row per project

`?status=not_started|ongoing|completed` to narrow.

`project_id`, `title`, `category`, `sector`, `status`, `lga`, `ward`,
`polling_unit`, `community`, `quantity`, `unit`, `estimated_cost_ngn`,
`estimated_cost_text`, `submitted_at`, `started_at`, `completed_at`,
`updated_at`, `people_served`, `photo_count`, `lat`, `lng`,
`submitted_by_member_id`, `submitted_by_account_id`.

**Categories**: `water`, `roads`, `power`, `health`, `education`, `market`,
`empowerment`, plus `other`. The eighth is deliberate — forcing a town hall or
a refuse round into "empowerment" would be a worse answer than admitting it
does not fit. `sector` carries the original 10x classification alongside it.

**Statuses**: `not_started`, `ongoing`, `completed`. There is no `submitted`
status, because every project in 10x has been submitted — that is how it got
there. `submitted_at` says when.

**Cost** was always a free-text field ("₦2.5m", "about 900,000"). It is parsed
into `estimated_cost_ngn` where it can be read and left **null** where it
cannot, with the raw text in `estimated_cost_text`. Never a guess.

**Who submitted it**: an account id and, where they have one, a member id.
Never a name or a phone number.

## 4. `GET /activity` — per day

`registrations_per_day` (with the promoter/grassroot split),
`projects_submitted_per_day`, and `project_status_changes_per_day`.

`status_history_begins` tells you the earliest transition on record. Status
changes are captured from the day this shipped; projects created before then
have a status but no history of how they reached it. That cannot be
reconstructed, so it is reported rather than invented.

## 5. `GET /stakeholders` — counts, nobody named

Candidate and nominee totals: how many candidates, how many nominees, how many
of those are verified, how many candidates have nominated, how many have
submitted a project. **No candidate-level records** — the query reads counts
only, and there is a test that fails if it ever reads a name or a phone number.

## 6. `GET /all`

**Aggregates only.** Everything the dashboard needs in one call:

- `totals` — registered, verified, unit promoters, grassroots, and LGAs, wards
  and polling units reached
- `by_senatorial_district`, `by_lga`, `by_ward`, `by_polling_unit` — each a
  complete roll-up, never paged
- `projects` — one row each, with `complete` and `truncated` so you can tell
  whether you have the whole list
- `stakeholders` — candidate and nominee counts
- `activity` — per-day movement

**It carries no person-level data.** `/volunteers` is deliberately *not*
included: sending names and phone numbers that the consuming side filters out
on arrival would be an exposure that buys nothing. If you genuinely need to
match individuals against PDP membership, call `/volunteers` directly.

Projects are capped at 2,000 rows per call — page `/projects` for a full
extract. The area roll-ups are never truncated and each says `complete: true`.

---

## Three things 10x cannot answer

Returned as `null` with a reason in every payload's `not_available` block,
rather than omitted or guessed:

| Field | Why |
|---|---|
| `polling_unit_code` | **Join on `place_key` instead.** 10x stores geography by name, and its polling units are held alphabetically rather than in INEC unit order — a code derived from position would look right and be wrong, and you would attach results to the wrong unit without ever seeing it. Send an INEC code list and this gets filled from it. |
| `date_of_birth` | Never collected from members. The voter register has it, but that is a different population — matching the two is what this integration is for. |
| `progress_percent` | Not tracked. A project carries a status, not a percentage. |

`verified` exists for **people** (`status` on a volunteer), not for projects.


---

## Joining to your map: `place_key`

Every area and every project carries one:

```
kwara:kwara-central
kwara:akinyele
kwara:akinyele:ojo-emo-moniya
kwara:akinyele:ajibade-alabata-elekuru:agbedo-village
```

Case, punctuation and spacing are folded away, so `OJO-EMO/MONIYA` and
`Ojo Emo / Moniya` produce the same key. Build the same key on your side from
your own LGA, ward and polling-unit names and the join holds without either of
us agreeing on spelling.

It is **not** an INEC code and is deliberately not shaped like one.

## Getting a key

Platform accounts → **API keys** → *Create key*. It is shown once. Send it as:

```
X-API-Key: <key>
```

Server side only — the key must never reach a browser.

## A sample to build against

`kwarax10-all-sample.json` is a real `/all` response produced by this code, with
three LGAs, nine wards, eighteen polling units and two projects. Every section,
every field, the exact shape. Code against it now and switch the URL when the
key is issued.
