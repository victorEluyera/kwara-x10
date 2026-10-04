# 10X dashboard integration contract (version 2.0)

Implemented locally; deployment is required. Server-to-server, read-only JSON.

Base URL after deployment: `https://kwarax10.kwaraahead.com/api/external/v1`.

Create a key in **Platform accounts > External API keys**. Copy it when issued
and store it only in the receiving backend's `KWARA10X_API_KEY` environment variable.
Set `KWARA10X_API_URL` to the base URL above. Send `X-API-Key: <key>`.
No new key has been issued or shared by this change.

## Main request

`GET {baseURL}/all`

This is a complete snapshot: `limit`, `offset` and `since` do not reduce it.
There are no member-level rows or original free-text answers in this response.
It is cached for 30 seconds, concurrent loads are deduplicated, and internal
mutations invalidate the cache.

| Screen | JSON fields |
| --- | --- |
| Overview | `summary.totals`, `summary.coverage`, `summary.projects` |
| Insights map | `coverage.by_lga`, `coverage.by_ward`, `coverage.by_polling_unit` |
| Project map | `projects.rows`, including `id`, location, `status`, `estimated_cost` |
| Sentiment / field work | `field_work.questions`, `field_work.by_location`, `field_work.issues_and_needs`, `field_work.sentiment`, `field_work.responses_by_date` |
| Freshness | `generated_at`, `last_updated_at` |

The existing receiving sanitizer already understands `summary`, `coverage` and
`projects.rows`. **It must be extended to retain `field_work`**; it currently
discards that property. It also currently discards area costs and ward codes.
Use a whitelist of the aggregate fields documented here when extending it.
Do not request `/volunteers`, `/registrations` or `/surveys` for these dashboards.

## Overview and area counts

Totals: `registered`, `unit_promoters`, `grassroots`, `volunteers` (alias for
grassroots), `verified`, `pending`, `flagged`, `rejected`.
Those four status counts are the stored member status, not contact-centre results
and not VIN-verification results; they must be labelled accordingly.
`summary.promoters_by_status` and `summary.volunteers_by_status` separate those
statuses by role; area rows expose corresponding `promoters_*`/`volunteers_*` counts.

Areas include `members`, the same status/level counts, `projects`,
`estimated_cost` (NGN), and `projects_without_cost`. Missing estimates are not
invented; the numeric sum contains known estimates only. Official ward identifiers
are `ward_code`, e.g. `30/01/01`; polling-unit identifiers are
`polling_unit_code`, e.g. `30/01/01/001`. Codes are strings and retain zeroes.
Names are canonicalised using the local INEC directory and existing variants.
Unresolved places remain in totals with null codes, and do not inflate official
ward/PU coverage. Coverage means at least one member in a recognised place,
distinct from the programme's 10-promoter PU saturation threshold.

Project stages: `submitted`, `not_started`, `ongoing`, `completed`, `other`.
Requests and legacy promises map to submitted; approved/planned/pending map to
not_started; delivered maps to completed. `source_status` preserves the original.
Estimated cost uses the same saved total or item-cost catalogue as the dashboard.
`projects.rows` contains every eligible project, not a capped page.
`projects.complete=true`, `truncated=false`, `next_offset=null`.
Legacy `projects.projects` and `by_lga/by_ward/by_polling_unit.areas` remain available.

## Field-response aggregates

`GET {baseURL}/field-work` also returns just the `field_work` section.

Each question includes task/question identifiers and labels, response counts,
and `answers: [{ value, responses }]` for recognised questionnaire options.
`by_location` includes the same question distributions plus location codes and
response totals. `first_collected_at`, `last_collected_at` and
`responses_by_date` describe collection times; reporting days use Africa/Lagos.
All stored survey submissions with answers are counted, including pending and
rejected submission reviews. These are submitted responses, not approval counts.
Malformed answer payloads are reported separately.

`issues_and_needs` includes community-problem/need question options and simple
documented keyword categories from free text (water, roads, electricity,
healthcare, education, security, jobs, sanitation). It is descriptive topic
extraction, not an AI interpretation. Each topic counts a response at most once;
different topics can count the same response. Original free text is never sent.

`sentiment` counts only explicit sentiment/satisfaction question options.
`sentiment_available=false` means no such answered question is present. A needs
survey alone cannot provide a genuine sentiment score. Do not replace missing
sentiment with promoter/project activity or online sentiment from another source.
Multi-choice question totals can exceed the number of respondents.

## PDP / 10X promoter overlap

`summary.totals.pdp_10x_promoters` is the number of distinct normalised name/phone
identities that are both promoters and present in the supplied PDP contact list.
`pdp_promoter_overlap` describes the method, source record count and load date;
`matched_promoter_records` separately counts matching registration records before
deduplication. Absence of a match does not establish non-membership.

Area PDP totals cannot establish this overlap. After deployment, an administrator
loads the original PDP contact CSV using **Load / update PDP matching list** on the
dashboard. The existing nine-column headerless contact file is supported, as are
CSV files with `name`/`phone` headers. Matching uses both fields; it does not use
fuzzy names, ward counts or a shared phone alone. Source names/phones are converted
to private keyed matching hashes held only in the database, not shipped in the API
or bundled into source code. The count indicates a match to the supplied list,
not independent confirmation of party membership.

If that source has not been loaded, `loaded=false` and the count is `null`, not zero.
The API overlap excludes test promoters and test owners. SIGAR must also whitelist
the new total if it wants to display it; its current reader does not retain it.

## Test records and privacy

Members, owners, projects, tasks, submissions and collectors marked `is_test=1`
are excluded. Names/titles starting with `Test` as a word, or containing
`(delete me)`, are also excluded. Arbitrarily named test records must be explicitly
marked; the API cannot recognise them from their names alone.

No NIN, bank details, individual PVC/VIN, member phones, member names or precise
GPS coordinates are emitted by `/all` or `/field-work`.
`last_updated_at` uses persisted record/audit times (not the response clock);
`generated_at` is the cached snapshot generation time.

Other older endpoints retain their own contracts; the old integration documents
describe those individually. The aggregate snapshot above is the preferred
contract for Overview, Insights map and 10X field-work sentiment.
