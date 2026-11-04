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
