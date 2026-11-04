"use client";
import { useState } from "react";
import { Sheet } from "./exercise-manager";
import { useDialogHistory } from "./dialog-history";
import { useTraining } from "./training-context";
import { ExportService } from "@/lib/export/service";
export function DataExport({
  service,
  onClose,
}: {
  service: ExportService;
  onClose: () => void;
}) {
  const { controller } = useTraining(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Awaited<
      ReturnType<ExportService["create"]>
    > | null>(null);
  const { close } = useDialogHistory(onClose, false, busy);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const value = await controller.withExportLock(() =>
        service.create({
          volatileInputAtRisk:
            controller.snapshot().saveState === "端末保存失敗",
        }),
      );
      setResult(value);
      const blob = new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
        url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `muscle-data-${value.exportedAt.replace(/[:.]/g, "-")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "出力できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="JSONエクスポート" onClose={close}>
      <p>
        自分のサーバー保存済み8テーブルと、この端末の未同期セッション・メニュー下書きを出力します。同じIDでもサーバー版と端末版を統合しません。
      </p>
      <p className="muted">
        オフライン時は、過去に全件取得した出力用キャッシュがあれば使用します。取得歴がなければサーバーデータは含まれません。保存失敗した最新入力が含まれるとは保証できません。
      </p>
      <p className="muted">
        JSONのインポート・復元機能はありません。パスワード・認証トークン・秘密鍵は出力対象外です。
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary wide"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "データを確認中" : "JSONファイルを出力"}
      </button>
      {result && (
        <section aria-label="出力結果">
          <h3>出力結果</h3>
          <p>
            サーバー：
            {result.server.confirmation === "fresh"
              ? "今回全件取得"
              : result.server.confirmation === "cached"
                ? "過去の取得済みキャッシュ・最新未確認"
                : "取得できず・含まれません"}
          </p>
          <p>最終取得確認：{result.server.lastConfirmedAt ?? "なし"}</p>
          <p>
            端末未同期セッション {result.counts.devicePendingSessions}件 ／
            メニュー下書き {result.counts.deviceMenuDrafts}件
          </p>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}
