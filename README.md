# Fetman Digital Website

This repository contains the public-facing Fetman Digital website.

## Contents

- `index.html` - Main website
- `maintenance.html` - Maintenance page
- `Branding img/` - Branding assets
- `logo img/` - Logo assets
- Image files in the project root - Website imagery
- `*-480.jpg` and `*-1200.jpg` files in the image folders - Responsive portfolio derivatives; the original artwork is retained
- `Fetman Digital website background-optimized-*.jpg` - Responsive, compressed hero backgrounds
- `_headers` - Netlify cache policy for static images; HTML is not given a long-lived cache rule

## Running locally

Open `index.html` in a web browser.

For more reliable local testing, serve the project directory using a static HTTP server or a development server that does not require a backend.

## Deployment

Deploy the website files and their required assets to a static hosting provider.

Ensure that the HTML, images, CSS, JavaScript, and other referenced assets are uploaded with their original relative paths.

## Architecture

The public website remains at the repository root and is independent of
the management-system frontend in `management-frontend/` and API backend
in `backend/`.

The backend directory contains the management API foundation and manually
reviewed MySQL migrations. The separate management application remains
independent of the public website.

## Local management system

This local management login is separate from the public site. MySQL 8.4
must be running, and the `fetman_management` database plus the limited
`fetman_app` account must already exist. The authentication schema has not
been applied automatically.

### Configure the backend

In a Windows PowerShell terminal at the repository root:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
notepad .\backend\.env
```

Set the local `DB_HOST`, `DB_PORT`, `DB_NAME`, and `DB_USER` to match the
existing MySQL setup. For verified local TLS, use `DB_HOST=localhost` and set
`DB_TLS_CA_PATH` to the absolute path of the locally provisioned CA certificate.
The MySQL server certificate must be signed by that CA and contain
`DNS:localhost` in its Subject Alternative Name. The backend verifies both the
CA chain and server identity; do not disable either check. Keep
`DB_PASSWORD` and `SESSION_SECRET` private in this ignored file. Set
`SESSION_SECRET` to a new random value of at least 32 characters. Generate one
locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Keep the generated value and database password only in the ignored
`backend\.env` file. Never paste them into chat or commit them.

### Provision verified local MySQL TLS

Before starting the backend, provision a dedicated local CA and a MySQL server
certificate signed by it. The server certificate must contain
`DNS:localhost` and `IP:127.0.0.1` SANs. Keep the CA signing key protected and
outside the MySQL service-readable certificate directory; the backend needs
only the public CA certificate. Do not reuse or overwrite MySQL's existing
auto-generated certificate/key files.

Before changing MySQL TLS settings, make a restricted, timestamped backup of
`C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` and the existing TLS
certificate/key files, preserving their ACLs. Configure the new CA, server
certificate, and server key paths under `[mysqld]`, and grant the MySQL
`NT AUTHORITY\NetworkService` account only the read access needed for those
files. Then restart the `MySQL84` service and verify it starts with the new
certificate. If it does not, restore the `my.ini` backup and restart; the old
certificate files should remain untouched for rollback.

Set `DB_HOST=localhost` and `DB_TLS_CA_PATH` in `backend\.env` to the local
certificate paths shown by `backend\.env.example`. The backend trusts that CA
and requires both certificate-chain and hostname verification. Never set
`rejectUnauthorized` to false or disable identity verification.

### Review and apply the authentication schema

Before applying anything, inspect the current `fetman_management` schema
and verify that neither `management_users` nor `management_sessions`
already exists. The prepared file
[`backend/migrations/001_developer_auth.sql`](./backend/migrations/001_developer_auth.sql)
creates only those two tables: one for user identities, Argon2id password
hashes, roles, account status, and timestamps; and one for persistent
server-side sessions and expiry indexes. It does not create a database or
change MySQL users or grants.

No migration or schema SQL has been executed by the application. Only
after reviewing and approving the file, run it manually with a separately
authorized schema administrator from PowerShell:

```powershell
Get-Content -Raw .\backend\migrations\001_developer_auth.sql |
  & 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe' `
    --user=YOUR_SCHEMA_ADMIN --password --database=fetman_management
```

The MySQL client prompts privately for the administrator password. Do not
use `fetman_app` for schema changes, do not provide a password on the
command line, and do not share the administrator password. Afterward, the
application account needs only its existing `SELECT`, `INSERT`, `UPDATE`,
and `DELETE` privileges on these tables.

### Start the local applications

Start the backend in one PowerShell terminal:

```powershell
npm --prefix .\backend run dev
```

The API listens at `http://localhost:3000`. It fails safely if required
configuration is missing or MySQL cannot be reached.

Start the frontend in a second terminal:

```powershell
npm --prefix .\management-frontend run dev -- --host localhost
```

Open `http://localhost:5173/login`. The Vite development server proxies API
requests to `http://127.0.0.1:3000`.

### Create and verify the initial Developer account

After the schema is applied and the backend environment is configured,
run this once from the repository root:

```powershell
npm --prefix .\backend run bootstrap:developer
```

The command uses the configured initial email, asks for a password and
confirmation in hidden terminal input, requires 15–128 characters, and
stores only an Argon2id hash. It refuses to create another initial
Developer. It does not reset or overwrite accounts. Never put the password
in a command, source file, or environment variable.

Sign in at `http://localhost:5173/login`; the email is suggested and the
password is not prefilled. Refresh `/developer` to verify the server-side
session persists. Use **Log out**, then open `http://localhost:5173/developer`
again; the API should reject the unauthenticated request and the frontend
should return to login. A direct API check, without credentials, should
return `401`:

```powershell
Invoke-WebRequest http://localhost:3000/api/developer/dashboard
```

The Developer dashboard shows live API/database health state. The local
system is not production ready.

### Developer user management

From the Developer workspace, open **USER MANAGEMENT** to search by email,
filter by role or account status, add users, edit existing accounts, and
activate/deactivate access. The backend enforces Developer-only access,
validates changes, hashes initial passwords with Argon2id, and prevents
deactivating or demoting the last active Developer. Existing records and
their task/content history are retained when an account is deactivated;
protected requests re-check account status and reject inactive sessions.

Only the roles already implemented by the application can be assigned:
`Developer` and `Graphic Design`. Names, IT, Finance, and password invitation
email are not implemented. When creating an account, a Developer supplies an
initial password of at least 15 characters; it is stored only as an Argon2id
hash. The application does not email or later display the password.

Developers can reset another account's password from User Management; they
cannot use that action on themselves or reset the sole active Developer.
The backend preserves the target's role and account status, invalidates the
target's existing sessions, and emits a security audit event without
credentials or session data. Communicate temporary passwords separately
through an approved secure channel. Authenticated users can change their own
password after verifying their current password; the current session is
rotated and other sessions are invalidated. Both flows require passwords of
at least 15 characters and use Argon2id.

New accounts and administrator-reset accounts must change their temporary
password before protected APIs or department workspaces are available. This
requires the reviewed migration
[`backend/migrations/003_password_change_required.sql`](./backend/migrations/003_password_change_required.sql).
It adds a `TINYINT(1)` flag with a default of `0` (existing accounts are
unchanged); account-creation and reset flows explicitly set it to `1`.
**The migration has not been applied. Do not apply it without explicit
approval and inspection of the existing schema.** Until it is approved and
applied, the updated backend's login, account creation, reset, and password
change queries require this column and will not work against the old schema.
The runtime uses its existing table DML privileges; no additional privilege
type or wider grant is requested.

Reset audit events are written to the backend log without credentials or
session data and are not retained in a dedicated audit table.

### Graphic Design content publishing

The public site at the repository root remains a separately deployed static
site. The Graphic Design Portal now stores draft and published portfolio
content in the existing MySQL content table. The public site requests
`/api/public/design-portfolio`, updates matching legacy cards by stable key,
adds newly published cards, and removes unpublished managed cards. Its
original hardcoded cards remain intact as a fallback if the API is unavailable.
Drafts remain private; authenticated previews do not publish them.

After inspecting and backing up the database as appropriate, manually apply
[`backend/migrations/002_graphic_design.sql`](./backend/migrations/002_graphic_design.sql)
if the Graphic Design tables do not already exist, create an active
Graphic Design user, then apply
[`backend/migrations/004_graphic_design_publishing.sql`](./backend/migrations/004_graphic_design_publishing.sql).
The latter seeds the current eleven portfolio cards without deleting existing
rows. Do not re-apply `001_developer_auth.sql`; if any expected table or
publishing column already exists, inspect and reconcile it before proceeding.
Migrations are never run automatically.

From the repository root, after that inspection and approval, the migration
can be run from PowerShell with:

```powershell
Get-Content -Raw .\backend\migrations\002_graphic_design.sql |
  & 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe' `
    --user=YOUR_SCHEMA_ADMIN --password --database=fetman_management
```

The MySQL client prompts privately for the administrator password. Never
use the runtime account for schema changes or put a password on the command
line.

After creating a Graphic Design account, apply the publishing migration with
the same authorized schema administrator:

```powershell
Get-Content -Raw .\backend\migrations\004_graphic_design_publishing.sql |
  & 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe' `
    --user=YOUR_SCHEMA_ADMIN --password --database=fetman_management
```

Migration 004 creates and removes a temporary stored procedure while
conditionally adding its columns; the schema administrator needs routine
creation privileges. Confirm it completed before restarting the API.

An authorised system owner can create each staff login locally:

```powershell
npm --prefix .\backend run create:graphic-designer
```

The command prompts for an email and hidden password/confirmation, requires
a 15–128 character password, and stores an Argon2id hash. Run it only on the
trusted local management machine after verifying staff authorisation. It
creates an active `Graphic Design` role and does not change Developer
accounts. Staff can sign in at `http://localhost:5173/login`; their session
routes to `/graphic-design`. The backend independently enforces the role and
restricts task, asset, and content queries to that staff member.

The dashboard supports assigned task status changes, progress/revision
notes, private image uploads, and versioned portfolio drafts with
authenticated previews, publication, and unpublishing. Uploads accept JPEG,
PNG, or WebP up to 5 MB and are stored under the ignored
`backend/secure-uploads/` directory, not the public website. An uploaded
image becomes publicly readable only while referenced by published content.
Draft removal requires confirmation and preserves a revision entry. Graphic
Designers can create tasks for themselves; a manager-facing task assignment
interface is not part of this phase.

Run the backend tests and management frontend checks from the repository
root:

```powershell
npm --prefix .\backend test
npm --prefix .\management-frontend test
npm --prefix .\management-frontend run build
npm --prefix .\management-frontend run lint
```

Publishing endpoints require the manual migrations and corresponding
least-privilege grants before they can be used with MySQL.

For public publishing, deploy the backend behind a secure, public HTTPS
reverse proxy or another approved API host; the current server listens on
`127.0.0.1` and is not directly reachable from the static Netlify website.
The public site defaults to a same-origin `/api` path. If the API is hosted on
a different origin, set the `design-api-base` meta tag in `index.html` to that
HTTPS API origin and add the exact public-site origin to backend
`CORS_ORIGINS`. The unauthenticated public routes expose only published
content and assets referenced by that content. Do not put credentials or
deployment tokens in the static site. No production deployment was performed.
