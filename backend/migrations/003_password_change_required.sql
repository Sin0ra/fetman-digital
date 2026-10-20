-- Review the existing management_users schema and obtain approval before applying.
-- Existing accounts default to no pending change; account-creation and reset
-- workflows explicitly set this flag for newly issued temporary passwords.
ALTER TABLE management_users
  ADD COLUMN password_change_required TINYINT(1) NOT NULL DEFAULT 0
  AFTER is_active;
