"use client";
import { useState } from "react";
import { Sheet } from "./exercise-manager";
import { useDialogHistory } from "./dialog-history";
import { useInBody } from "./inbody-context";
import { type CsvRow } from "@/lib/inbody/csv";
import {
  duplicate,
  metricValue,
  fieldIssues,
  normalizeCell,
  validDay,
} from "@/lib/inbody/model";
import { verifiedCsvProfile } from "@/lib/inbody/profile";
export function InBodyImport({
  filename,
  preview,
  onClose,
}: {
  filename: string;
  preview: { headers: string[]; rows: CsvRow[]; issues: string[] };
  onClose: () => void;
}) {
  const { controller, records } = useInBody();
  const [rows, setRows] = useState(preview.rows),
    [busy, setBusy] = useState(false);
  const pending = rows.some((r) => !["saved", "skipped"].includes(r.state));
  const { close } = useDialogHistory(onClose, pending, busy);
  function patch(id: string, value: Partial<CsvRow>) {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...value } : r)));
  }
  async function save() {
    if (!verifiedCsvProfile) return;
    setBusy(true);
    try {
      for (const row of rows) {
        if (["saved", "skipped"].includes(row.state)) continue;
        if (row.action === "skip") {
          patch(row.id, { state: "skipped", error: "" });
          continue;
        }
        try {
          if (!validDay(row.measuredOn) || row.issues.length)
            throw new Error("測定日と入力エラーを修正してください。");
          const fresh = await controller.fresh();
          if (duplicate(fresh, row.measuredOn, row.rawFields)) {
            patch(row.id, {
              state: "skipped",
              error: "完全一致のため重複スキップ",
            });
            continue;
          }
          if (
            fresh.some((r) => r.measuredOn === row.measuredOn) &&
            row.action === "undecided"
          )
            throw new Error(
              "同日異値：追加・置換・スキップを選択してください。",
            );
          if (row.action === "replace" && !row.replaceId)
            throw new Error("置換する測定を指定してください。");
          const result = await controller.importRow(
            {
              id: row.id,
              measuredOn: row.measuredOn,
              importedAt: new Date().toISOString(),
              sourceFilename: filename,
              rawFields: row.rawFields,
            },
            row.action === "replace" ? row.replaceId : undefined,
          );
          patch(row.id, {
            state: result === "duplicate" ? "skipped" : "saved",
            error: result === "duplicate" ? "完全一致のため重複スキップ" : "",
          });
        } catch (e) {
          patch(row.id, {
            state: "failed",
            error: e instanceof Error ? e.message : "保存に失敗しました。",
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="CSV取り込みプレビュー" onClose={close}>
      <p>
        {filename}・{preview.headers.length}項目・{rows.length}行
      </p>
      <p>
        まだ正式保存されていません。同日・44項目が完全一致する別の実測は、自動では区別できずスキップされます。
      </p>
      {preview.issues.length > 0 && (
        <ul role="alert">
          {preview.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {!verifiedCsvProfile && (
        <p>
          実CSVの44ヘッダー・単位・筋肉量と骨格筋量の対応を確認後に、正式取り込みを有効にします。
        </p>
      )}
      {rows.map((row) => {
        const exact = duplicate(records, row.measuredOn, row.rawFields),
          sameDay = records.filter((r) => r.measuredOn === row.measuredOn),
          locked = busy || ["saved", "skipped"].includes(row.state);
        return (
          <section
            className="panel"
            key={row.id}
            aria-label={`CSV ${row.line}行`}
          >
            <h3>
              {row.line}行目：
              {row.state === "saved"
                ? "正式保存済み"
                : row.state === "skipped"
                  ? "スキップ"
                  : row.state === "failed"
                    ? "保存失敗"
                    : "未保存"}
            </h3>
            <label>
              測定日（{row.line}行）
              <input
                type="date"
                disabled={locked}
                value={row.measuredOn}
                onChange={(e) =>
                  patch(row.id, { measuredOn: e.target.value, error: "" })
                }
              />
            </label>
            {!validDay(row.measuredOn) && (
              <p role="alert">{row.line}行：測定日を確認してください。</p>
            )}
            {exact ? (
              <p>完全一致：重複としてスキップします。</p>
            ) : sameDay.length > 0 ? (
              <>
                <label>
                  同日異値の処理
                  <select
                    aria-label={`同日異値の処理（${row.line}行）`}
                    disabled={locked}
                    value={row.action}
                    onChange={(e) =>
                      patch(row.id, {
                        action: e.target.value as CsvRow["action"],
                      })
                    }
                  >
                    <option value="undecided">選択してください</option>
                    <option value="add">追加</option>
                    <option value="replace">指定した測定を置換</option>
                    <option value="skip">スキップ</option>
                  </select>
                </label>
                {row.action === "replace" && (
                  <label>
                    置換する測定
                    <select
                      aria-label={`置換する測定（${row.line}行）`}
                      disabled={locked}
                      value={row.replaceId}
                      onChange={(e) =>
                        patch(row.id, { replaceId: e.target.value })
                      }
                    >
                      <option value="">測定を選択</option>
                      {sameDay.map((r, index) => (
                        <option key={r.id} value={r.id}>
                          {index + 1}：登録{" "}
                          {new Date(r.importedAt).toLocaleString("ja-JP")} ／{" "}
                          {r.sourceFilename} ／ 体重{" "}
                          {metricValue(r, "weight", verifiedCsvProfile) ?? "—"}
                          kg ／ ID {r.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <label>
                <input
                  className="inbody-skip-checkbox"
                  type="checkbox"
                  disabled={locked}
                  checked={row.action === "skip"}
                  onChange={(e) =>
                    patch(row.id, {
                      action: e.target.checked ? "skip" : "undecided",
                    })
                  }
                />
                この行をスキップ
              </label>
            )}
            {row.error && <p role="status">{row.error}</p>}
            {row.issues.length > 0 && (
              <ul role="alert">
                {row.issues.map((issue, index) => (
                  <li key={index}>
                    {row.line}行・{issue.column}：{issue.message}
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary>
                全{Object.keys(row.rawFields).length}項目を確認・修正
              </summary>
              <div className="inbody-fields">
                {Object.entries(row.rawFields).map(([column, value]) => (
                  <label key={column}>
                    {column}
                    <input
                      aria-label={`${row.line}行 ${column}`}
                      disabled={locked}
                      value={value ?? ""}
                      onChange={(e) => {
                        const rawFields = {
                          ...row.rawFields,
                          [column]: normalizeCell(e.target.value),
                        };
                        patch(row.id, {
                          rawFields,
                          issues: [
                            ...fieldIssues(rawFields, verifiedCsvProfile),
                            ...row.issues.filter((i) =>
                              i.message.startsWith("列数が一致"),
                            ),
                          ],
                          error: "",
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          </section>
        );
      })}
      <p role="status">
        正式保存 {rows.filter((r) => r.state === "saved").length}件 ／ スキップ{" "}
        {rows.filter((r) => r.state === "skipped").length}件 ／ 失敗{" "}
        {rows.filter((r) => r.state === "failed").length}件
      </p>
      <button
        className="primary wide"
        disabled={
          busy || !verifiedCsvProfile || !!preview.issues.length || !pending
        }
        onClick={() => void save()}
      >
        {busy ? "正式保存中" : "確認した行を正式保存"}
      </button>
      <p className="muted small">
        行ごとに保存します。途中で失敗した行は残し、成功済みの行は再送しません。応答が不明な場合は再読み込みで確認してください。
      </p>
    </Sheet>
  );
}
