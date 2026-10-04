# Hosting KWARA X10 for free

## Read this before picking a host

This app stores data in a **SQLite file on disk**. Most free tiers (Render's
free web service, Railway's free trial, Vercel, Netlify) give the container an
**ephemeral filesystem** — anything written to disk is wiped every time the
service redeploys, restarts, or wakes from sleep. Put this database on one of
those without a persistent volume and it looks fine in your demo, then comes
back empty the next day.

There are three honest ways to handle that, in order of how much it matters
that your data survives:

| Situation | What to do |
|---|---|
| Showing people the app, data can reset | Free tier, `SEED_ON_BOOT=1` (below) |
| Real registrations, must not disappear | A host with a **free persistent volume** — this is Fly.io |
| Real registrations, on Render specifically | Render's cheapest **paid** plan (~$7/mo) with a disk attached |

Everything below is wired up already: a `Dockerfile`, `render.yaml`, `fly.toml`,
and an `KWARA_DB` / `KWARA_UPLOADS` environment variable the server already reads
(see `server/db.js` and `server/index.js`).

---

## Option A — Fly.io (recommended: free *and* your data survives)

Fly's free allowance includes small persistent **volumes**, which is the piece
every other free tier is missing.

```bash
# once
curl -L https://fly.io/install.sh | sh
fly auth signup       # or: fly auth login

cd kwarax10
fly launch --no-deploy               # detects fly.toml, asks to confirm the app name
fly volumes create kwarax10_data --size 1 --region lhr
fly secrets set KWARA_SECRET="$(openssl rand -hex 32)"
fly deploy
```

That's it — `fly.toml` already points `KWARA_DB` and `KWARA_UPLOADS` at the mounted
volume and sets `SEED_ON_BOOT=1` for the first boot. After the first deploy,
turn seeding off so a later restart can never re-seed over real data:

```bash
fly secrets set SEED_ON_BOOT=0
```

Your app is live at `https://kwarax10.fly.dev` (or whatever name you chose).
`fly deploy` again any time you push changes.

---

## Option B — Render (easiest UI, free tier resets on redeploy)

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New → Blueprint** → point at the repo.
   Render reads `render.yaml` automatically.
3. It builds the `Dockerfile` and deploys. `KWARA_SECRET` is generated for you.

Free tier notes:
- The service **sleeps after 15 minutes idle** and takes ~30s to wake on the
  next request.
- The disk is ephemeral — a redeploy or a sleep/wake cycle can reset it.
  `SEED_ON_BOOT=1` is already set in `render.yaml`, so it comes back seeded
  with demo data rather than blank.
- **To keep real data**, switch `plan: free` to `plan: starter` in
  `render.yaml` and uncomment the `disk:` block, then set `SEED_ON_BOOT=0`.
  This is the cheapest paid tier (~$7/month) and is the option to use once
  you're collecting real registrations on Render.

---

## Option C — Railway

Railway's free trial credit works the same way as Render, minus the sleep:

```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway variables set KWARA_SECRET=$(openssl rand -hex 32) SEED_ON_BOOT=1
```

Railway also offers a **persistent volume** add-on (small monthly cost) — mount
it at `/data` and set `KWARA_DB=/data/kwarax10.db`, `KWARA_UPLOADS=/data/uploads`,
same as the Fly setup, if you want data to survive on Railway specifically.

---

## The database

PostgreSQL, reached through one environment variable:

```
DATABASE_URL=postgres://user:password@host:5432/dbname
```

Nothing else is needed. `server/db.js` creates and upgrades every table on
boot, so a blank database is a valid starting point. Two details specific to
managed providers, both already handled:

- **`?sslmode=require` is stripped from the URL.** Recent `pg` versions read
  it as `verify-full`, which checks the chain against the system CA store.
  DigitalOcean signs with its own CA that Node does not ship, so the
  handshake fails with *self-signed certificate in certificate chain*. TLS is
  decided in one place in `db.js` instead.
- **`DATABASE_CA_CERT`** is optional. Set it to the provider’s CA and the
  chain is verified properly; leave it unset and the connection is still
  encrypted, just without chain validation — which is what the providers’
  own connection snippets do.

The connection is pooled at 10 by default (`PGPOOL_MAX`), well under the
low-twenties cap on the smallest managed plans.

---

## Querying the database from a running container

There is no SQL editor in the DigitalOcean panel — for managed Postgres it
gives you connection details, users, backups and metrics, and no query
window. And the container is `node:24-alpine`: no `psql`, and `apt-get` is
not a command that exists in it.

What the container does have is node and the `pg` module the app already
depends on. `server/query.js` is the console built out of those. Open the
app’s **Console** tab in the panel (or `ssh` to the droplet) and run:

```bash
node server/query.js --tables
node server/query.js --describe=projects
node server/query.js "SELECT lga, COUNT(*) FROM projects GROUP BY lga"
node server/query.js -f report.sql --out=report.csv
```

`--tables` lists every table with its row count and size, which is the
fastest way to see what is actually in there. `--describe=NAME` prints one
table’s columns. `--out=FILE` writes CSV; `--csv` writes it to stdout so it
can be piped or redirected.

**It rolls back by default.** Every statement runs inside a transaction that
is rolled back unless `--write` is passed, and it says so when it discards
something. This points at production, where an `UPDATE` missing its `WHERE`
has no undo, so committing is the deliberate act:

```bash
node server/query.js "DELETE FROM projects WHERE import_batch = 'abc123'" --write
```

Run it once without `--write` first — the row count it reports is what
`--write` would change.

Two tables hold data that should not be casually exported: `voter_roll` is
real voters, and `members.account_number` / `bank_name` are the grassroots
influencers’ bank details. Query them, but do not leave a CSV of them on a
laptop.

---

## Before your first real deploy

1. **Set `KWARA_SECRET`** to a long random value. Every option above does this
   for you, but double-check it landed — the server prints a warning on boot
   if it's missing.
2. **Decide on `SEED_ON_BOOT`.** `1` while you're showing the app around, `0`
   the moment real names are in it — otherwise a redeploy on an ephemeral disk
   silently seeds demo data back in.
3. **Change the admin password** from `kwarax10-admin` immediately after your
   first login on the live URL.
4. **HTTPS.** Fly, Render and Railway all terminate TLS for you automatically
   — you do not need to configure certificates. Just don't put the app behind
   plain HTTP anywhere, since it collects NIN, PVC and bank details.
5. If you turn on the Paystack or NIN provider keys (see
   [DATA-SOURCES.md](DATA-SOURCES.md)), set them as **secrets**, not plain
   environment variables checked into a repo.

---

## Quick local check that mirrors the container

```bash
npm run build
KWARA_DB=/tmp/kwarax10.db KWARA_UPLOADS=/tmp/kwarax10-uploads SEED_ON_BOOT=1 \
  KWARA_SECRET=test-secret PORT=4000 npm start
curl http://localhost:4000/api/health
```

A `{"status":"ok","seeded":true,...}` response means the same thing will happen
on the host you choose.

---

## BSA-YV grassroot accounts

`server/data/bsa-yv-members.js` holds the 2,103 BSA-YV members. On boot the
server creates a Grassroot login for each one, once per database (an audit_log
row marks it done, so deleted accounts are not recreated). Username is the
member's phone number, or `bsayv-<S/N>` where the sheet has no valid unique
phone. Everyone starts on `Password1234` and must change it at first sign-in.

| Variable | Default | Effect |
|---|---|---|
| `GRASSROOT_PASSWORD` | `Password1234` | Starting password for the import |
| `GRASSROOT_IMPORT_ON_BOOT` | on | Set `0` to skip the boot import |

Run it by hand instead with `npm run seed:grassroots` (`--dry-run`,
`--reset-passwords`).

## GRID3 ward boundaries (project map)

The project map outlines the chosen ward from GRID3 and warns when a project
pin is outside it. On boot the server tries to pull Kwara's wards from the GRID3
ArcGIS service once; if that fails, go to **Platform accounts → GRID3 ward
boundaries** and either press *Sync from GRID3* or upload the ward boundaries
GeoJSON downloaded from data.grid3.org.

| Variable | Default | Effect |
|---|---|---|
| `GRID3_WARDS_URL` | GRID3 NGA operational wards FeatureServer layer | Where *Sync* reads from |
| `GRID3_SYNC_ON_BOOT` | on | Set `0` to skip the boot sync |

## INEC voter register (confirming nominees)

Once the register is loaded, **every nominee is checked against it**: a PVC/VIN
that is not in the register — or a row with no VIN at all — is listed back to
the candidate and not added, whether it came through the form or a spreadsheet.
Until it is loaded, nothing changes and the check reports "not configured".

Load it on the server, not from a laptop — it is 3.27 million rows and needs a
direct database connection:

```bash
node server/load-voter-roll.js /path/to/Kwara_Voter_Register_Master.xlsx --truncate
```

| Flag | Effect |
|---|---|
| `--truncate` | Empty `voter_roll` first, rather than merging into it |
| `--batch=NAME` | Label the load; shows up under Admin → Data sources |
| `--limit=N` | Stop after N voters, for a trial run |
| `--dry-run` | Parse and report, write nothing |

Expect **twelve to fifteen minutes**. The workbook is 235 MB of zip that
expands to 2.4 GB of XML across four sheets (Excel caps a sheet at 1,048,576
rows), so it is streamed rather than loaded — memory stays flat.

**Only five fields are imported**: the voter ID, the name, and the LGA, ward and
polling unit. The register also carries date of birth, phone number, home
address, occupation and disability status for every voter in the state. None of
that is needed to answer "is this VIN real, and is it in the unit this person
claims", so none of it is stored. Do not widen the loader without a reason that
survives being read aloud.

Two notes on matching:

- VINs in the real register are **19 or 20 characters** (93.2% / 6.8% over a
  200,000-row sample). A rule of exactly 19 would reject one genuine voter in
  fifteen.
- A VIN that is in the register but under a **different polling unit or
  surname** is reported as a discrepancy, not a refusal. Register spellings are
  not INEC's ward names, and the register is a snapshot that people move out of.

### Auditing who is already registered

Read-only. Run it after loading the register, before deciding how strict to be:

```bash
node server/audit-voter-roll.js --out=register-audit.csv
```

It reports every existing member as one of: in the register, no VIN recorded,
VIN not found, in the register but at another polling unit, or under another
surname — with a per-candidate breakdown of who has the most that would not
pass. **It changes nothing**: no statuses, no flags, no deletions. Nobody
should be taken off a list of real people on the strength of a report nobody
has read. `--level=mobiliser` narrows it to nominees; `--limit=N` to a sample.

VINs in the report are masked to their last four characters. The file gets
emailed around, and a full VIN is the one thing in it that would let somebody
else's list be filled in from it.

### When a VIN does not match

The importer falls back to asking the register the other way round: who does it
have of that surname, in that polling unit? Across the register, surname plus
polling unit identifies exactly one voter **98.7%** of the time, so a single
match is worth showing — and nowhere near certain enough to accept on. The row
stays refused; the candidate is told "the register does have an Adebayo
Ogundimu in that polling unit, with VIN …3903 — check the card". A mistyped VIN
is commoner than an invented nominee, and a bare "not found" gives nobody a way
to tell the two apart.

Two or more people of that surname in the unit, and no VIN is offered at all.

The fallback finds its match for about **86%** of entries, because the register
labels polling units its own way and agrees with INEC's naming that often. LGA
names are mapped on the way in (the register writes "ogbomoso north" and
"oorelope"), but ward and polling-unit labels are stored as the register gives
them.

### Loading it without server access

If you cannot reach the database directly — the cluster firewall lists a few
addresses, and the hosting account may belong to someone else — load it from
the app instead:

**Platform accounts → INEC voter register** → choose `Kwara.csv` → *Load the
register*.

The file is read in the browser in 8 MB slices and sent up 2,000 rows at a
time, so nothing is uploaded whole and no request is large. Keep the tab open;
expect ten to twenty minutes. Re-running a slice is safe — rows are keyed on
the VIN and overwritten rather than duplicated — so a dropped connection can be
restarted without making a mess.

Use the **CSV**, not the workbook: a browser cannot expand 2.4 GB of sheet XML.

The same five fields, and only those five, leave the page. Date of birth, phone
number, home address, occupation and disability status are dropped in the
browser and never cross the network.
