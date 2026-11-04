# 筋トレ記録アプリ

個人用の筋トレ記録アプリ。Phase 2では認証・4タブ・ユーザー別IndexedDBの基盤に、種目管理、トレーニング記録、保存・同期、終了サマリー・PRを追加しています。

- [確定仕様書](docs/workout_app_v1_integrated_spec.md)
- [開発手順](docs/development.md)
- [Phase 1の実装・DB確認・テスト・残課題](docs/phase1.md)
- [Phase 1追加検証：CRUD・RLS動作・ブラウザ](docs/phase1-verification.md)
- [Phase 2の実装・保存方式・検証結果](docs/phase2.md)

Phase 3のアプリ実装を追加しています。**実APIの競合応答4件はHTTP 409／PT409で成功し、実DB検証63項目が全成功しました。最新カタログ監査は未検証のため、最終完了判定は保留です。**

- [Phase 3の実装・検証・SQL適用手順](docs/phase3.md)
