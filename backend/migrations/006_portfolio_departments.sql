-- Safe, additive migration for the existing owner portfolio.
-- Existing rows intentionally remain unclassified (NULL). Review and classify
-- them explicitly after this migration; this script never rewrites project data.
DROP PROCEDURE IF EXISTS add_portfolio_departments;
DELIMITER $$
CREATE PROCEDURE add_portfolio_departments()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portfolio_projects'
      AND COLUMN_NAME = 'department'
  ) THEN
    ALTER TABLE portfolio_projects
      ADD COLUMN department VARCHAR(24) NULL AFTER description;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'portfolio_projects'
      AND CONSTRAINT_NAME = 'chk_portfolio_projects_department'
      AND CONSTRAINT_TYPE = 'CHECK'
  ) THEN
    ALTER TABLE portfolio_projects
      ADD CONSTRAINT chk_portfolio_projects_department
      CHECK (department IN ('Graphic Design', 'IT'));
  END IF;
END$$
DELIMITER ;
CALL add_portfolio_departments();
DROP PROCEDURE add_portfolio_departments;
