"use client";
import { useState } from "react";
import Link from "next/link";
import { useTraining } from "./training-context";
import { Sheet } from "./exercise-manager";
import { MenuManager, MenuExercisePicker } from "./menu-manager";
import { useDialogHistory } from "./dialog-history";
import {
  dayKey,
  monthGrid,
  historyProjection,
  searchHistory,
  editableHistory,
  validateHistory,
} from "@/lib/history/model";
import { fromHistory } from "@/lib/menus/model";
import {
  type Workout,
  type Section,
  type SetRecord,
  addExercise,
  newSet,
  changeSet,
  confirmSet,
  validSet,
  metricLabels,
  summary,
} from "@/lib/training/model";
function localDateTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function HistoryDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { controller, workouts } = useTraining();
  const formal = workouts.find((w) => w.id === id)!;
  const [edit, setEdit] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [createMenu, setCreateMenu] = useState(false);
  const dirty = !!edit && JSON.stringify(edit) !== JSON.stringify(formal);
  const { close } = useDialogHistory(onClose, dirty, busy);
  const w = edit ?? formal;
  const projection = historyProjection(workouts);
  const pr = projection.prsFor(w);
  const total = summary(w, []);
  async function save() {
    if (!edit) return;
    setError("");
    setBusy(true);
    try {
      validateHistory(edit);
      await controller.editHistory(edit);
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "履歴を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(
        `「${formal.name}」を削除しますか？この操作は取り消せません。`,
      )
    )
      return;
    setBusy(true);
    try {
      await controller.deleteHistory(formal);
      setBusy(false);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "履歴を削除できませんでした。");
      setBusy(false);
    }
  }
  function section(id: string, transform: (s: Section) => Section) {
    setEdit((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((s) =>
              s.id === id ? transform(s) : s,
            ),
          }
        : null,
    );
  }
  function setValue(
    s: Section,
    set: SetRecord,
    field: "weight" | "reps" | "seconds",
    value: string,
  ) {
    section(s.id, (current) => ({
      ...current,
      sets: current.sets.map((row) =>
        row.id === set.id ? changeSet(row, field, value, s.type) : row,
      ),
    }));
  }
  return (
    <Sheet title={edit ? "履歴を編集" : "履歴詳細"} onClose={close}>
      {error && <p role="alert">{error}</p>}
      <p>
        {editableHistory(formal)
          ? "同期済み"
          : "終了済み・未同期（同期後に編集・削除できます）"}
      </p>
      <fieldset disabled={busy}>
        {edit ? (
          <>
            <label htmlFor="history-name">セッション名</label>
            <input
              id="history-name"
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <label htmlFor="history-end">終了日時</label>
            <input
              id="history-end"
              type="datetime-local"
              step="1"
              min={localDateTime(edit.startedAt)}
              value={localDateTime(edit.endedAt ?? "")}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  endedAt: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : "",
                })
              }
            />
          </>
        ) : (
          <h3>{w.name}</h3>
        )}
        <p className="small muted">
          開始 {new Date(w.startedAt).toLocaleString("ja-JP")}
          <br />
          終了 {w.endedAt ? new Date(w.endedAt).toLocaleString("ja-JP") : "—"}
          <br />
          実施時間 {Math.floor(total.seconds / 60)}分{total.seconds % 60}秒
        </p>
        {pr.length > 0 && (
          <p>
            PR{editableHistory(w) ? "" : "（暫定）"}：
            {pr
              .map((p) => `${metricLabels[p.metric]} ${p.value.toFixed(1)}`)
              .join(" / ")}
          </p>
        )}
        {w.sections.map((s) => (
          <section className="history-exercise" key={s.id}>
            <h3>{s.name}</h3>
            {edit && (
              <button
                aria-label={`${s.name}を履歴から除外`}
                onClick={() => {
                  if (
                    s.sets.some((set) => set.performed) &&
                    !window.confirm("実施済みセットを含む種目を除外しますか？")
                  )
                    return;
                  setEdit({
                    ...edit,
                    sections: edit.sections.filter((row) => row.id !== s.id),
                  });
                }}
              >
                種目を除外
              </button>
            )}
            {s.sets.map((set, index) => (
              <div className="set-row" key={set.id}>
                <p>セット {index + 1}</p>
                {edit ? (
                  <>
                    <div className="set-inputs">
                      {(s.type === "weight_reps"
                        ? ["weight", "reps"]
                        : s.type === "reps"
                          ? ["reps"]
                          : ["seconds"]
                      ).map((key) => {
                        const field = key as "weight" | "reps" | "seconds";
                        const label =
                          field === "weight"
                            ? "重量（kg）"
                            : field === "reps"
                              ? "回数"
                              : "時間（秒）";
                        return (
                          <label key={field}>
                            {label}
                            <input
                              aria-label={`${s.name} 履歴セット${index + 1} ${label}`}
                              inputMode={
                                field === "weight" ? "decimal" : "numeric"
                              }
                              value={set[field]}
                              onChange={(e) =>
                                setValue(s, set, field, e.target.value)
                              }
                              onBlur={() =>
                                section(s.id, (row) => ({
                                  ...row,
                                  sets: row.sets.map((item) =>
                                    item.id === set.id
                                      ? confirmSet(item, s.type)
                                      : item,
                                  ),
                                }))
                              }
                            />
                          </label>
                        );
                      })}
                    </div>
                    <label>
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={set.performed}
                        disabled={!validSet(set, s.type)}
                        onChange={(e) =>
                          section(s.id, (row) => ({
                            ...row,
                            sets: row.sets.map((item) =>
                              item.id === set.id
                                ? {
                                    ...item,
                                    performed: e.target.checked,
                                    copied: false,
                                  }
                                : item,
                            ),
                          }))
                        }
                      />
                      実施済み
                    </label>
                    <button
                      aria-label={`履歴セット${index + 1}を削除`}
                      onClick={() => {
                        if (window.confirm("このセットを削除しますか？"))
                          section(s.id, (row) => ({
                            ...row,
                            sets: row.sets.filter((item) => item.id !== set.id),
                          }));
                      }}
                    >
                      セットを削除
                    </button>
                  </>
                ) : (
                  <p>
                    {s.type === "weight_reps"
                      ? `${set.weight || "—"} kg × ${set.reps || "—"} 回`
                      : s.type === "reps"
                        ? `${set.reps || "—"} 回`
                        : `${set.seconds || "—"} 秒`}{" "}
                    · {set.performed ? "実施済み" : "未実施"}
                  </p>
                )}
              </div>
            ))}
            {edit && (
              <button
                onClick={() =>
                  section(s.id, (row) => ({
                    ...row,
                    sets: [...row.sets, newSet(s.type, [], row.sets)],
                  }))
                }
              >
                履歴にセットを追加
              </button>
            )}
          </section>
        ))}
        {edit ? (
          <>
            <button onClick={() => setPicker(true)}>履歴に種目を追加</button>
            <div className="button-row">
              <button className="primary" onClick={save}>
                履歴を正式保存
              </button>
              <button
                onClick={() => {
                  if (!dirty || window.confirm("変更を破棄しますか？"))
                    setEdit(null);
                }}
              >
                編集をキャンセル
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="button-row">
              <button
                disabled={!editableHistory(formal)}
                onClick={() => setEdit(structuredClone(formal))}
              >
                編集
              </button>
              <button onClick={() => setCreateMenu(true)}>
                この履歴からメニュー作成
              </button>
            </div>
            <button
              className="danger"
              disabled={!editableHistory(formal)}
              onClick={remove}
            >
              この履歴を削除
            </button>
          </>
        )}
      </fieldset>
      {picker && edit && (
        <MenuExercisePicker
          onClose={() => setPicker(false)}
          onSelect={(e) => setEdit(addExercise(edit, e, []))}
        />
      )}
      <p className="small muted">種目名は記録当時の名称です。</p>
      {createMenu && (
        <MenuManager
          initial={fromHistory(formal)}
          onClose={() => setCreateMenu(false)}
        />
      )}
    </Sheet>
  );
}
export function HistoryView() {
  const { controller, workouts, exercises } = useTraining();
  const [zone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
  );
  const [today] = useState(() => dayKey(new Date(), zone));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const projection = historyProjection(workouts, zone);
  const filtered = searchHistory(projection.completed, query, exercises);
  function changeMonth(delta: number) {
    const [year, number] = month.split("-").map(Number);
    setMonth(
      new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7),
    );
  }
  function card(w: Workout) {
    const stats = summary(w, []);
    const pr = projection.prsFor(w);
    return (
      <button
        className="history-card"
        key={w.id}
        onClick={() => setDetail(w.id)}
      >
        <strong>{w.name}</strong>
        <time>
          {new Date(w.startedAt).toLocaleString("ja-JP", { timeZone: zone })}
        </time>
        <span>
          {w.sections
            .filter((s) => s.sets.some((set) => set.performed))
            .map((s) => s.name)
            .join(" / ") || "実施種目なし"}
        </span>
        <span>
          {stats.exercises}種目 · {stats.sets}セット ·{" "}
          {w.syncedRevision === w.revision ? "同期済み" : "終了済み・未同期"}
        </span>
        {pr.length > 0 && (
          <span>
            PR{w.syncedRevision !== w.revision ? "（暫定）" : ""}：
            {pr.map((p) => metricLabels[p.metric]).join(" / ")}
          </span>
        )}
      </button>
    );
  }
  return (
    <>
      <div className="page-heading">
        <h1>履歴</h1>
        <button
          aria-label="履歴を種目名で検索"
          onClick={() => {
            setSearch(!search);
            if (search) setQuery("");
          }}
        >
          検索
        </button>
      </div>
      {search && (
        <label>
          種目名で検索
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <section className="panel" aria-label="月間カレンダー">
        <div className="calendar-heading">
          <button aria-label="前の月" onClick={() => changeMonth(-1)}>
            ‹
          </button>
          <h2>{month.replace("-", "年")}月</h2>
          <button aria-label="次の月" onClick={() => changeMonth(1)}>
            ›
          </button>
        </div>
        <div className="calendar-grid">
          {"日月火水木金土".split("").map((label) => (
            <span className="weekday" key={label}>
              {label}
            </span>
          ))}
          {monthGrid(month).map((date) => {
            const dot = projection.dots.get(date);
            return (
              <button
                key={date}
                aria-label={`${date}の記録`}
                aria-pressed={day === date}
                className={date.startsWith(month) ? "" : "other-month"}
                onClick={() => setDay(date)}
              >
                <time>{Number(date.slice(-2))}</time>
                {dot && (
                  <span
                    className={`calendar-dot ${dot.pending ? "pending" : ""}`}
                    aria-label={
                      dot.pending
                        ? "実施記録あり・未同期を含む"
                        : "実施記録あり"
                    }
                  >
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="small muted">
          開始日基準 · 点は実施済みセットがある終了記録（未同期は輪郭表示）
        </p>
      </section>
      {projection.active.length > 0 && (
        <section className="panel" aria-label="進行中の記録">
          <h2>進行中</h2>
          <Link
            className="resume-bar"
            href="/"
            onClick={() => controller.open()}
          >
            トレーニングを再開
          </Link>
        </section>
      )}
      <section aria-label="選択日の記録">
        <h2>{day}の記録</h2>
        {filtered.filter((w) => dayKey(w.startedAt, zone) === day).map(card)}
        {!filtered.some((w) => dayKey(w.startedAt, zone) === day) && (
          <p className="muted">この日の記録はありません。</p>
        )}
      </section>
      <section aria-label="直近の記録">
        <h2>直近の記録</h2>
        {projection.completed.some((w) => w.syncedRevision !== w.revision) && (
          <aside role="region" aria-label="未同期の終了済みトレーニング">
            <p>
              終了済み・未同期の記録は端末に保存されています。同期後に正式編集・削除できます。
            </p>
          </aside>
        )}
        {filtered.slice(0, limit).map(card)}
        {!filtered.length && <p className="muted">記録はありません。</p>}
        {filtered.length > limit && (
          <button onClick={() => setLimit(limit + 20)}>さらに表示</button>
        )}
      </section>
      {detail && workouts.some((w) => w.id === detail) && (
        <HistoryDetail id={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
