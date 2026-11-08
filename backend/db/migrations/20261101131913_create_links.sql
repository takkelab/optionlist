-- migrate:up
CREATE TABLE links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id INT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  label VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_links_option_id_created_at (option_id, created_at),
  CONSTRAINT fk_links_option FOREIGN KEY (option_id) REFERENCES options (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
DROP TABLE links;
