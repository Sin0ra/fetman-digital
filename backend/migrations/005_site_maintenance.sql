-- Review the existing fetman_management schema before applying manually.

CREATE TABLE site_maintenance_settings (
  id TINYINT UNSIGNED NOT NULL,
  maintenance_mode TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_site_maintenance_settings_singleton CHECK (id = 1),
  CONSTRAINT chk_site_maintenance_settings_mode CHECK (maintenance_mode IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

INSERT INTO site_maintenance_settings (id, maintenance_mode, version)
VALUES (1, 0, 0);
