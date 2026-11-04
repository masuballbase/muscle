# Phase 1 追加検証（2026-11-04）

対象：`masuballbase/muscle` の `feat/phase1-foundation-rebuild`、PR #2。
専用Supabaseプロジェクト：`mcuiikilwrxuylwuljmk`。

## 結果

| 検証 | 成功 | 失敗 | 未検証 |
| --- | --- | --- | --- |
| 自己データのCRUD：8テーブル × A/B × 4操作 | 64 | 0 | — |
| 相手ユーザーからのCRUD拒否：8テーブル × A/B × 4操作 | 64 | 0 | — |
| 未認証からのCRUD拒否：8テーブル × A/Bのデータ × 4操作 | 64 | 0 | — |
| 自己レコードのuser_idを相手へ変更する操作の拒否 | 16 | 0 | — |
| 他ユーザーの親レコードを参照するINSERT/UPDATE拒否 | 20 | 0 | — |
| テストデータの削除・残存確認 | 58 | 0 | — |
| Chromium：A/Bの認証・復元・4タブ・テーマ・ログアウト | 2シナリオ | 0 | — |
| 単体テスト | 9 | 0 | — |
| Lint・型チェック・本番ビルド | 成功 | 0 | — |
| 32個のポリシー定義・件数・適用ロール・条件式の照合 | — | — | 参照権限なし |
| テーブルのRLS有効フラグ、FORCE RLS、ロールのBYPASSRLS、権限設定 | — | — | 参照権限なし |
| 実スマートフォン・Safari・Firefox・ブラウザ完全終了からの復元 | — | — | 今回のChromium検証外 |

DBテストの最終出力：`passed: 286, failed: 0, remainingFixtureEntries: 0`。
これは検証228項目と後片付け58項目の合計。実データが空かどうかに依存せず、今回作成した実在のA/B所有レコードを対象に確認した。

## 8テーブルのCRUD／分離

| テーブル | A自己CRUD | B自己CRUD | B→A／A→BのCRUD拒否 | 未認証CRUD拒否 | 所有者変更拒否 |
| --- | --- | --- | --- | --- | --- |
| exercises | 成功 | 成功 | 成功 | 成功 | 成功 |
| menus | 成功 | 成功 | 成功 | 成功 | 成功 |
| menu_items | 成功 | 成功 | 成功 | 成功 | 成功 |
| sessions | 成功 | 成功 | 成功 | 成功 | 成功 |
| session_exercises | 成功 | 成功 | 成功 | 成功 | 成功 |
| workout_sets | 成功 | 成功 | 成功 | 成功 | 成功 |
| weekly_goal_schedule | 成功 | 成功 | 成功 | 成功 | 成功 |
| inbody_records | 成功 | 成功 | 成功 | 成功 | 成功 |

認証ユーザー同士のSELECT/UPDATE/DELETEは対象UUIDで絞り、取得・変更・削除が0件であることを確認。UPDATE後に所有者で読み直して値が不変、DELETE後に所有者でレコードが残ることも確認した。相手のuser_idを指定したINSERT、所有者変更のUPDATEは42501で拒否された。未認証のCRUDも42501で拒否された。

親子参照の検証は以下の5カラム × A/B × INSERT/UPDATEの20項目。いずれも23503で拒否された。これは参照整合性による拒否を確認したもので、この結果だけからポリシーの定義を推定しない。

- menu_items：menu_id、exercise_id
- session_exercises：session_id、exercise_id
- workout_sets：session_exercise_id

## 既存データを保護する方法

- 書き込み対象は毎回生成したUUID。INSERT前に同IDが存在しないことを確認してから、そのIDを後片付け台帳へ保存する。
- 週間目標は既存データを上書きせず、空いている将来の月曜日に専用レコードを作成。新しいidも付与する。
- UPDATE/DELETEは作成したIDに限定。後片付けではIDに加えてuser_idも条件にする。全件削除・名前による一括削除・既存行のupsertは使わない。
- セッションは終了済み・実施済みセット0件のテスト記録。進行中セッションの一意制約と競合させない。
- 外部キーに合わせて子から削除。正常終了時・エラー時の両方で後片付けを行い、所有者で再読して残存0件を確認。
- 台帳は `/tmp/muscle-phase1-rls-fixtures.json`。パスワード・キー・トークンは保存せず、作成したテストレコードのIDとA/Bラベルのみを保持。最終状態は空配列。
- スキーマ確認途中に制約で拒否された試行も、その都度専用IDの残存0件を確認した。最終試行は全項目成功。

既存テーブル・RLS・関数・インデックス・権限の作成／変更／削除は一切していない。Authアカウントも作成／削除していない。

## カタログ参照の制限と残る確認

この環境に設定されているのはPublishable keyとテスト用メール・パスワード。DB接続資格情報やSupabase管理APIの資格情報はない。

公開REST APIで `pg_catalog.pg_policies` を参照すると `PGRST106`（非公開スキーマ）。`information_schema` も同様。OpenAPI取得は401。したがって「ポリシーが32個あり、その定義・設定が正しい」とは断定できない。動作テストの成功と、定義監査の完了は別に扱う。

[`scripts/inspect-rls.sql`](../scripts/inspect-rls.sql) に、既存の権限あるSQL Editor／DB接続で使う読み取り専用SQLを保存した。今回このSQLは実行していない。BEGIN READ ONLYとSELECTのみで、最後はROLLBACK。確認すべきもの：

1. 対象8テーブルの `relrowsecurity`、ポリシー総数32・各4個・SELECT/INSERT/UPDATE/DELETE。
2. 各ポリシーの適用ロール、PERMISSIVE/RESTRICTIVE、USING/WITH CHECK。特に所有者の絞り込みと所有者変更・他ユーザーの親参照を許さないこと。
3. authenticated/anonのBYPASSRLS・superuser状態、テーブル所有者と権限。FORCE RLSの要否は所有者／実行ロールと併せて判断する。
4. 外部キー、チェック制約。動作テストで確認した制約と定義の整合性。

これらのカタログ結果を取得・照合するまで、定義・設定監査は未完了。DBやRLSの変更で参照権限を追加することはしていない。

## ブラウザ検証

OSにインストール済みのChromiumをPlaywrightから起動し、実Supabase Authで検証した。Aは375×812、Bは1280×900。SupabaseへのHTTPは環境のNodeプロキシ・CAを使って転送し、応答のモックは使っていない。

- 登録済みメール・パスワードでログインし、ユーザー別IndexedDBの利用可能表示を確認。
- 記録・履歴・分析・InBodyをクリックし、URL・見出し・選択タブを確認。横方向のはみ出しなし。
- リロード後も認証状態が復元されることを確認。
- OSのライト／ダーク設定を模擬し、背景色が切り替わることを確認。
- ログアウト後、再リロードしてもログイン画面のままで4タブが表示されないことを確認。

秘密情報を記録しないため、trace・動画・スクリーンショットを無効化。認証ヘッダー、フォーム値、localStorage、レスポンス本文はログに出さない。

## 再実行

```sh
npm run inspect:rls        # 現在は未検証を示す終了コード2
npm run verify:rls         # 専用フィクスチャでDBテスト・自動削除（数分）
npm run verify:rls:cleanup # 中断時、台帳に残る今回のIDだけを削除
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser       # ビルド済みサーバーを3102番で自動起動
```

Chromiumのパスは `MUSCLE_CHROMIUM_PATH` で変更可能（初期値 `/usr/bin/chromium`）。DBテストは同時実行しない。中断時の台帳を消去せず、後片付けを完了してから再実行する。

変更は検証スクリプト・テスト・ドキュメントのみ。アプリ機能、確定仕様書、main、FE学習アプリ、Phase 2には変更を加えていない。
