# Kwara X10

Community engagement and intelligence application adapted from Oyo 10x,
using PDP Kwara branding and official Kwara location data.

See [adaptation status and sources](docs/KWARA-ADAPTATION.md) for completed
conversion, missing private datasets, and unverified split Assembly scopes.

## Local setup

Install root and client dependencies with npm install and npm --prefix client install.
Set DATABASE_URL to a separate PostgreSQL database and set KWARA_SECRET.
Run npm run seed to create administrator accounts, then npm run dev.
The seed prints generated administrator passwords. Do not use the Oyo database.

For a frontend build: npm run build. For production: npm start after setting
NODE_ENV=production, DATABASE_URL, and KWARA_SECRET.

Candidate and member rosters start empty; add accounts through the admin UI.
Kwara PDP membership totals and voter-register data remain not loaded until
real sources are imported.

## Neon database + Render application

Create a separate Neon project for Kwara X10. In Neon, open Connect and copy
its PostgreSQL connection string. Keep the connection string in Render's
DATABASE_URL environment variable. Render's blueprint prompts for this value
and ADMIN_PASSWORD; it generates KWARA_SECRET automatically.

Deploy this repository as a Render Blueprint using render.yaml. It creates
one Docker web service and does not create a Render database. Express serves
the built React frontend and /api routes on the same service URL.

The API creates its PostgreSQL schema on startup. With SEED_ON_BOOT=1, an
empty database receives administrator accounts. Sign in as admin with the
ADMIN_PASSWORD value entered in Render. Candidate and member lists start empty.

Neon documentation: https://neon.com/docs/connect/connect-from-any-app
Render Blueprint documentation: https://render.com/docs/infrastructure-as-code

Deployment has not been performed and a Neon connection has not been tested.
# kwara-x10
