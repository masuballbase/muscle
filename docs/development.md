# 開発環境

筋トレ記録アプリ専用の Next.js プロジェクト。FE学習アプリへの変更やコード・設定の共有はしない。

Node.js 24、npm、Next.js App Router、TypeScript、Tailwind CSS、Supabase Auth、IndexedDBを使用する。

```sh
npm ci
npm run dev -- --hostname 0.0.0.0
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --hostname 0.0.0.0
```

devとstartは同じポートを使うため、片方を停止してから起動する。以前のソース構成から残った `.next/dev/types` が型エラーを起こす場合は、devを停止して生成物のそのディレクトリだけを削除し、型を再生成する。

## 環境変数

既存の環境設定を使用する。値はコード・ドキュメント・GitHubへ保存しない。

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（公開可能キーのみ）
- `MUSCLE_TEST_A_EMAIL` / `MUSCLE_TEST_A_PASSWORD`
- `MUSCLE_TEST_B_EMAIL` / `MUSCLE_TEST_B_PASSWORD`

テスト用4変数はNode実行専用。ブラウザ用の接頭辞を付けない。service_role・秘密鍵は使用しない。Next.jsの公開環境変数はビルド時に取り込まれるため、本番ビルドにも設定が必要。

```sh
npm run inspect:db
npm run verify:supabase
```

実検証は読み取りのみ。プロキシ環境のNodeでは `NODE_USE_ENV_PROXY=1` を使う（上記スクリプトに設定済み）。資格情報・環境全体・DBレスポンス行をログ出力しない。

詳細は [Phase 1実装報告](phase1.md)、要件は [統合仕様書](workout_app_v1_integrated_spec.md) を参照。

## Phase 1追加検証

[最新の検証結果と制限](phase1-verification.md) を参照。

```sh
npm run inspect:rls
npm run verify:rls
npm run verify:rls:cleanup
npm run build
npm run test:browser
```

`inspect:rls` は読み取りのみで、カタログ参照不可の場合は「未検証」と終了コード2を返す。`verify:rls` は専用UUIDのテストデータを作成・更新・削除し、既存行には書き込まない。正常・異常終了時に後片付けし、中断時は `/tmp/muscle-phase1-rls-fixtures.json` のIDだけを `verify:rls:cleanup` で削除する。同時実行はしない。台帳を手動で削除しない。

ブラウザテストにはChromiumが必要（`MUSCLE_CHROMIUM_PATH`、初期値 `/usr/bin/chromium`）。3102番で本番サーバーを起動する。trace・動画・スクリーンショットは保存しない。

## Phase 2

[Phase 2の実装・検証報告](phase2.md) を参照。`npm run test:browser` はPhase 2以降、専用UUIDの実Supabaseテストデータを作成・更新・削除する。既存進行中セッションがあるアカウントはスキップする。テストは同時実行しない。中断時は台帳を保持したまま次を実行する。

```sh
npm run verify:phase2:cleanup
```

IndexedDBはv2に移行し、cacheストアを追加する。これはブラウザ端末内の変更で、Supabaseのテーブル・RLS・権限は変更しない。
