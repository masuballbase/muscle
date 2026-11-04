# Phase 1 基盤

実装基準は `docs/workout_app_v1_integrated_spec.md`。最新 main の初期構成（`1cfdef546522609744c844a9a48448c694bb7d02`）から `feat/phase1-foundation-rebuild` を作成した。

## 実装内容と境界

- `/` 記録、`/history` 履歴、`/analysis` 分析、`/inbody` InBody の4タブ。初期画面は記録。認証前はログイン画面。
- Supabase Auth の登録済みメール・パスワードでログイン。SDK のセッション永続化、トークン自動更新、認証変更の購読、端末からのログアウト。
- 認証エラーは日本語の一般的な説明に置換し、レスポンスや資格情報を表示しない。新規登録・パスワード再発行は今回の対象外。
- IndexedDB v1：ユーザーIDごとに独立したDB、`session_drafts` / `menu_drafts` / `sync_queue`。固定IDでの上書き、取得、一覧、削除、再オープン。トランザクション完了を保存成功の条件とする。
- ユーザー変更・ログアウトで接続を閉じる。ログアウトで端末データを削除しない。未同期データ・下書きがあれば確認、検査不能なら注意を出す。
- スマートフォン優先のレイアウト、下部固定ナビ、safe-area、48px以上の操作領域、OS設定に連動するライト・ダーク。
- 端末保存の利用可否を常時表示。「利用可能」は実データの保存・サーバー同期を意味しない。サイトデータ消去時の注意を表示。

各タブは今後の機能を案内する基盤画面。セッション開始、種目登録、メニュー編集、履歴、分析、InBody取込、同期の実処理、JSON出力はPhase 2以降。サンプル実績や初期種目は入れていない。

## DBの読み取り確認

専用プロジェクト `mcuiikilwrxuylwuljmk` のみを接続先に許可。SQL、DDL、マイグレーションは一切実行していない。既存DB用の再作成SQLも追加していない。

`npm run inspect:db` はテスト用Aアカウントで認証後、PostgREST の `select(column).limit(0)` により、仕様書10章に記載された8テーブルの主要カラムを検査する。実データや資格情報は出力しない。

| テーブル | 確認した主要カラム |
| --- | --- |
| exercises | id, user_id, name, name_normalized, record_type, archived_at |
| menus | id, user_id, name |
| menu_items | menu_id, exercise_id, position, planned_sets |
| sessions | id, user_id, name, started_at, ended_at, status |
| session_exercises | id, session_id, exercise_id, exercise_name_snapshot, record_type_snapshot, position |
| workout_sets | id, session_exercise_id, position, weight_kg, reps, duration_seconds, is_performed |
| weekly_goal_schedule | user_id, effective_monday, target_days |
| inbody_records | id, user_id, measured_on, imported_at, source_filename, raw_fields |

仕様書の推奨属性 `menus.needs_fix` は存在しなかった（42703）。Phase 1では不使用で、DB変更は不要。Phase 3で空メニューの判定方法を既存構成に合わせて検討する。これは確定画面仕様の変更ではない。

OpenAPI経由のスキーマ取得は401だったため、読み取りクエリでカラムの存在を確認した。カラム型・制約・インデックス・トリガー・RLS定義の全件取得まではできていない。ユーザーから引き継いだ「8テーブル・32ポリシー」のうち、8テーブルは確認済み、32ポリシーの件数・定義は独立検証未完了。

## 検証

実施コマンド：

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run inspect:db
npm run verify:supabase
```

単体テストは認証UIの復元・失敗・ログアウト・未同期確認・保存失敗、およびIndexedDBの永続化・ユーザー分離・固定ID上書き・下書き分離・失敗を検証する。

実Supabaseテストは設定済みのA/Bアカウントでログインし、8テーブルを読み取る。所有者カラムが仕様書上明確な5テーブルについて相手のuser_idで絞り込んで非公開を確認し、未認証で8テーブルのデータが取得できないことも確認する。アカウント作成、データの作成・更新・削除は行わない。

**限界：** 取得結果が空の場合、非公開の実データが存在する条件でのRLS証明にはならない。32ポリシーすべてのINSERT/UPDATE/DELETEおよび子テーブルの相互隔離は未検証。専用フィクスチャによる書き込みテストは、後続Phaseで型・制約を確認して実施する。Phase 1は業務テーブルへ書き込まない。

## 手動確認

1. `npm run dev -- --hostname 0.0.0.0` で起動し、登録済みアカウントでログイン。
2. 記録が初期表示され、4タブのURL・選択表示が切り替わること。
3. リロードしてログイン状態が復元されること。ログアウト後にログイン画面になること。
4. 別アカウントでログインし、DevToolsのIndexedDBがユーザー別DBになっていること。
5. 幅375px程度とPC幅、OSライト・ダーク、キーボード操作を確認。
6. 保存制限のあるブラウザで失敗が表示され、「同期済み」にならないこと。

ブラウザ実機でのレスポンシブ・OSテーマ・認証復元の操作確認は別途必要。自動テストのUI検証はjsdomで行う。

## 今回の実行結果（2026-11-04）

- Lint・型チェック・本番ビルド：成功。
- 単体テスト：2ファイル、9件成功。
- 本番サーバー：4ルートともHTTP 200。
- 実認証：A/Bの2アカウント成功、各8テーブルの読み取り成功。
- 相互ユーザー指定：5テーブル×2アカウントで取得0件。
- 未認証：8テーブルすべてで取得不可または0件。
- DB変更・テストデータの作成/更新/削除：なし。
- 秘密情報：コミット対象を環境のテスト資格情報との一致および代表的な鍵・トークン形式で点検し、混入なしを確認。
