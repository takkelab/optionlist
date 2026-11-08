-- migrate:up
-- 達成 1 回に写真を 1 枚付ける（docs/decisions/0028）。DB にはサーバーで決めたファイル名だけを入れる（api.md §5）
-- 一覧の 1 行ごとに「写真が付いた、いちばん新しい達成」を読むので、行を読みに行かずに答えられるようインデックスに含める（metrics.md §4）
ALTER TABLE achievements
  ADD COLUMN photo_filename VARCHAR(100) NULL,
  ADD KEY idx_achievements_option_id_achieved_at_photo (option_id, achieved_at, photo_filename),
  DROP KEY idx_achievements_option_id_achieved_at;

-- migrate:down
-- ファイルは uploads/ に残る（列を戻すだけ）
ALTER TABLE achievements
  ADD KEY idx_achievements_option_id_achieved_at (option_id, achieved_at),
  DROP KEY idx_achievements_option_id_achieved_at_photo,
  DROP COLUMN photo_filename;
