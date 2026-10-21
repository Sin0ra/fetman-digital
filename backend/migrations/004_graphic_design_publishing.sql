-- Apply only after 002_graphic_design.sql and after creating at least one
-- Graphic Design account. This migration preserves all existing rows.
DROP PROCEDURE IF EXISTS apply_graphic_design_publishing_columns;
DELIMITER $$
CREATE PROCEDURE apply_graphic_design_publishing_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'publication_status'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN publication_status VARCHAR(16) NOT NULL DEFAULT 'draft';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'display_order'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN display_order INT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'category'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'tags'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN tags JSON NOT NULL DEFAULT (JSON_ARRAY());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'source_key'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN source_key VARCHAR(80) NULL UNIQUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'graphic_design_content'
      AND COLUMN_NAME = 'legacy_image_url'
  ) THEN
    ALTER TABLE graphic_design_content
      ADD COLUMN legacy_image_url VARCHAR(500) NULL;
  END IF;
END$$
DELIMITER ;
CALL apply_graphic_design_publishing_columns();
DROP PROCEDURE apply_graphic_design_publishing_columns;

-- Adopt the public website's existing portfolio without changing its content.
-- Re-running this insert does not duplicate rows. Existing hardcoded cards remain
-- the fallback until the migration has populated their matching CMS entries.
INSERT INTO graphic_design_content
  (owner_user_id, type, title, description, alt_text, asset_id, publication_status,
   display_order, category, tags, source_key, legacy_image_url)
SELECT editor.id, legacy.type, legacy.title, legacy.description, legacy.alt_text,
       NULL, 'published', legacy.display_order, legacy.category, legacy.tags,
       legacy.source_key, legacy.legacy_image_url
FROM (
  SELECT 'legacy-logo-sino-sma' AS source_key, 'portfolio' AS type,
         'Sino and Sma Trading' AS title, 'Logo design and brand identity.' AS description,
         'Logo Design' AS alt_text, 10 AS display_order, 'logo' AS category,
         JSON_ARRAY('logo', 'identity') AS tags,
         'logo%20img/Sino-and-Sma-Trading-1200.jpg' AS legacy_image_url
  UNION ALL SELECT 'legacy-logo-totana', 'portfolio', 'Totana',
         'Distinctive identity design.', 'Logo Design', 20, 'logo',
         JSON_ARRAY('logo', 'identity'), 'logo img/Totana white logo.png'
  UNION ALL SELECT 'legacy-logo-fetman-digital', 'portfolio', 'Fetman Digital',
         'The studio''s own visual identity.', 'Logo Design', 30, 'logo',
         JSON_ARRAY('logo', 'identity'), 'logo img/fetman digital 2023 black.png'
  UNION ALL SELECT 'legacy-branding-deals-on-wheels', 'portfolio', 'Deals on Wheels',
         'Promotional poster design.', 'Deals on Wheels promotional poster', 40, 'branding',
         JSON_ARRAY('branding', 'promotion'), 'Branding%20img/deals-on-wheels-1200.jpg'
  UNION ALL SELECT 'legacy-branding-dj-olga', 'portfolio', 'DJ Olga Bookings',
         'Event and booking artwork.', 'DJ Olga bookings promotional artwork', 50, 'branding',
         JSON_ARRAY('branding', 'promotion'), 'Branding%20img/dj-olga-bookings-1200.jpg'
  UNION ALL SELECT 'legacy-branding-pub-on-frere', 'portfolio', 'Pub on Frere',
         'Anniversary campaign design.', 'Pub on Frere anniversary artwork', 60, 'branding',
         JSON_ARRAY('branding', 'campaign'), 'Branding%20img/pub-on-frere-1200.jpg'
  UNION ALL SELECT 'legacy-branding-thursday-braaiday', 'portfolio', 'Thursday Braaiday',
         'Promotional campaign artwork.', 'Thursday Braaiday promotional artwork', 70, 'branding',
         JSON_ARRAY('branding', 'campaign'), 'Branding%20img/thursday-braaiday-1200.jpg'
  UNION ALL SELECT 'legacy-branding-company-profile', 'portfolio', 'Company Profile',
         'Editorial layout and brand presentation.', 'Fetman Digital company profile design', 80, 'branding',
         JSON_ARRAY('branding', 'editorial'), 'Branding%20img/fetman-company-profile-1200.jpg'
  UNION ALL SELECT 'legacy-print-company-profile-design', 'portfolio', 'Company Profile Design',
         'A multi-page print identity piece.', 'Fetman Digital company profile spread', 90, 'print',
         JSON_ARRAY('print', 'editorial'), 'Branding%20img/company-profile-spread-1200.jpg'
  UNION ALL SELECT 'legacy-print-editorial', 'portfolio', 'Print & Editorial',
         'Information design for a growing brand.', 'Printed brand profile design', 100, 'print',
         JSON_ARRAY('print', 'editorial'), 'Branding%20img/company-profile-spread-1200.jpg'
  UNION ALL SELECT 'legacy-brand-collateral', 'portfolio', 'Brand Collateral',
         'Print-ready collateral and layout.', 'Fetman Digital print portfolio', 110, 'print',
         JSON_ARRAY('print', 'collateral'), 'Branding%20img/company-profile-spread-1200.jpg'
) AS legacy
CROSS JOIN (
  SELECT id
  FROM management_users
  WHERE role = 'Graphic Design' AND is_active = 1
  ORDER BY id
  LIMIT 1
) AS editor
WHERE NOT EXISTS (
  SELECT 1
  FROM graphic_design_content existing
  WHERE existing.source_key = legacy.source_key
);
