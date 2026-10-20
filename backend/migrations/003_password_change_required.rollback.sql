-- Review pending accounts and obtain approval before rolling back.
-- Dropping this column removes mandatory-password-change state.
ALTER TABLE management_users
  DROP COLUMN password_change_required;
