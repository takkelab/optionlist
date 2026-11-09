-- migrate:up
-- 写真の大きさ（作り直した後のバイト数）。1 人あたりの上限（2,000 枚・合計 1GB）の判定に使う（data.md §3、docs/decisions/0037・0051）
-- 手元の DB にある写真の行は大きさがわからないので 0 にする（利用者のデータはまだない。docs/decisions/0044）
ALTER TABLE achievements ADD COLUMN photo_bytes INTEGER NULL;
UPDATE achievements SET photo_bytes = 0 WHERE photo_filename IS NOT NULL;
-- 名前と大きさは一緒に NULL か値を持つ（片方だけだと上限の判定がずれる）
ALTER TABLE achievements ADD CONSTRAINT chk_achievements_photo_bytes CHECK (
  (photo_filename IS NULL AND photo_bytes IS NULL) OR (photo_filename IS NOT NULL AND photo_bytes IS NOT NULL AND photo_bytes >= 0)
);

-- migrate:down
ALTER TABLE achievements DROP CONSTRAINT chk_achievements_photo_bytes;
ALTER TABLE achievements DROP COLUMN photo_bytes;
