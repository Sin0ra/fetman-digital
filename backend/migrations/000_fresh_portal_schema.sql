-- Fresh Fetman Digital schema for a new MariaDB database.
-- Apply manually with a schema administrator. The application never runs migrations.
-- Do not apply the legacy 001-005 migration set to the same fresh database.

CREATE TABLE developer_account (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_developer_account_email (email),
  CONSTRAINT chk_developer_account_email CHECK (email = 'sinoworkguma@gmail.com')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE sessions (
  session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (session_id),
  KEY ix_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE site_settings (
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO site_settings (setting_key, setting_value)
VALUES
  ('maintenance_mode', '0'),
  ('site_content', '{"heroTitle":"Make your brand impossible to ignore.","heroDescription":"Thoughtful design for businesses ready to make their next move.","aboutTitle":"Creative design that helps businesses speak clearly.","aboutDescription":"Fetman Digital is a Durban-based creative studio helping businesses turn ideas into confident visual identities and digital experiences.","services":["Custom logo design, visual direction, colour systems and brand foundations for businesses wanting a stronger identity.","Promotional graphics, social content and campaign artwork designed to help businesses get attention and communicate offers clearly.","Company profiles, presentations, stationery and professional documents that help teams present themselves consistently.","Print-ready layouts and packaging artwork for products, promotions and brand collateral that need a polished production finish.","Visual assets for online promotion, brand communication and digital campaigns that keep digital presence aligned with the brand."],"primaryCta":"Explore our work","secondaryCta":"Start a project","contactEmail":"info@fetmandigital.com","contactWhatsapp":"+27 71 234 5678"}');

CREATE TABLE media_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  storage_name VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(160) NOT NULL,
  media_type VARCHAR(32) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_assets_storage_name (storage_name),
  CONSTRAINT chk_media_assets_type CHECK (media_type IN ('image/webp')),
  CONSTRAINT chk_media_assets_size CHECK (byte_size > 0 AND byte_size <= 5242880)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE portfolio_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  department VARCHAR(24) NOT NULL DEFAULT 'IT',
  category VARCHAR(80) NOT NULL,
  image_asset_id BIGINT UNSIGNED NULL,
  image_url VARCHAR(500) NULL,
  project_url VARCHAR(500) NOT NULL,
  published TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_portfolio_projects_published_order (published, display_order, id),
  CONSTRAINT fk_portfolio_projects_asset FOREIGN KEY (image_asset_id)
    REFERENCES media_assets (id) ON DELETE SET NULL,
  CONSTRAINT chk_portfolio_projects_published CHECK (published IN (0, 1)),
  CONSTRAINT chk_portfolio_projects_department CHECK (department IN ('Graphic Design', 'IT'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE enquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  service VARCHAR(120) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_enquiries_created (created_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
