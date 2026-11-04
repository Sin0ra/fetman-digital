# Hostinger deployment

This repository is one Node.js application. The backend serves the public site
at `/`, the maintenance page when enabled, the Developer Portal at `/login` and
`/developer`, and the API under `/api`.

## Application settings

Use the repository root as the application root:

```text
Build command: npm ci && npm ci --prefix backend && npm ci --prefix management-frontend && npm run build
Start command: npm run start
Node.js: 22.x
Entry file: backend/src/server.js
Host: 0.0.0.0
Port: Hostinger-provided PORT
```

The root `npm run build` builds the React portal into `management-frontend/dist`.
The backend then serves that build and the public website from the same process.

## Environment variables

Set these in Hostinger's environment-variable panel, not in Git:

```text
NODE_ENV=production
PORT=<Hostinger-provided PORT>
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=3306
DB_NAME=<fresh MariaDB database>
DB_USER=<least-privileged runtime user>
DB_PASSWORD=<runtime user password>
DB_TLS_MODE=loopback-plaintext
SESSION_SECRET=<random value of at least 32 characters>
MEDIA_DIRECTORY=/home/<hostinger-user>/fetman-digital-media
CONTACT_RECIPIENT_EMAIL=info@fetmandigital.com
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

`DB_TLS_MODE=loopback-plaintext` is accepted only for `localhost`, `::1`, or a
127.x loopback address. For a remote Hostinger database hostname, use
`DB_TLS_MODE=required`; TLS certificate files are optional when the server
certificate is trusted by the Node.js runtime, and a supplied absolute CA path
may be set with `DB_TLS_CA_PATH`. Remote plaintext is rejected. Confirm the
exact hostname, port, TLS support, and certificate/CA requirements in
Hostinger before starting the application.

`MEDIA_DIRECTORY` must be an absolute directory outside the release checkout.
The application creates it with private permissions and refuses to start when
it cannot be created or written.

## Database setup

Back up any existing database first with `mysqldump`, create a separate fresh
MariaDB database, and apply only `backend/migrations/000_fresh_portal_schema.sql`
with an authorized schema user. Do not delete the old Hostinger database.
After the schema is ready, run the one-time owner setup from the application
environment:

```bash
npm --prefix backend run bootstrap:developer
```

It creates only `sinoworkguma@gmail.com`, asks for the owner's password twice,
requires at least eight characters, and refuses to run again once the account
exists. No default password or public registration exists.

## SMTP

Until SMTP variables are supplied, enquiries are saved and the API reports that
email delivery is not configured. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASSWORD`, and optionally `SMTP_FROM`, then test the contact
form on the temporary Hostinger URL. Do not configure the final domain, DNS, or
business email as part of this deployment.

Maintenance mode is changed from the authenticated Developer Portal. It is
stored in MariaDB, blocks public website/API paths with the maintenance page,
and leaves health, authentication, and portal paths accessible.
