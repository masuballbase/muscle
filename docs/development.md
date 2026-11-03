# 開発環境

筋トレ記録アプリ専用の独立した Next.js プロジェクトです。
基本情報技術者アプリとのコード・設定・データの共有はありません。

## 初期構成

- Next.js App Router / TypeScript / Tailwind CSS
- Node.js 24、npm（package-lock.json を使用）
- src/app: ルートレイアウト、トップページ、共通スタイル
- @/*: src/* のインポートエイリアス

## セットアップと確認

リポジトリのルートで実行します。

```sh
npm ci
npm run dev -- --hostname 0.0.0.0
```

別のターミナルから HTTP GET / でトップページを確認できます。

```sh
npm run lint
npm run typecheck
npm run build
npm run start -- --hostname 0.0.0.0
```

dev と start は同じポートを使用するため、片方を停止してから起動します。
初期構成では外部サービス、DB、認証情報は不要です。

## 実装範囲

現在は初期構成と準備中のトップページのみです。
要件基準は [統合仕様書](workout_app_v1_integrated_spec.md) です。
今回は初期構成のみとし、仕様書の Phase 1 以降の機能実装は開始していません。
記録・認証・DB・4タブなどは今後段階的に実装します。
Supabase への接続・変更・プロジェクト作成は行っていません。
