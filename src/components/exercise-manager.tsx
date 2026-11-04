"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  type Exercise,
  type RecordType,
  typeLabels,
} from "@/lib/training/model";
import { useTraining } from "./training-context";
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      className="sheet"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="sheet-heading">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label={`${title}を閉じる`}>
          閉じる
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ExerciseManager({
  onClose,
  onSelect,
  onDirty,
}: {
  onClose: () => void;
  onSelect?: (exercise: Exercise) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { controller, exercises } = useTraining();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [original, setOriginal] = useState<Exercise | null>(null);
  const [used, setUsed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    !!editing &&
    (!original ||
      editing.name !== original.name ||
      editing.record_type !== original.record_type);
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => {
    if (!dirty || window.confirm("保存していない変更を破棄しますか？"))
      onClose();
  };
  async function edit(exercise: Exercise) {
    setChecking(true);
    setError("");
    try {
      const isUsed = await controller.isUsed(exercise.id);
      setUsed(isUsed);
      setOriginal(exercise);
      setEditing({ ...exercise });
    } catch {
      setError("使用状況を確認できません。接続を確認してください。");
    } finally {
      setChecking(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await controller.saveExercise(editing, !original);
      setEditing(null);
      setOriginal(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "保存できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !original ||
      !window.confirm(
        `「${original.name}」を削除しますか？過去の記録は保持されます。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await controller.removeExercise(original);
      setEditing(null);
      setOriginal(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "削除できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={onSelect ? "種目を追加" : "種目管理"} onClose={close}>
      {error && <p role="alert">{error}</p>}
      {editing ? (
        <form onSubmit={save}>
          <label htmlFor="exercise-name">種目名</label>
          <input
            id="exercise-name"
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            required
            maxLength={200}
          />
          <label htmlFor="record-type">記録タイプ</label>
          <select
            id="record-type"
            value={editing.record_type}
            disabled={used}
            onChange={(e) =>
              setEditing({
                ...editing,
                record_type: e.target.value as RecordType,
              })
            }
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {used && (
            <p className="muted small">
              使用済みのため記録タイプは変更できません。
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("保存していない変更を破棄しますか？")
                ) {
                  setEditing(null);
                  setOriginal(null);
                }
              }}
            >
              キャンセル
            </button>
            <button className="primary" disabled={busy}>
              保存
            </button>
          </div>
          {original && (
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={remove}
            >
              この種目を削除
            </button>
          )}
        </form>
      ) : (
        <>
          <label htmlFor="exercise-search">種目を検索</label>
          <input
            id="exercise-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="primary"
            onClick={() => {
              setOriginal(null);
              setUsed(false);
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                record_type: "weight_reps",
                archived_at: null,
              });
            }}
          >
            種目を登録
          </button>
          <ul className="exercise-list">
            {exercises
              .filter(
                (e) =>
                  !e.archived_at &&
                  e.name
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
              )
              .map((exercise) => (
                <li key={exercise.id}>
                  <button
                    disabled={checking || busy}
                    onClick={() =>
                      onSelect ? onSelect(exercise) : void edit(exercise)
                    }
                  >
                    {exercise.name}
                    <span className="muted small">
                      {typeLabels[exercise.record_type]}
                    </span>
                  </button>
                  {onSelect && (
                    <button
                      disabled={checking || busy}
                      onClick={() => void edit(exercise)}
                      aria-label={`${exercise.name}を編集`}
                    >
                      編集
                    </button>
                  )}
                </li>
              ))}
          </ul>
          {!exercises.some((e) => !e.archived_at) && (
            <p className="muted">
              種目はまだありません。自分の種目を登録してください。
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
