# Database migrations

Store schema changes here as ordered, versioned SQL files.
`001_developer_auth.sql` creates the shared `management_users` and
`management_sessions` tables. User roles are stored in the existing
`management_users.role` column; Graphic Design accounts use the value
`Graphic Design`.

`002_graphic_design.sql` adds the department's tasks, progress updates,
private asset metadata, draft content, and content revision history. It
does not change the public website or create another user/session table.

`004_graphic_design_publishing.sql` incrementally adds publication status,
portfolio ordering, category, tags, and stable source keys to Graphic Design
content. It adopts the eleven existing static portfolio cards as published
records for the first active Graphic Design account, preserving their current
titles, descriptions, categories, and image paths. It is safe to re-run: added
columns are conditional and seeded rows use unique source keys. Create an
active Graphic Design account before applying it; if no such account exists,
the legacy portfolio rows are not seeded. Existing content rows are not
deleted or replaced.

`005_site_maintenance.sql` creates one persistent maintenance-mode row,
initialized to OFF. Review the database first and apply this migration once
with an authorized schema account. The runtime account must be able to
`SELECT` and `UPDATE` this row. The currently configured account already has
database-level `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges, so no
additional runtime grant is required for this table. Do not alter those
pre-existing grants as part of this migration.

Migration 004 requires an authorized schema administrator with the necessary
`ALTER`, `CREATE ROUTINE`, `INSERT`, and `SELECT` privileges. It creates a
temporary stored procedure to conditionally add columns, then drops that
procedure. Check that no procedure with its helper name already exists before
running it. The runtime `fetman_app` account is intentionally limited to data
operations and cannot apply this migration.

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

Apply migration 004 only after reviewing the existing schema and applying
002. The runtime account needs `SELECT`, `INSERT`, and `UPDATE` on the
existing Graphic Design tables; no new table or broader privilege is needed.

Grant the runtime account only the required `SELECT`, `INSERT`, `UPDATE`,
and `DELETE` privileges on the Graphic Design tables, if it does not
already have them. Preserve its existing host restriction and all other
privileges; never grant database-wide or global access for this feature.

Apply migration 005 manually after reviewing the existing schema. In another
environment where the runtime account does not already have these rights,
grant only `SELECT` and `UPDATE` on `site_maintenance_settings`, preserving
the account's existing host restriction and unrelated privileges.
