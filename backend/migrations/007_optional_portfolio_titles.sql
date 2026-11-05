-- Allow Graphic Design artwork to be published without a display title.
-- Existing title values are preserved; this only changes nullability.
ALTER TABLE portfolio_projects
  MODIFY COLUMN title VARCHAR(160) NULL;
