-- migrate:up
-- 提案を見出し・豆知識・最初の一歩で書き直し、テーマ・タグで探せるようにする（docs/decisions/0020）
-- 中身が別物になるので、旧提案から追加した options は手で追加したものとして残す（data.md §2）。down でも NULL のまま戻らない
UPDATE options SET suggestion_id = NULL WHERE suggestion_id IS NOT NULL;
ALTER TABLE options DROP FOREIGN KEY fk_options_suggestion;
DROP TABLE suggestions;

CREATE TABLE themes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 季節は season_from 月〜season_to 月（両端を含み、12 → 2 のように年をまたいでよい）。両方 NULL なら通年
CREATE TABLE suggestions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  theme_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  hook VARCHAR(100) NOT NULL,
  trivia VARCHAR(300) NOT NULL,
  first_step VARCHAR(100) NOT NULL,
  size ENUM('hour', 'half_day', 'day', 'overnight') NOT NULL,
  season_from TINYINT UNSIGNED NULL,
  season_to TINYINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_suggestions_theme_id (theme_id),
  CONSTRAINT fk_suggestions_theme FOREIGN KEY (theme_id) REFERENCES themes (id),
  -- 片方だけ NULL だと BETWEEN が NULL（不明）になり CHECK を通ってしまうので、IS NOT NULL を明示する
  CONSTRAINT chk_suggestions_season CHECK (
    (season_from IS NULL AND season_to IS NULL)
    OR (season_from IS NOT NULL AND season_to IS NOT NULL AND season_from BETWEEN 1 AND 12 AND season_to BETWEEN 1 AND 12)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tags (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- タグから提案を引くため tag_id にもインデックスを張る
CREATE TABLE suggestion_tags (
  suggestion_id INT UNSIGNED NOT NULL,
  tag_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (suggestion_id, tag_id),
  KEY idx_suggestion_tags_tag_id (tag_id),
  CONSTRAINT fk_suggestion_tags_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id),
  CONSTRAINT fk_suggestion_tags_tag FOREIGN KEY (tag_id) REFERENCES tags (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE options ADD CONSTRAINT fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id);

-- migrate:down
ALTER TABLE options DROP FOREIGN KEY fk_options_suggestion;
DROP TABLE suggestion_tags;
DROP TABLE tags;
DROP TABLE suggestions;
DROP TABLE themes;

CREATE TABLE suggestions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 旧提案 100 件（20261101000002_insert_suggestions.sql と同じ）
INSERT INTO suggestions (id, title, category) VALUES
  (1, 'カリンバを買って演奏してみる', '趣味・創作'),
  (2, '折り紙で複雑な作品を作ってみる', '趣味・創作'),
  (3, '刺繍を始めてハンカチに模様を入れてみる', '趣味・創作'),
  (4, '水彩画で風景を描いてみる', '趣味・創作'),
  (5, '粘土で小さな人形を作ってみる', '趣味・創作'),
  (6, 'ウクレレを始めて簡単な曲を弾いてみる', '趣味・創作'),
  (7, 'レザークラフトでキーホルダーを作ってみる', '趣味・創作'),
  (8, '書道を習ってみる', '趣味・創作'),
  (9, 'アクセサリー作りに挑戦してみる', '趣味・創作'),
  (10, '編み物でマフラーを作ってみる', '趣味・創作'),
  (11, '陶芸教室で茶碗を作ってみる', '趣味・創作'),
  (12, 'ジャグリングを練習してみる', '趣味・創作'),
  (13, '手品を一つ覚えて披露してみる', '趣味・創作'),
  (14, 'プラモデルを組み立ててみる', '趣味・創作'),
  (15, '盆栽を育ててみる', '趣味・創作'),
  (16, 'カメラを持って写真散歩してみる', '趣味・創作'),
  (17, '短歌や俳句を詠んでみる', '趣味・創作'),
  (18, '版画を彫ってみる', '趣味・創作'),
  (19, 'キャンドル作りに挑戦してみる', '趣味・創作'),
  (20, '羊毛フェルトで小物を作ってみる', '趣味・創作'),
  (21, 'ガラス絵の具でステンドグラス風作品を作る', '趣味・創作'),
  (22, '消しゴムはんこを彫ってみる', '趣味・創作'),
  (23, '似顔絵を描いてみる', '趣味・創作'),
  (24, '手製本でノートを作ってみる', '趣味・創作'),
  (25, 'タロットカードを学んでみる', '趣味・創作'),
  (26, '万華鏡を手作りしてみる', '趣味・創作'),
  (27, 'ハーバリウムを作ってみる', '趣味・創作'),
  (28, '篆刻（てんこく）で自分の印鑑を作る', '趣味・創作'),
  (29, '押し花でしおりを作ってみる', '趣味・創作'),
  (30, 'ミニチュアドールハウスを作ってみる', '趣味・創作'),
  (31, '近所の知らないカフェに入ってみる', '体験・外出'),
  (32, '一人で映画館に行ってみる', '体験・外出'),
  (33, '早朝に散歩して朝日を見る', '体験・外出'),
  (34, '地元の美術館や博物館に行ってみる', '体験・外出'),
  (35, '銭湯や温泉に一人で行ってみる', '体験・外出'),
  (36, 'フリーマーケットに出店してみる', '体験・外出'),
  (37, '地域のお祭りやイベントに参加する', '体験・外出'),
  (38, 'プラネタリウムに行ってみる', '体験・外出'),
  (39, '動物園や水族館に一人で行ってみる', '体験・外出'),
  (40, '図書館で一日過ごしてみる', '体験・外出'),
  (41, '登山やハイキングに挑戦してみる', '体験・外出'),
  (42, 'サイクリングで隣町まで行ってみる', '体験・外出'),
  (43, 'ボランティア活動に参加してみる', '体験・外出'),
  (44, '地元の歴史スポットを巡ってみる', '体験・外出'),
  (45, '夜景スポットに行ってみる', '体験・外出'),
  (46, '釣りに挑戦してみる', '体験・外出'),
  (47, 'キャンプ場でソロキャンプしてみる', '体験・外出'),
  (48, 'スケートリンクで滑ってみる', '体験・外出'),
  (49, 'ボウリング場で一人ボウリングしてみる', '体験・外出'),
  (50, 'カラオケで一人カラオケしてみる', '体験・外出'),
  (51, '星空観察会に参加する', '体験・外出'),
  (52, 'ピクニックして青空の下で読書する', '体験・外出'),
  (53, 'フォトスポット巡りをしてみる', '体験・外出'),
  (54, '地元の農園で果物狩りをしてみる', '体験・外出'),
  (55, '路地裏探検をしてみる', '体験・外出'),
  (56, '新しい言語を1フレーズだけ覚えてみる', '学習'),
  (57, 'YouTubeで気になるスキルの動画を3本見る', '学習'),
  (58, 'オンライン講座を1つ受講してみる', '学習'),
  (59, '読みたかった本を1冊読破する', '学習'),
  (60, 'TED Talkを見てみる', '学習'),
  (61, 'プログラミングの基礎を学んでみる', '学習'),
  (62, '歴史の本を読んで新しい知識を得る', '学習'),
  (63, '料理のレシピを1つ完璧に習得する', '学習'),
  (64, 'ボードゲームのルールを覚えて遊んでみる', '学習'),
  (65, '星座を5つ覚えて夜空を見上げる', '学習'),
  (66, '数学パズルに挑戦してみる', '学習'),
  (67, '地図を読む練習をしてみる', '学習'),
  (68, '手話を少し学んでみる', '学習'),
  (69, '瞑想やマインドフルネスを試してみる', '学習'),
  (70, 'ラジオ体操を毎朝1週間続けてみる', '学習'),
  (71, '新しいアプリを使いこなしてみる', '学習'),
  (72, 'ポッドキャストを聴いてみる', '学習'),
  (73, 'ドキュメンタリー映画を見てみる', '学習'),
  (74, '植物の名前を10個覚えてみる', '学習'),
  (75, 'ワインやコーヒーのテイスティングを学ぶ', '学習'),
  (76, '知らない人に道を尋ねてみる', '小さな挑戦'),
  (77, 'いつもと違う道で帰宅してみる', '小さな挑戦'),
  (78, '初めての食材を買って料理してみる', '小さな挑戦'),
  (79, '朝型生活に1週間挑戦してみる', '小さな挑戦'),
  (80, 'スマホを使わない日を1日作ってみる', '小さな挑戦'),
  (81, '手紙を書いて誰かに送ってみる', '小さな挑戦'),
  (82, '即興で詩を書いてみる', '小さな挑戦'),
  (83, '知らないジャンルの音楽を聴いてみる', '小さな挑戦'),
  (84, '外国語で日記を書いてみる', '小さな挑戦'),
  (85, '1日何も買わない日を作ってみる', '小さな挑戦'),
  (86, '感謝の気持ちを誰かに直接伝えてみる', '小さな挑戦'),
  (87, '自分の好きなものベスト10を書き出してみる', '小さな挑戦'),
  (88, '子供の頃好きだった遊びをもう一度やってみる', '小さな挑戦'),
  (89, '昔の友人に連絡してみる', '小さな挑戦'),
  (90, '新しいヘアスタイルに挑戦してみる', '小さな挑戦'),
  (91, '普段着ない色の服を着てみる', '小さな挑戦'),
  (92, '早起きして朝食を豪華にしてみる', '小さな挑戦'),
  (93, '靴磨きをしてみる', '小さな挑戦'),
  (94, '部屋の模様替えをしてみる', '小さな挑戦'),
  (95, '断捨離して不要なものを10個捨てる', '小さな挑戦'),
  (96, '植物を1つ育ててみる', '小さな挑戦'),
  (97, '空を見上げて雲の形を楽しむ', '小さな挑戦'),
  (98, '1日笑顔で過ごすことを意識してみる', '小さな挑戦'),
  (99, '知らない店でランチしてみる', '小さな挑戦'),
  (100, 'この提案リストに自分のアイデアを1つ追加してみる', '小さな挑戦');

ALTER TABLE options ADD CONSTRAINT fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions (id);
