# Fetman Digital

Fetman Digital is a same-origin Node.js website with a public creative-agency
homepage and a single-owner Developer Portal.

## Local setup

1. Create a fresh MariaDB database and apply only
   [`backend/migrations/000_fresh_portal_schema.sql`](./backend/migrations/000_fresh_portal_schema.sql).
2. Copy [`backend/.env.example`](./backend/.env.example) to `backend/.env` and
   set the database values plus a random `SESSION_SECRET`.
3. Install and build:

   ```bash
   npm ci
   npm ci --prefix backend
   npm ci --prefix management-frontend
   npm run build
   ```

4. Create the sole owner account:

   ```bash
   npm --prefix backend run bootstrap:developer
   ```

5. Start the unified application:

   ```bash
   npm run start
   ```

Open `/` for the website and `/login` for the Developer Portal.

The bootstrap command creates only `sinoworkguma@gmail.com`, stores an Argon2id
hash, requires an owner-selected password of at least eight characters, and
refuses to run after the account exists. There is no public registration,
default password, employee account, or second administrator.

## Portal scope

The portal edits homepage copy, service descriptions, calls to action, contact
details, portfolio projects, secure image uploads, and the MariaDB-backed
maintenance switch. Unpublished portfolio projects are private. Maintenance
mode leaves health checks, authentication, and the portal reachable.

## Database and deployment

Use [`backend/migrations/README.md`](./backend/migrations/README.md) for backup,
fresh-schema, and local replacement instructions. Use
[`HOSTINGER-DEPLOYMENT.md`](./HOSTINGER-DEPLOYMENT.md) for Hostinger's build,
start, environment, SMTP, and loopback MariaDB settings.

SMTP is intentionally unconfigured until credentials are supplied. Enquiries
are validated and saved; the API reports that delivery is not configured rather
than claiming an email was sent.

Do not commit secrets, delete the old Hostinger database, change DNS, deploy, or
configure the final domain as part of local development.
