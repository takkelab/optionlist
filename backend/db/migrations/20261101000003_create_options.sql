-- migrate:up
CREATE TABLE options (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  suggestion_id INT UNSIGNED NULL,
  sort_order INT NOT NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_options_suggestion_id (suggestion_id),
  KEY idx_options_status_sort_order (status, sort_order),
  CONSTRAINT fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
DROP TABLE options;
