# データ設計（PostgreSQL）

[SPEC.md](../../SPEC.md) の一部。「※仮決め」の項目は実装しながら変えてよい（変えたら docs/decisions/ に記録する）。

## 1. 方針
- DB は **PostgreSQL 17**（手元は Windows に直接入れたもの、CI はサービスコンテナ、確認用・本番は Cloud SQL。docs/decisions/0034・0036）
- テーブルの作成・変更はすべて **dbmate のマイグレーション**（`backend/db/migrations/*.sql`、生 SQL で up と down を書く）で行う。最初の 1 本は、MySQL 時代の 13 本をまとめ直した基準のマイグレーション（docs/decisions/0044）
- `backend/db/schema.sql` は dbmate が自動で書き出すもの（`npm --prefix backend run db:migrate`）。手で編集しない
- 接続先は環境変数で指定する。マイグレーション（dbmate）は `DATABASE_URL`（`postgres://ol_migrator:…@ホスト:ポート/DB 名`）、アプリは `APP_DATABASE_URL`（`ol_app` で接続）。ロールは §4
- 本番と確認用では、マイグレーションを前に進めるだけにする（down は流さない）。列を消すとき・名前を変えるときは「足す → 新旧どちらでも動くコードを出す → 古いものを消す」の 3 回の PR に分ける（docs/decisions/0036）
- 提案 100 件のような**アプリが前提とするマスターデータもマイグレーションで入れる**（CI でも手元でも同じ状態になるように）
- ID は `BIGINT GENERATED ALWAYS AS IDENTITY`。連番でよい（他人の ID を推測されても RLS と 404 で読めない。docs/decisions/0038）
- 予定日は時刻を持たない日付なので `date` で持ち、タイムゾーンで変えない。API は `2026-11-23` の形で返す（`pg` が `Date` に変えないよう、`date` の型の変換を文字列のままにする）
- 日時は `timestamptz(3)` で持つ。接続ごとに `TimeZone = 'UTC'` にする。API は ISO 8601（`2026-10-31T05:00:00.000Z`）で返し、表示時に frontend でローカル時刻にする
- DB の文字コードは `UTF8`（絵文字を入れるため）。文字数の制限（§3）はアプリで数える

## 2. テーブル

### themes（提案のテーマ）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| name | VARCHAR(50) | NOT NULL |
| sort_order | INTEGER | NOT NULL（探す画面での順。小さいほど上） |

### suggestions（提案の固定リスト）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity（基準のマイグレーションでは今の ID をそのまま入れる。docs/decisions/0044） |
| theme_id | BIGINT | NOT NULL, FK → themes.id |
| title | VARCHAR(200) | NOT NULL（やりたいリストに入れるときのタイトル） |
| hook | VARCHAR(100) | NOT NULL（見出し。興味を引く一言） |
| trivia | VARCHAR(300) | NOT NULL（豆知識） |
| first_step | VARCHAR(100) | NOT NULL（最初の一歩） |
| size | TEXT | NOT NULL, CHECK (size IN ('hour','half_day','day','overnight'))（一歩の大きさ: 1 時間以内 / 半日 / 1 日 / 泊まり） |
| season_from | SMALLINT | NULL（季節の始まりの月 1〜12。NULL なら通年） |
| season_to | SMALLINT | NULL（季節の終わりの月 1〜12。season_from と一緒に NULL か値を持つ） |

- 季節は season_from 月〜season_to 月（両端を含む）。12 → 2 のように年をまたいでよい。「1〜12」と「両方 NULL か両方値あり」は CHECK 制約で守る（片方だけ NULL だと BETWEEN が NULL になり CHECK を通るので、IS NOT NULL も書く）
- 中身は AI（開発中の Claude）が下書きし、ユーザーが直す。件数は 100 件前後、テーマは 8〜10 個 ※仮決め（docs/decisions/0020）
- どの月にも、季節がその月に当たる提案を 5 件以上入れる（今月のおすすめ。screens.md §5）。月が変わると今月のおすすめが入れ替わるのは、季節の列と端末の日付だけで行う ※仮決め（docs/decisions/0021）
- 豆知識には、年で変わる日付（その年の流星群の極大など）を書かない
- 提案の追加・書き直しは、新しいマイグレーション（INSERT / UPDATE）で行う。ID は変えず、提案は消さない（中身が別物になるなら新しい ID で足す。docs/decisions/0021）

### tags（提案のタグ）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| name | VARCHAR(30) | NOT NULL, UNIQUE |

### suggestion_tags（提案とタグの対応）
| 列 | 型 | 制約 |
|----|----|------|
| suggestion_id | BIGINT | NOT NULL, FK → suggestions.id |
| tag_id | BIGINT | NOT NULL, FK → tags.id |

- PK は (suggestion_id, tag_id)。タグから提案を引くため tag_id にインデックスを張る
- 1 件に 2〜4 個。関連（screens.md §5）がつながるよう、1 つのタグは 3 件以上の提案に付ける ※仮決め
- themes・suggestions・tags・suggestion_tags はマスターデータ（§1）。全員に同じものを見せ、利用者のデータは持たない（RLS の対象外。§4）。提案の中身を入れ替えるマイグレーションでは、旧提案に付いていた options の `suggestion_id` を NULL にする（中身が別物になるので、手で追加したものとして残す。docs/decisions/0020）。down で旧提案を作り直しても、NULL にした対応は戻らない（元に戻せない変更）

### users（匿名アカウント。docs/decisions/0033）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| session_hash | BYTEA | NOT NULL, UNIQUE（Cookie の鍵の SHA-256。鍵そのものは持たない） |
| recovery_code_hash | BYTEA | NULL, UNIQUE（復旧コードの SHA-256。発行していなければ NULL。使うと NULL に戻す） |
| created_at | TIMESTAMPTZ(3) | NOT NULL |
| last_seen_at | TIMESTAMPTZ(3) | NOT NULL（最後に使った日時。1 日 1 回だけ書く） |

- アカウントを作るのは最初の書き込みのときだけ（api.md §6）。読むだけのリクエストでは作らない
- 鍵（32 バイトの乱数）と復旧コード（約 80 ビット）は十分長い乱数なので、遅いハッシュ（bcrypt など）は使わず SHA-256 で持つ
- 復旧コードを使うと、`session_hash` を新しい鍵のものに置き換える（それまでの端末の Cookie は無効になる）
- `last_seen_at` は保存期間（§5）の判定に使う。インデックスを張る

### options（やりたいこと）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| user_id | BIGINT | NOT NULL, FK → users.id ON DELETE CASCADE |
| title | VARCHAR(200) | NOT NULL |
| status | TEXT | NOT NULL, DEFAULT 'pending', CHECK (status IN ('pending','completed')) |
| suggestion_id | BIGINT | NULL, FK → suggestions.id |
| sort_order | INTEGER | NOT NULL |
| planned_on | DATE | NULL（予定日。未定なら NULL） |
| completed_at | TIMESTAMPTZ(3) | NULL（やったリストに移したとき） |
| created_at | TIMESTAMPTZ(3) | NOT NULL |
| updated_at | TIMESTAMPTZ(3) | NOT NULL |

- UNIQUE (user_id, suggestion_id)。同じ人が同じ提案を二重に追加できない（別の人は同じ提案を追加できる）。`suggestion_id` が NULL の行（手動で追加したもの）は、何件あってもよい
- UNIQUE (id, user_id)（achievements の複合外部キーの参照先）
- インデックスは (user_id, status, …) から始める（一覧の並びに合わせる）※仮決め
- `suggestion_id` が NULL なら手動で追加したもの
- `sort_order` は小さいほど上。先頭に追加するときは「その人の pending の最小値 − 1,024」（pending がなければ 0）を入れる
- やりたいリストに戻すときは `status = pending`、`completed_at = NULL`、`sort_order` は先頭にする
- 予定日を消したとき（日付 → NULL）も `sort_order` を先頭にする（予定日がないものの一番上に出る。docs/decisions/0015）
- 並び替えでは順番が変わった行だけを書き換える。値は前後の行の間に入れ、入らなければその人の全件を 1,024 刻みで振り直す（値は連番とは限らない）

### achievements（達成記録）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| user_id | BIGINT | NOT NULL |
| option_id | BIGINT | NOT NULL |
| achieved_at | TIMESTAMPTZ(3) | NOT NULL |
| photo_filename | VARCHAR(100) | NULL, UNIQUE（達成の写真のファイル名。api.md §5） |
| photo_bytes | INTEGER | NULL（写真の大きさ。photo_filename と一緒に NULL か値を持つ。1 人あたりの上限の判定に使う） |

- (option_id, user_id) → options (id, user_id) の複合外部キー（ON DELETE CASCADE）。達成の持ち主と項目の持ち主が必ず同じになる
- RLS（§4）を表ごとに判定できるよう、`user_id` を options から写して持つ
- インデックスは (option_id, achieved_at, photo_filename)（一覧のタイルの写真を、行を読まずに引く。docs/decisions/0028）と (user_id)
- 達成回数は `achievements` の件数から求める（options に回数の列は持たない）

### events（利用イベント）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| type | VARCHAR(50) | NOT NULL |
| payload | JSONB | NOT NULL |
| occurred_at | TIMESTAMPTZ(3) | NOT NULL（frontend で発生した時刻） |
| received_at | TIMESTAMPTZ(3) | NOT NULL |

- アカウントがない（まだ何も書き込んでいない）人のエラーも受けるので、`user_id` は持たない。payload にも、タイトルや ID のような利用者のデータを入れない（screens.md §8）
- `ol_app` は INSERT だけができ、読めない（§4）。集計は `ol_metrics` のビューで行う
- 受け取ってから 90 日で消す（§5）

### auth_attempts（アカウントの作成・復旧コードの入力の回数。docs/decisions/0038）
| 列 | 型 | 制約 |
|----|----|------|
| id | BIGINT | PK, identity |
| kind | TEXT | NOT NULL, CHECK (kind IN ('create_account','restore')) |
| ip_hash | BYTEA | NOT NULL（IP アドレスを、秘密の値 `IP_HASH_SECRET` で HMAC-SHA-256 したもの。IP そのものは持たない） |
| occurred_at | TIMESTAMPTZ(3) | NOT NULL |

- インデックスは (kind, ip_hash, occurred_at)
- `ol_app` は §4 の関数を通してだけ書き、読む。7 日で消す（§5）

## 3. 入力制限
| 項目 | 制限 |
|------|------|
| タイトル | 前後の空白（全角スペースを含む）を除いて 1〜200 文字。絵文字も 1 文字に数える |
| 予定日 | 実在する日付の `YYYY-MM-DD`（年は 1000〜9999）。NULL で未定 |
| イベント | 1 リクエスト 1〜50 件、`payload` は JSON のオブジェクトで 2KB（2,048 バイト）まで、`type` は screens.md §8 の種類のみ |
| 復旧コード | 数字と大文字（見分けにくい 0・O・1・I・L を除く 31 文字）の 16 文字。入力では空白・ハイフン・小文字を許して、正規化してから比べる |
| 写真 | 1 枚 5MB まで（受け取り時）。1 人あたり 2,000 枚・合計 1GB まで（作り直した後の大きさで数える。docs/decisions/0037）※仮決め |

## 4. RLS とロール（docs/decisions/0034）
### ロール
どのロールにも BYPASSRLS とスーパーユーザーは付けない（Cloud SQL で付けられるかに頼らない。RLS を素通りさせたいロールには、下の「ロールごとのポリシー」で `USING (true)` を付ける）。

| ロール | ログイン | 使うところ | 権限 | 利用者の表（users・options・achievements）のポリシー |
|--------|----------|------------|------|------|
| `ol_migrator` | する | dbmate（マイグレーション）、テストの後始末、性能用データの投入、週 1 の書き出し、復旧の訓練の数え上げ | 表・ビュー・関数の持ち主 | `USING (true) WITH CHECK (true)` |
| `ol_app` | する | アプリ（Cloud Run のサービス） | users・options・achievements の SELECT / INSERT / UPDATE / DELETE、マスターデータの SELECT、events の INSERT、§4 の認証の関数の EXECUTE。表の持ち主ではない | 自分の行だけ（下の RLS） |
| `ol_cleanup` | する | 削除のジョブ（§5）だけ | users・options・achievements・events・auth_attempts の SELECT / DELETE だけ（UPDATE・INSERT はない） | `USING (true)`（SELECT・DELETE のポリシーだけ） |
| `ol_metrics` | する | `npm run metrics:usage`（metrics.md §6）だけ | 集計のビュー（`usage_*`）の SELECT だけ。表は読めない（docs/decisions/0043） | なし（表の権限がない） |
| `ol_definer` | しない | 認証の関数と集計のビューの持ち主 | 関数とビューの中で必要な表だけを読む・書く | `USING (true) WITH CHECK (true)` |
| `ol_incident` | しない | 障害対応で中身を見るときだけ（docs/decisions/0043） | users・options・achievements・events の SELECT だけ | `USING (true)`（SELECT のポリシーだけ） |

- 本番で中身を見るのは障害対応のときだけにする。そのときだけ、Cloud SQL の IAM の管理用ユーザーに `ol_incident` を付け（`GRANT ol_incident TO <IAM のユーザー>`）、終わったらすぐ外す（`REVOKE`）。付けた・外したことは Cloud Audit Logs に残り、日付と理由を `docs/ops/data-access.md` に書く。IAM の管理用ユーザーそのものには、利用者の表のポリシーを付けない（ふだんは 0 行しか見えない）
- `USING (true)` のポリシーを持ってよいのは、上の表の `ol_migrator`・`ol_cleanup`・`ol_definer`・`ol_incident` だけ（testing.md §7 で確かめる）
- `ol_app` は、ほかの `ol_*` ロールのメンバーにしない（ポリシーは `TO` に書いたロールのメンバーにも効くので、メンバーになると全員の行が見える。PostgreSQL 16 からは、ロールを作ったロールに自動でメンバーシップが付くことがあるので、`ol_*` を作るのは `ol_app` 以外のロールで行う）

### RLS
- users・options・achievements は `ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY`（持ち主にも効かせる）にする。ポリシーは `TO <ロール>` でロールごとに分けて付ける（上の表の右の列）。ポリシーがないロールは、権限があっても 1 行も読めない・書けない
- `ol_app` のポリシーは「`user_id`（users は `id`）＝ `NULLIF(current_setting('app.user_id', true), '')::bigint`」を、USING と WITH CHECK の両方に付ける
  - `current_setting(…, true)` は、一度も設定していなければ NULL を返す。ただし同じ接続で一度 `SET LOCAL` したあとは、トランザクションが終わっても空文字を返す。`''::bigint` はエラーになるので `NULLIF` で包む。設定していなければ NULL と比べることになり、行は 0 件になる（書き込みは WITH CHECK で失敗する）
- アプリは、利用者のデータに触る SQL を必ず `UserScopedDatabase.run(fn)` の中で流す。`run` は 1 つのトランザクションで、最初に `SELECT set_config('app.user_id', $1, true)`（`SET LOCAL` と同じ）を流す。トランザクションの外で SQL を流さない（接続プールで、前の人の値が残った接続を使い回さないため）。いくつかの SQL をまとめて成功・失敗させたいとき（並び替えの振り直しなど）は、同じ `run` の中で流す。これは lint で強制する（architecture.md §2 の L13）
- 提案を入れ替えるマイグレーション（§2）の `UPDATE options SET suggestion_id = NULL` は、`ol_migrator` の `USING (true)` のポリシーで全員の行に効く。マイグレーションのテストで、ほかの人の行にも効くことを確かめる
- RLS の対象外の表（許可リスト。testing.md §7）: マスターデータの themes・suggestions・tags・suggestion_tags（全員に同じものを見せる）、events（`ol_app` は INSERT だけ）、auth_attempts（`ol_app` は関数を通してだけ触る）

### 認証の関数（`SECURITY DEFINER`、持ち主は `ol_definer`、`search_path` を固定する）
RLS の中では「鍵から人を探す」ことができない（まだ誰か分からないので）。そこで、次の関数だけに限って、表を横断して探せるようにする。どれも 1 人分の結果だけを返し、一覧は返さない。
結果の `status` は `'ok'`・`'not_found'`・`'rate_limited'`（`auth_restore` だけは `'needs_confirm'` もある）のどれか。`'rate_limited'` のときは `retry_after_seconds` も返す（api.md §3 の 429 の `Retry-After`）。

| 関数 | 返すもの | 内容 |
|------|----------|------|
| `auth_find_user(session_hash bytea)` | `(user_id bigint, last_seen_at timestamptz)`。なければ 0 行 | 鍵のハッシュから人を探す。`last_seen_at` も返すので、「今日もう書いたか」（api.md §6）のために users を読み直さない |
| `auth_create_user(session_hash bytea, ip_hash bytea)` | `(status text, user_id bigint, retry_after_seconds int)` | その IP から 1 時間に作ったアカウントが上限（api.md §6）未満なら、users に 1 行入れて `ok` と ID を返す。上限なら `rate_limited`。どちらでも auth_attempts に 1 行入れる |
| `auth_restore(code_hash bytea, new_session_hash bytea, ip_hash bytea, current_user_id bigint, replace boolean)` | `(status text, user_id bigint, retry_after_seconds int, local_item_count int)` | 先に回数を数え、上限なら（コードが合っていても）`rate_limited`。合わなければ `not_found`。合っていて、`current_user_id` がコードの人と別で、その人に項目か達成があり、`replace` が false なら、何も変えずに `needs_confirm` と、その人の項目（options）の件数を返す。それ以外で合えば、`session_hash` を置き換え、`recovery_code_hash` を NULL にして `ok` と ID を返す（古いアカウントを消すのはアプリ。api.md §6）。どの結果でも auth_attempts に 1 行入れる |

## 5. 保存期間と削除（docs/decisions/0040）
| 消すもの | 条件 | 消し方 |
|----------|------|--------|
| アカウント（項目・達成・写真も） | `last_seen_at` から 5 年 | 毎日のジョブ |
| 項目も達成もないアカウント | 項目も達成もなく、`last_seen_at` から 30 日（使い続けている人が項目を全部消しても、使っている間は消さない） | 毎日のジョブ |
| events | `received_at` から 90 日 | 毎日のジョブ |
| auth_attempts | `occurred_at` から 7 日 | 毎日のジョブ |
| どの行からも指されていない写真のファイル | 置いてから 1 日 | 毎日のジョブ |
| 本人が「すべてのデータを消す」を押したアカウント | すぐ | `DELETE /api/account`（api.md §6） |

- ジョブは `backend/src/jobs/cleanup.ts`（Cloud Run Job。Cloud Scheduler が毎日 4 時〈日本時間〉に動かす）。`ol_cleanup` で接続する
- アカウントを消すときは、先に写真のファイル名を読み、行を消してから（options・achievements は CASCADE で消える）ファイルを消す。ファイルを消せなかったら、ログ（`kind: orphan_file_error`）に出し、次の日のジョブの「行のない写真」で拾い直す
- 消した件数は、種類ごとにログ（`kind: cleanup_result`）に出す（metrics.md §8）

## 6. バックアップ（docs/decisions/0041）
Cloud SQL の自動バックアップと時点復旧は、**インスタンス全体**が単位になる。インスタンスは確認用・今後のアプリと共用している（docs/decisions/0035）ので、戻すときに共用のインスタンスをその場で巻き戻さない。

- 共用のインスタンスで、自動バックアップを毎日・7 日分残し、時点復旧を有効にする。インスタンスを消してもバックアップを残す設定と、削除保護を付ける（`npm run infra:check -- instance` で確かめる）
- 週 1 回（日曜 5 時〈日本時間〉）、Cloud Run Job が `ol_migrator` で `pg_dump --enable-row-security` を流し、`optionlist_production` の DB だけを別の入れ物（`optionlist-backups`、35 日で消える）に書き出す（`--enable-row-security` を付けないと、RLS のある表で止まる。`ol_migrator` は `USING (true)` なので全員の行が出る）
- 写真の入れ物は、消したものを 7 日間戻せる設定（soft delete）にする
- 戻すとき: 自動バックアップか時点復旧で**新しい一時的なインスタンス**を作り、そこから `optionlist_production` の DB だけを書き出して、本番の DB に入れ直す（ほかの DB は戻さない）。週 1 の書き出しから戻すときも、入れ直すのは `optionlist_production` だけ。戻したときに行と写真の食い違いがあれば、行のない写真は消し、写真のない行は `photo_filename` を NULL にする
- 四半期に 1 回、`npm run ops:restore-drill -- <staging|production>` で、最新の自動バックアップを一時的なインスタンス（名前は `restore-drill-<YYYYMMDDHHmm>`。Cloud SQL は消したインスタンスの名前をしばらく使い直せないので、毎回変える）に戻し、`ol_migrator` で `optionlist_<env>` の利用者の表（users・options・achievements）の件数と、行と写真の食い違いを数えて、今の `optionlist_<env>` と比べる（metrics.md §8）。**今の利用者の表が 0 件のときは失敗にする**（数え方の誤りで、0 件どうしが一致して成功に見えるのを防ぐ。マスターデータは件数に含めない）。終わったら一時的なインスタンスを消す。結果は `docs/ops/restore-drills.md` の表（`| 日付 | optionlist_<env> | 表ごとの件数 | 食い違い | 結果 |`）に 1 行足す
- 訓練を確認用（`staging`）でもできるのは、仕組みを本番の前に確かめるため（R10）。本番の訓練は、本番に利用者の行が入ってから（公開の 1 段目。docs/decisions/0045）行い、その後は四半期ごとに本番で行う
- 一時的なインスタンスは、運営者だけが触る（確認用の環境ではない）。確認用の環境には、本番のデータもバックアップもコピーしない（docs/decisions/0036）
