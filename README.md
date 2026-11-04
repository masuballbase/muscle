# 筋トレ記録アプリ

個人用の筋トレ記録アプリ。Phase 2では認証・4タブ・ユーザー別IndexedDBの基盤に、種目管理、トレーニング記録、保存・同期、終了サマリー・PRを追加しています。

- [確定仕様書](docs/workout_app_v1_integrated_spec.md)
- [開発手順](docs/development.md)
- [Phase 1の実装・DB確認・テスト・残課題](docs/phase1.md)
- [Phase 1追加検証：CRUD・RLS動作・ブラウザ](docs/phase1-verification.md)
- [Phase 2の実装・保存方式・検証結果](docs/phase2.md)

Phase 3は最終監査とmainへのマージが完了しました。Phase 4では、全体分析・週間目標の履歴・種目別PRと成長グラフを追加しています。完了・同期済みの実施済みセットだけを正式集計します。

- [Phase 3の実装・検証・SQL適用手順](docs/phase3.md)

- [Phase 4の実装・分析ルール・検証結果](docs/phase4.md)

Phase 5ではInBodyの最新4指標・6種類のグラフ・CSV取り込み・44項目の測定履歴編集を追加しました。ユーザー提供の列定義と匿名化サンプルで正式な44ヘッダーを確認済みです。

- [Phase 5の実装・CSV保存仕様・検証結果](docs/phase5.md)


Phase 6では、端末保存・再送・競合時の安全停止、オフライン画面、本人データのJSON出力を整備しています。OPEN-02は未同期セッション・メニュー下書きをサーバー版とは別区分で含める方針で確定済みです。**新同期RPCの適用・実DB検証が完了するまでPhase 6の完了判定は保留です。公開・mainへのマージは行っていません。**

- [Phase 6の実装・検証・残課題](docs/phase6.md)
- [JSON出力の形式と確認状況](docs/data-export-format.md)
- [利用開始・公開前確認・デプロイ案](docs/deployment.md)
