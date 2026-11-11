# 復旧の訓練の記録

data.md §6 の訓練の結果。`npm run ops:restore-drill -- <staging|production>` が 1 回に 1 行足す（手で書き換えない）。

- 表ごとの ID の数: バックアップの前後に残っていた ID（S′）の数。すべて戻した DB にあれば成功の条件の 1 つを満たす
- 行があるのに写真がない: S′ の達成のうち、前後で写真が変わっていないのに、ファイルが今の入れ物にない件数（0 で成功）
- 途中で止まったときは、数えずに `-` で `失敗` と書く。四半期ごとに本番（`optionlist_production`）で行う（metrics.md §8）

| 日付 | DB | 表ごとの ID の数 | 行があるのに写真がない | 結果 |
|------|----|------------------|------------------------|------|
| 2026-11-11 | optionlist_staging | users 2・options 5・achievements 2 | 0 | 成功 |
| 2026-11-12 | optionlist_staging | users 2・options 5・achievements 2 | 0 | 成功 |
