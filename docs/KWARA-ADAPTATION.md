# Kwara X10 — adaptation status

## Completed

- Supplied PDP logo and Kwara map; PDP labels, report fields, CSV columns,
  API routes, contact matching and database tables.
- Official INEC directory fetched on 4 October 2026: 16 LGAs, 193 wards,
  2,887 polling units. Codes use Kwara state code 23.
- Three senatorial districts, six federal constituencies, and the 24 Assembly
  seat names. Exact ward scope is enabled for whole-LGA Assembly seats.
- 5,222 named Kwara communities retrieved from GRID3. Ward hints are matched
  against INEC and are not proof of constituency boundaries.
- Coverage and programme targets use the Kwara ward and polling-unit counts.
- Inherited Oyo candidate, grassroots, voter-total and party-count datasets
  removed. No private roster is invented or renamed into a Kwara list.
- Missing PDP counts and voter sources are shown as not loaded.

## Sources

- Live polling directory: https://cvr.inecnigeria.org/pu
  Refresh: node server/fetch-kwara-polling-units.js
- Electoral totals: https://www.inecnigeria.org/wp-content/uploads/2024/02/2023-GENERAL-ELECTION-REPORT-1.pdf
- Senatorial/federal LGA composition: https://wp1.inecnigeria.org/wp-content/uploads/2019/02/2015-INFO-KIT-.pdf
  Historic constituency composition cross-checked against the current directory;
  historic polling-unit counts were not imported.
- Assembly seat names: https://hoa.kw.gov.ng/constituencies-and-contact/
- Communities: GRID3 Settlements_in_Nigeria ArcGIS service, selected by
  statename='KWARA'. Refresh: node server/build-communities.js

## Remaining inputs and limits

No files are needed to use the public Kwara location directory. Candidate and
PDP member records can be created through the existing account/registration
screens or imported later. Membership matching and individual voter validation
require their own authorised contact list or Kwara voter register.

Sixteen Assembly seats split an LGA. Their exact ward allocations remain
unverified and are excluded from the account-scope picker. The API rejects
creating or assigning those seat scopes, and scope resolution grants no wards
for them. A verified ward-to-seat mapping is needed to enable these scopes.

GPS screening uses a generous approximate Kwara envelope. A position inside
it is marked unavailable for exact state-boundary verification, not passed
as proof that it lies inside Kwara. GRID3 ward polygons can be synced through
the existing admin tools for ward pin checks.

The API still requires a separate PostgreSQL DATABASE_URL and KWARA_SECRET.
No database was configured or migrated during this adaptation. Use a fresh
Kwara database: the new PDP table names are not a migration of the Oyo database.

## Verification

Run the Kwara adaptation, PDP counts/contact matching, geography, spelling,
rate-limit and CSV tests. Other copied tests contain historic Oyo fixtures
and must be ported before they can serve as Kwara regression tests.
