# Fresh MariaDB setup

The new runtime starts with `000_fresh_portal_schema.sql`, followed by the
forward migrations required by the target database. Apply them manually with
a schema administrator; the application never runs migrations at startup.

The `001`–`005` files are legacy development migrations from the former
multi-role Graphic Design workspace. Do not apply them to the fresh database.

For an existing database created from the fresh schema, apply
`006_portfolio_departments.sql` with a schema administrator before deploying
the updated application. It is additive: existing projects receive a nullable
department value and are not silently classified. New projects must send an
explicit `department` value (`Graphic Design` or `IT`) through the application.

## Applying and verifying portfolio departments

Take a backup, review the migration, and apply it with the same schema
administrator used for the original schema. The migration is safe to rerun;
it checks for both the column and the check constraint before adding them:

```bash
mysql --host="$DB_HOST" --port="${DB_PORT:-3306}" \
  --user="$DB_USER" --password "$DB_NAME" \
  < backend/migrations/006_portfolio_departments.sql
```

Before classifying anything, inspect the preserved rows:

```sql
SELECT id, title, category, department
FROM portfolio_projects
ORDER BY id;

SELECT id, title, category
FROM portfolio_projects
WHERE department IS NULL
ORDER BY id;
```

After reviewing each row, classify it explicitly in a controlled change. Use
the project IDs from the review query; do not classify by an unverified blanket
default:

```sql
START TRANSACTION;
UPDATE portfolio_projects
SET department = 'IT'
WHERE id IN (/* reviewed IT project IDs */);
UPDATE portfolio_projects
SET department = 'Graphic Design'
WHERE id IN (/* reviewed Graphic Design project IDs */);
COMMIT;
```

Verify the result before deploying the application:

```sql
SELECT COUNT(*) AS unclassified_projects
FROM portfolio_projects
WHERE department IS NULL;

SELECT department, COUNT(*) AS project_count
FROM portfolio_projects
GROUP BY department;
```

The expected `unclassified_projects` count is zero only after every existing
row has been reviewed and classified. Do not run the example `UPDATE` statements
with placeholder comments; replace them with the reviewed IDs. The application
already sends the department explicitly for newly created and edited projects.

For an existing database, apply `007_optional_portfolio_titles.sql` after the
department migration and before deploying the title-optional management flow.
It changes only the nullability of `portfolio_projects.title`; existing titles
are preserved. Fresh installations already create this column as nullable in
`000_fresh_portal_schema.sql`. Do not run this migration against production
until the target database has been backed up and the change has been reviewed.

For a fresh installation, apply `006_portfolio_departments.sql` and then
`007_optional_portfolio_titles.sql` after `000_fresh_portal_schema.sql`.
The resulting fresh schema permits nullable project titles while preserving the
historical migration files.

## Backup and replacement procedure

Before replacing a local database, make a logical backup:

```bash
mysqldump --single-transaction --routines --triggers \
  -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p "$DB_NAME" \
  > fetman-before-fresh-schema-$(date +%Y%m%d-%H%M%S).sql
```

Create a new empty MariaDB database, review `000_fresh_portal_schema.sql`, and
apply it with an authorized schema user. Never drop the old Hostinger database
automatically; retain it until the replacement is verified.

For a new local installation, a schema administrator can use the equivalent of:

```sql
CREATE DATABASE fetman_fresh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'fetman_app'@'127.0.0.1' IDENTIFIED BY 'use-a-secret-from-your-password-manager';
GRANT SELECT, INSERT, UPDATE, DELETE ON fetman_fresh.* TO 'fetman_app'@'127.0.0.1';
```

Apply the schema file to `fetman_fresh`, then set `DB_NAME`, `DB_USER`, and
`DB_PASSWORD` for the runtime. Use Hostinger's actual database name, user,
host, and grants in production.

Create the sole developer account only after the schema exists:

```bash
npm --prefix backend run bootstrap:developer
```

The command asks for a hidden password twice, requires at least eight characters,
uses Argon2id, and is protected by a MariaDB named lock plus a unique email
constraint. It refuses to run once the account exists.
