# Hostinger Node.js Web App deployment

This procedure follows Hostinger’s official [Node.js web app deployment
guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
and [Node.js/MySQL connection guide](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/).

This repository is prepared for one Hostinger Node.js Web App and one HTTPS
origin. The backend process serves, in order:

1. `/api/*` Express routes and JSON API 404s;
2. the management portal shell at `/login`, `/set-password`,
   `/developer`, `/developer/users`, `/developer/maintenance`, and
   `/graphic-design`, plus its Vite assets;
3. the root public website, protected by the database-backed maintenance
   check.

The existing Netlify deployment is not changed by this setup. Keep it intact
until the Hostinger origin has been tested and explicitly approved.

## Hostinger application settings

Use the repository root—the directory containing the root `package.json`—as
the Hostinger application root. The root package is the deployment entrypoint;
do not point Hostinger directly at `backend/src/server.js`.

Configure:

- Build command: `npm ci && npm ci --prefix backend && npm ci --prefix management-frontend && npm run build`
- Start command: `npm run start`
- Framework: Express.js backend with a Vite/React frontend build; if Hostinger
  requires manual framework selection, use the supported Express.js/Other
  option rather than treating this as a static React site
- Node.js: `22.x` (declared in the root `package.json` and supported by Hostinger)
- Output directory: `management-frontend/dist`
- Entry file, if Hostinger requests one: `backend/src/server.js`
- Application URL: the HTTPS origin assigned to this app
- Do not configure a second public-site process or a second public-site port

The build command creates `management-frontend/dist/index.html` and its
hashed assets during deployment. `backend/src/server.js` resolves that exact
directory relative to the backend source. The generated output is intentionally
ignored by Git; production startup depends on the Hostinger build step, not on
a developer having built it locally.

Hostinger supplies `PORT`. The server binds `HOST`, defaulting to
`0.0.0.0`, which is required for the managed Node.js runtime. Do not replace
the supplied port with a fixed port.

## Required environment variables

Set these in Hostinger’s environment-variable UI. Do not put values in Git or
in deployment commands.

```text
NODE_ENV=production
PORT=<Hostinger-provided application port>
HOST=0.0.0.0
CORS_ORIGINS=https://<this-application-origin>
DB_HOST=127.0.0.1
DB_PORT=3306
DB_TLS_MODE=loopback-plaintext
DB_NAME=<existing management database name>
DB_USER=<least-privileged existing runtime user>
DB_PASSWORD=<runtime user password>
SESSION_SECRET=<random secret of at least 32 characters>
```

If the public site remains on an approved Netlify origin and still calls this
API, include that exact HTTPS origin in `CORS_ORIGINS`, comma-separated. Do not
use `*` with credentialed requests.

Hostinger’s official Node.js/MySQL documentation specifies `127.0.0.1` as the
database host, port `3306`, and warns that `localhost` resolves to `::1` for
Node.js 17+. For this account, Hostinger has additionally indicated that the
managed local connection does not provide the remote TLS configuration used
by this project. The Hostinger-specific configuration therefore explicitly
uses `DB_TLS_MODE=loopback-plaintext`; this is not a silent fallback.

This mode is accepted only for literal loopback IPs (`127.x.x.x` or `::1`),
and the database traffic is not encrypted in transit. Keep
`DB_TLS_MODE=required` plus an absolute `DB_TLS_CA_PATH` for every remote
database host; remote plaintext is rejected and remote certificate-chain and
identity verification remain mandatory. If Hostinger support gives different
network or TLS instructions for this account, stop and reconcile them before
changing these settings.

## Database and release safety

The server performs startup checks for `management_users`,
`management_sessions`, and the singleton `site_maintenance_settings` row. A
new empty database therefore cannot start the application successfully. The
server never runs migrations.

Before an approved release, an authorized database administrator must
independently inspect the target schema and apply only the reviewed migrations
that are missing, in dependency order:

1. `001_developer_auth.sql`
2. `003_password_change_required.sql`
3. `002_graphic_design.sql`
4. `005_site_maintenance.sql`
5. Create the initial Developer account with the interactive
   `npm --prefix backend run bootstrap:developer` command.
6. Create an authorized Graphic Design account with
   `npm --prefix backend run create:graphic-designer` if the portal is needed.
7. Apply `004_graphic_design_publishing.sql` after the Graphic Design account
   exists, if published CMS portfolio records are required.

Inspect each target schema before applying a migration; do not apply any file
twice. Use a separately authorized schema account for migrations and the
interactive account-creation commands only after the schema is ready. Do not
use the runtime account for schema changes. Do not reset users, passwords,
maintenance mode, or sessions as part of deployment.

Before switching traffic, verify on a non-production or approved preview
origin:

- `/` serves the public site while maintenance is off;
- maintenance mode serves only `maintenance.html` for public paths and still
  leaves the authenticated management portal reachable;
- `/login` and every listed portal route refresh directly;
- `/api/health` and an unknown `/api/*` path return JSON;
- private upload, backend source, dependency, `.env`, and configuration paths
  return 404;
- authenticated login, CSRF, session persistence, and role restrictions work;
- the database connection uses the approved Hostinger-local mode and reaches
  only `127.0.0.1:3306`;
- if a remote database host is ever configured, it uses the supplied CA with
  certificate-chain and identity verification.

Do not deploy, change DNS, modify the live database, or alter the existing
Netlify deployment as part of this preparation.
