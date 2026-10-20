# Database migrations

Store schema changes here as ordered, versioned SQL files.
`001_developer_auth.sql` creates the shared `management_users` and
`management_sessions` tables. User roles are stored in the existing
`management_users.role` column; Graphic Design accounts use the value
`Graphic Design`.

`002_graphic_design.sql` adds the department's tasks, progress updates,
private asset metadata, draft content, and content revision history. It
does not change the public website or create another user/session table.

`003_password_change_required.sql` adds
`management_users.password_change_required` with a default of `0`, so
existing accounts continue to work unchanged. New accounts created by the
Developer Portal, bootstrap script, or Graphic Design account script, and
accounts reset by a Developer, are explicitly marked `1`. The backend blocks
all non-authentication API routes for these accounts until their password is
changed. The reverse script is
`003_password_change_required.rollback.sql`; dropping the column removes
pending-change state, so inspect and resolve all pending accounts before
considering rollback.

The runtime database user is limited to data operations. Apply schema
migrations manually with a separately authorized database account after
review. Inspect the schema before applying each file. Do not re-run the
authentication migration if its tables already exist. Do not apply the
Graphic Design migration if any of its five tables already exist; inspect
and reconcile the schema first. This project does not execute migrations
automatically.

Do not apply migration 003 without explicit schema-change approval. If it is
approved, inspect that the column is absent before applying it once. The
runtime account will need the existing `SELECT`, `INSERT`, and `UPDATE`
privileges on `management_users`; no new privilege type or wider grant is
needed.

Grant the runtime account only the required `SELECT`, `INSERT`, `UPDATE`,
and `DELETE` privileges on the Graphic Design tables, if it does not
already have them. Preserve its existing host restriction and all other
privileges; never grant database-wide or global access for this feature.
