# データ設計（MySQL）

[SPEC.md](../../SPEC.md) の一部。「※仮決め」の項目は実装しながら変えてよい（変えたら docs/decisions/ に記録する）。

## 1. 方針
- テーブルの作成・変更はすべて **dbmate のマイグレーション**（`backend/db/migrations/*.sql`、生 SQL で up と down を書く）で行う
- `backend/db/schema.sql` は dbmate が自動で書き出すもの（`npm --prefix backend run db:migrate`）。手で編集しない
- 接続先は環境変数 `DATABASE_URL`（`mysql://ユーザー:パスワード@ホスト:ポート/DB 名`）1 つで指定し、dbmate とアプリの両方がこれを読む
- 提案 100 件のような**アプリが前提とするマスターデータもマイグレーションで入れる**（CI でもローカルでも同じ状態になるように）
- ID は `INT UNSIGNED AUTO_INCREMENT`（単一ユーザー・ローカルのみなので UUID は使わない）
- 予定日は時刻を持たない日付なので `DATE` で持ち、タイムゾーンで変えない。API は `2026-11-23` の形で返す
- 日時は `DATETIME(3)` に **UTC** で保存する（mysql2 の接続設定を `timezone: "Z"` にする）。API は ISO 8601（`2026-10-31T05:00:00.000Z`）で返し、表示時に frontend でローカル時刻にする
- 文字コードは `utf8mb4`（絵文字を入れるため）

## 2. テーブル

### themes（提案のテーマ）
| 列 | 型 | 制約 |
|----|----|------|
| id | INT UNSIGNED | PK, AUTO_INCREMENT |
| name | VARCHAR(50) | NOT NULL |
| sort_order | INT | NOT NULL（探す画面での順。小さいほど上） |

### suggestions（提案の固定リスト）
| 列 | 型 | 制約 |
|----|----|------|
| id | INT UNSIGNED | PK, AUTO_INCREMENT |
| theme_id | INT UNSIGNED | NOT NULL, FK → themes.id |
| title | VARCHAR(200) | NOT NULL（やりたいリストに入れるときのタイトル） |
| hook | VARCHAR(100) | NOT NULL（見出し。興味を引く一言） |
| trivia | VARCHAR(300) | NOT NULL（豆知識） |
| first_step | VARCHAR(100) | NOT NULL（最初の一歩） |
| size | ENUM('hour','half_day','day','overnight') | NOT NULL（一歩の大きさ: 1 時間以内 / 半日 / 1 日 / 泊まり） |
| season_from | TINYINT UNSIGNED | NULL（季節の始まりの月 1〜12。NULL なら通年） |
| season_to | TINYINT UNSIGNED | NULL（季節の終わりの月 1〜12。season_from と一緒に NULL か値を持つ） |

- 季節は season_from 月〜season_to 月（両端を含む）。12 → 2 のように年をまたいでよい。「1〜12」と「両方 NULL か両方値あり」は CHECK 制約で守る（片方だけ NULL だと BETWEEN が NULL になり CHECK を通るので、IS NOT NULL も書く）
- 中身は AI（開発中の Claude）が下書きし、ユーザーが直す。件数は 100 件前後、テーマは 8〜10 個 ※仮決め（docs/decisions/0020）
- どの月にも、季節がその月に当たる提案を 5 件以上入れる（今月のおすすめ。screens.md §5）。月が変わると今月のおすすめが入れ替わるのは、季節の列と端末の日付だけで行う ※仮決め（docs/decisions/0021）
- 豆知識には、年で変わる日付（その年の流星群の極大など）を書かない
- 提案の追加・書き直しは、新しいマイグレーション（INSERT / UPDATE）で行う。ID は変えず、提案は消さない（中身が別物になるなら新しい ID で足す。docs/decisions/0021）

### tags（提案のタグ）
| 列 | 型 | 制約 |
|----|----|------|
| id | INT UNSIGNED | PK, AUTO_INCREMENT |
| name | VARCHAR(30) | NOT NULL, UNIQUE |

### suggestion_tags（提案とタグの対応）
| 列 | 型 | 制約 |
|----|----|------|
| suggestion_id | INT UNSIGNED | NOT NULL, FK → suggestions.id |
| tag_id | INT UNSIGNED | NOT NULL, FK → tags.id |

- PK は (suggestion_id, tag_id)。タグから提案を引くため tag_id にインデックスを張る
- 1 件に 2〜4 個。関連（screens.md §5）がつながるよう、1 つのタグは 3 件以上の提案に付ける ※仮決め
- themes・suggestions・tags・suggestion_tags はマスターデータ（§1）。提案の中身を入れ替えるマイグレーションでは、旧提案に付いていた options の `suggestion_id` を NULL にする（中身が別物になるので、手で追加したものとして残す。docs/decisions/0020）。down で旧提案を作り直しても、NULL にした対応は戻らない（元に戻せない変更）

### options（やりたいこと）
| 列 | 型 | 制約 |
|----|----|------|
| id | INT UNSIGNED | PK, AUTO_INCREMENT |
| title | VARCHAR(200) | NOT NULL |
| status | ENUM('pending','completed') | NOT NULL, DEFAULT 'pending' |
| suggestion_id | INT UNSIGNED | NULL, FK → suggestions.id, UNIQUE |
| sort_order | INT | NOT NULL |
| planned_on | DATE | NULL（予定日。未定なら NULL） |
| completed_at | DATETIME(3) | NULL（やったリストに移したとき） |
| created_at | DATETIME(3) | NOT NULL |
| updated_at | DATETIME(3) | NOT NULL |

- `suggestion_id` が NULL なら手動で追加したもの。UNIQUE なので、同じ提案を二重に追加できない
- `sort_order` は小さいほど上。先頭に追加するときは「現在の pending の最小値 − 1,024」（pending がなければ 0）を入れる
- やりたいリストに戻すときは `status = pending`、`completed_at = NULL`、`sort_order` は先頭にする
- 予定日を消したとき（日付 → NULL）も `sort_order` を先頭にする（予定日がないものの一番上に出る。docs/decisions/0015）
- 並び替えでは順番が変わった行だけを書き換える。値は前後の行の間に入れ、入らなければ全件を 1,024 刻みで振り直す（値は連番とは限らない）

### achievements（達成記録）
| 列 | 型 | 制約 |
|----|----|------|
| id | INT UNSIGNED | PK, AUTO_INCREMENT |
| option_id | INT UNSIGNED | NOT NULL, FK → options.id ON DELETE CASCADE |
| achieved_at | DATETIME(3) | NOT NULL |
| photo_filename | VARCHAR(100) | NULL（達成の写真のファイル名。api.md §5） |

- 達成回数は `achievements` の件数から求める（options に回数の列は持たない）

### events（利用イベント）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT UNSIGNED | PK, AUTO_INCREMENT |
| type | VARCHAR(50) | NOT NULL |
| payload | JSON | NOT NULL |
| occurred_at | DATETIME(3) | NOT NULL（frontend で発生した時刻） |
| received_at | DATETIME(3) | NOT NULL |

- option を削除しても events は残す（集計のため）。`payload` に option の ID が入っていても FK は張らない

## 3. 入力制限
| 項目 | 制限 |
|------|------|
| タイトル | 前後の空白（全角スペースを含む）を除いて 1〜200 文字。絵文字も 1 文字に数える |
| 予定日 | 実在する日付の `YYYY-MM-DD`（年は 1000〜9999）。NULL で未定 |
| イベント | 1 リクエスト 1〜50 件、`payload` は JSON のオブジェクトで 2KB（2,048 バイト）まで、`type` は screens.md §8 の種類のみ |
