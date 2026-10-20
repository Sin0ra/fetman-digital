-- Review the existing fetman_management schema before applying manually.
-- The application does not execute migrations automatically.

CREATE TABLE graphic_design_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assigned_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  deadline DATE NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_graphic_design_tasks_assignee_status_deadline
    (assigned_user_id, status, deadline),
  CONSTRAINT fk_graphic_design_tasks_user
    FOREIGN KEY (assigned_user_id) REFERENCES management_users (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_graphic_design_tasks_status
    CHECK (status IN ('Pending', 'In Progress', 'In Review', 'Completed'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE graphic_design_task_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_graphic_design_task_updates_task_created (task_id, created_at),
  CONSTRAINT fk_graphic_design_task_updates_task
    FOREIGN KEY (task_id) REFERENCES graphic_design_tasks (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_graphic_design_task_updates_user
    FOREIGN KEY (user_id) REFERENCES management_users (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_graphic_design_task_updates_status
    CHECK (status IS NULL OR status IN ('Pending', 'In Progress', 'In Review', 'Completed'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE graphic_design_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  storage_name VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_name VARCHAR(120) NOT NULL,
  media_type VARCHAR(32) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_graphic_design_assets_storage_name (storage_name),
  KEY ix_graphic_design_assets_owner_created (owner_user_id, created_at),
  KEY ix_graphic_design_assets_task (task_id),
  CONSTRAINT fk_graphic_design_assets_user
    FOREIGN KEY (owner_user_id) REFERENCES management_users (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_graphic_design_assets_task
    FOREIGN KEY (task_id) REFERENCES graphic_design_tasks (id)
    ON DELETE SET NULL,
  CONSTRAINT chk_graphic_design_assets_media_type
    CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT chk_graphic_design_assets_byte_size
    CHECK (byte_size > 0 AND byte_size <= 5242880)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE graphic_design_content (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(24) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  alt_text VARCHAR(250) NOT NULL,
  asset_id BIGINT UNSIGNED NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_graphic_design_content_owner_active (owner_user_id, is_deleted, updated_at),
  KEY ix_graphic_design_content_asset (asset_id),
  CONSTRAINT fk_graphic_design_content_user
    FOREIGN KEY (owner_user_id) REFERENCES management_users (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_graphic_design_content_asset
    FOREIGN KEY (asset_id) REFERENCES graphic_design_assets (id)
    ON DELETE SET NULL,
  CONSTRAINT chk_graphic_design_content_type
    CHECK (type IN ('banner', 'portfolio', 'visual'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE graphic_design_content_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  content_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(16) NOT NULL,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_graphic_design_content_revisions_content_created
    (content_id, created_at),
  CONSTRAINT fk_graphic_design_content_revisions_content
    FOREIGN KEY (content_id) REFERENCES graphic_design_content (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_graphic_design_content_revisions_user
    FOREIGN KEY (owner_user_id) REFERENCES management_users (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_graphic_design_content_revisions_action
    CHECK (action IN ('created', 'updated', 'deleted'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
