"use client";
import { useState } from "react";
import { Sheet } from "./exercise-manager";
import { useDialogHistory } from "./dialog-history";
import { useInBody } from "./inbody-context";
import {
  type Measurement,
  fieldIssues,
  orderedFields,
  normalizeCell,
} from "@/lib/inbody/model";
import { verifiedCsvProfile } from "@/lib/inbody/profile";
export function InBodyDetail({
  record,
  onClose,
}: {
  record: Measurement;
  onClose: () => void;
}) {
  const { controller, busy } = useInBody();
  const [edit, setEdit] = useState<Measurement | null>(null),
    [error, setError] = useState("");
  const dirty = !!edit && JSON.stringify(edit) !== JSON.stringify(record),
    { close } = useDialogHistory(onClose, dirty, busy),
    value = edit ?? record;
  const issues = edit ? fieldIssues(edit.rawFields, verifiedCsvProfile) : [];
  return (
    <Sheet title={edit ? "測定を編集" : "測定詳細"} onClose={close}>
      <p>測定日：{record.measuredOn}</p>
      <p className="small muted">
        登録：{new Date(record.importedAt).toLocaleString("ja-JP")}
        （測定時刻ではありません）
      </p>
      {!verifiedCsvProfile && (
        <p className="muted">
          実CSVの列対応は未確認です。原項目を表示・編集できますが、数値列の検証と指標への対応は実CSV確認待ちです。
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {edit && (
        <label>
          測定日
          <input
            type="date"
            value={edit.measuredOn}
            onChange={(e) => setEdit({ ...edit, measuredOn: e.target.value })}
          />
        </label>
      )}
      <p>
        {Object.keys(value.rawFields).length}項目 ／ 元ファイル：
        {value.sourceFilename ?? "不明"}
      </p>
      <dl className="inbody-fields">
        {orderedFields(value.rawFields, verifiedCsvProfile).map(
          ([key, cell]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {edit ? (
                  <label>
                    <span className="sr-only">{key}</span>
                    <input
                      value={cell ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          rawFields: {
                            ...edit.rawFields,
                            [key]: normalizeCell(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ) : cell === null ? (
                  "—"
                ) : (
                  String(cell)
                )}
              </dd>
            </div>
          ),
        )}
      </dl>
      {issues.length > 0 && (
        <ul role="alert">
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.column}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        {edit ? (
          <>
            <button
              className="primary"
              disabled={busy || !!issues.length}
              onClick={async () => {
                setError("");
                try {
                  await controller.save(edit, record);
                  setEdit(null);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "保存できませんでした。",
                  );
                }
              }}
            >
              測定を正式保存
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("保存していない変更を破棄しますか？")
                ) {
                  setEdit(null);
                  setError("");
                }
              }}
            >
              キャンセル
            </button>
          </>
        ) : (
          <>
            <button
              disabled={busy || Object.keys(record.rawFields).length !== 44}
              onClick={() => setEdit(structuredClone(record))}
            >
              編集
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    `${record.measuredOn}の測定を削除しますか？元に戻せません。`,
                  )
                )
                  return;
                setError("");
                try {
                  await controller.remove(record);
                  close();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "削除できませんでした。",
                  );
                }
              }}
            >
              この測定を削除
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
