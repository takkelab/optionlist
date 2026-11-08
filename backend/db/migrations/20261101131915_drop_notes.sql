-- migrate:up
-- メモは options.memo の 1 枚にした（docs/decisions/0013）。notes はまだ使っておらず、データはない
DROP TABLE notes;

-- migrate:down
CREATE TABLE notes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id INT UNSIGNED NOT NULL,
  body TEXT NULL,
  image_filename VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notes_option_id_created_at (option_id, created_at),
  CONSTRAINT fk_notes_option FOREIGN KEY (option_id) REFERENCES options (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
