-- migrate:up
CREATE TABLE achievements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  option_id INT UNSIGNED NOT NULL,
  achieved_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_achievements_option_id_achieved_at (option_id, achieved_at),
  KEY idx_achievements_achieved_at (achieved_at),
  CONSTRAINT fk_achievements_option FOREIGN KEY (option_id) REFERENCES options (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- migrate:down
DROP TABLE achievements;
