# Fresh MariaDB setup

The new runtime uses only `000_fresh_portal_schema.sql`. Apply it manually with
a schema administrator; the application never runs migrations at startup.

The `001`–`005` files are legacy development migrations from the former
multi-role Graphic Design workspace. Do not apply them to the fresh database.

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
