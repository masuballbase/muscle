"use client";
import { useEffect, useRef, useState } from "react";
import { useTraining } from "./training-context";
import { Sheet, ExerciseManager } from "./exercise-manager";
import { useDialogHistory } from "./dialog-history";
import {
  type Menu,
  type MenuDraft,
  draftOf,
  formalize,
  fromHistory,
  availableMenu,
  addDraftExercise,
  reorderDraft,
} from "@/lib/menus/model";
import type { Exercise } from "@/lib/training/model";
export function MenuExercisePicker({
  onSelect,
  onClose,
}: {
  onSelect: (e: Exercise) => void;
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const { close, confirmed } = useDialogHistory(onClose, dirty);
  return (
    <ExerciseManager
      onDirty={setDirty}
      onClose={confirmed}
      onSelect={(exercise) => {
        onSelect(exercise);
        close();
      }}
    />
  );
}
export function MenuManager({
  onClose,
  onSelect,
  initial,
}: {
  onClose: () => void;
  onSelect?: (menu: Menu) => void;
  initial?: MenuDraft;
}) {
  const { controller, menus, exercises, workouts } = useTraining();
  const [selected, setSelected] = useState<Menu | null>(null);
  const [draft, setDraft] = useState<MenuDraft | null>(initial ?? null);
  const [pending, setPending] = useState<MenuDraft | null>(null);
  const [drafts, setDrafts] = useState<MenuDraft[]>([]);
  const [mode, setMode] = useState<"list" | "new" | "history">("list");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const sequence = useRef(0);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const drag = useRef<number | null>(null);
  const selectionAfterClose = useRef<Menu | null>(null);
  const { close } = useDialogHistory(
    () => {
      const selected = selectionAfterClose.current;
      selectionAfterClose.current = null;
      onClose();
      if (selected) onSelect?.(selected);
    },
    false,
    busy || status === "端末保存失敗" || status === "下書きを保存中",
  );
  useEffect(() => {
    let active = true;
    void controller
      .drafts()
      .then((rows) => {
        if (active) setDrafts(rows);
      })
      .catch(() => {
        if (active) setError("端末下書きを読み込めません。");
      });
    return () => {
      active = false;
    };
  }, [controller]);
  useEffect(() => {
    if (!draft) return;
    const number = ++sequence.current;
    let active = true;
    const unchanged =
      !!draft.base &&
      draft.name === draft.base.name &&
      JSON.stringify(draft.items) ===
        JSON.stringify(
          draft.base.items.map((item) => ({
            ...item,
            plannedSets: String(item.plannedSets),
          })),
        );
    writing.current = (async () => {
      await Promise.resolve();
      if (active) setStatus("下書きを保存中");
      try {
        if (unchanged) await controller.discardDraft(draft.id);
        else await controller.saveDraft(draft);
        if (active && sequence.current === number) {
          setStatus(
            unchanged ? "正式メニューと同じ内容" : "端末下書き保存済み",
          );
          setError((previous) =>
            previous.startsWith("下書きを保存できません") ? "" : previous,
          );
        }
      } catch {
        if (active && sequence.current === number) {
          setStatus("端末保存失敗");
          setError("下書きを保存できません。画面を閉じず再試行してください。");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [controller, draft]);
  async function open(menu: Menu) {
    setError("");
    try {
      const local = await controller.loadDraft(menu.id);
      if (local) setPending(local);
      else
        setDraft({
          ...draftOf(menu),
          items: draftOf(menu).items.filter((item) =>
            exercises.some((e) => e.id === item.exerciseId && !e.archived_at),
          ),
        });
    } catch {
      setError("下書きを確認できません。");
    }
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await writing.current;
      const menu = formalize(draft, exercises);
      await controller.saveMenu(menu, draft.base);
      setDraft(null);
      setStatus("正式保存済み");
      setDrafts(await controller.drafts());
      setMode("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "正式保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (
      !draft ||
      !window.confirm("この下書きを破棄しますか？正式メニューは変更しません。")
    )
      return;
    try {
      await writing.current;
      await controller.discardDraft(draft.id);
      setDraft(null);
      setStatus("");
      setError("");
      setDrafts(await controller.drafts());
    } catch {
      setError("下書きを破棄できませんでした。");
    }
  }
  async function remove() {
    if (
      !draft?.base ||
      !window.confirm(
        `「${draft.name}」を削除しますか？過去の記録は保持されます。`,
      )
    )
      return;
    setBusy(true);
    try {
      await writing.current;
      await controller.deleteMenu(draft.base);
      setDraft(null);
      setStatus("削除済み");
      setDrafts(await controller.drafts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  const heading = onSelect ? "メニューを選択" : "メニュー管理";
  return (
    <Sheet title={heading} onClose={close}>
      {error && <p role="alert">{error}</p>}
      {!draft && status && <p role="status">{status}</p>}
      {pending ? (
        <section>
          <h3>保存されている下書きがあります</h3>
          <button
            onClick={() => {
              setDraft(pending);
              setPending(null);
            }}
          >
            下書きを再開
          </button>
          <button
            onClick={async () => {
              if (!window.confirm("下書きを破棄しますか？")) return;
              try {
                await controller.discardDraft(pending.id);
                const formal = menus.find((m) => m.id === pending.id);
                setPending(null);
                setDraft(
                  formal
                    ? {
                        ...draftOf(formal),
                        items: draftOf(formal).items.filter((item) =>
                          exercises.some(
                            (e) => e.id === item.exerciseId && !e.archived_at,
                          ),
                        ),
                      }
                    : null,
                );
                setDrafts(await controller.drafts());
              } catch {
                setError("下書きを破棄できませんでした。");
              }
            }}
          >
            下書きを破棄
          </button>
        </section>
      ) : draft ? (
        <>
          <p role="status">{status}</p>
          <fieldset disabled={busy}>
            <label htmlFor="menu-name">メニュー名</label>
            <input
              id="menu-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <ol className="menu-items">
              {draft.items.map((item, index) => {
                const exercise = exercises.find(
                  (e) => e.id === item.exerciseId && !e.archived_at,
                );
                return exercise ? (
                  <li
                    key={item.id}
                    draggable
                    data-menu-index={index}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", String(index))
                    }
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (Number.isInteger(from))
                        setDraft(reorderDraft(draft, from, index));
                    }}
                  >
                    <div>
                      <button
                        type="button"
                        className="drag-handle"
                        aria-label={`${exercise.name}をドラッグで並び替え`}
                        onPointerDown={(e) => {
                          if (e.pointerType === "mouse") return;
                          drag.current = index;
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (drag.current === null) return;
                          const target = document
                            .elementFromPoint(e.clientX, e.clientY)
                            ?.closest("[data-menu-index]");
                          const position = Number(
                            target?.getAttribute("data-menu-index"),
                          );
                          if (target && position !== drag.current) {
                            setDraft(
                              reorderDraft(draft, drag.current, position),
                            );
                            drag.current = position;
                          }
                        }}
                        onPointerUp={() => {
                          drag.current = null;
                        }}
                      >
                        ⠿
                      </button>
                      <strong>{exercise.name}</strong>
                    </div>
                    <label>
                      予定セット数
                      <input
                        aria-label={`${exercise.name}の予定セット数`}
                        inputMode="numeric"
                        value={item.plannedSets}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            items: draft.items.map((i) =>
                              i.id === item.id
                                ? { ...i, plannedSets: e.target.value }
                                : i,
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="button-row">
                      <button
                        disabled={index === 0}
                        onClick={() =>
                          setDraft(reorderDraft(draft, index, index - 1))
                        }
                        aria-label={`${exercise.name}を上へ`}
                      >
                        ↑
                      </button>
                      <button
                        disabled={index === draft.items.length - 1}
                        onClick={() =>
                          setDraft(reorderDraft(draft, index, index + 1))
                        }
                        aria-label={`${exercise.name}を下へ`}
                      >
                        ↓
                      </button>
                      <button
                        onClick={() =>
                          setDraft({
                            ...draft,
                            items: draft.items.filter((i) => i.id !== item.id),
                          })
                        }
                      >
                        除外
                      </button>
                    </div>
                  </li>
                ) : null;
              })}
            </ol>
            <button onClick={() => setPicker(true)}>
              メニューに種目を追加
            </button>
            <div className="button-row">
              <button className="primary" onClick={save}>
                正式メニューを保存
              </button>
              <button onClick={close}>下書きを残して閉じる</button>
            </div>
            {status === "端末保存失敗" && (
              <button onClick={() => setDraft({ ...draft })}>
                下書き保存を再試行
              </button>
            )}
            <button onClick={discard}>この下書きを破棄</button>
            {draft.base && (
              <button className="danger" onClick={remove}>
                メニューを削除
              </button>
            )}
          </fieldset>
          {picker && (
            <MenuExercisePicker
              onClose={() => setPicker(false)}
              onSelect={(exercise) =>
                setDraft(addDraftExercise(draft, exercise.id))
              }
            />
          )}
        </>
      ) : mode === "new" ? (
        <div className="button-row">
          <button onClick={() => setDraft(draftOf())}>ゼロから作成</button>
          <button onClick={() => setMode("history")}>
            終了済み履歴から作成
          </button>
        </div>
      ) : mode === "history" ? (
        <>
          <h3>元にする終了済み履歴</h3>
          {workouts
            .filter((w) => w.endedAt)
            .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
            .map((w) => (
              <button
                className="menu-card"
                key={w.id}
                onClick={() => setDraft(fromHistory(w))}
              >
                {w.name} · {new Date(w.startedAt).toLocaleString("ja-JP")}
                {w.revision !== w.syncedRevision ? "（未同期）" : ""}
              </button>
            ))}
        </>
      ) : (
        <>
          <div className="button-row">
            {!onSelect && (
              <button onClick={() => setMode("new")}>新規作成</button>
            )}
            <button onClick={() => void controller.initialize()}>
              一覧を再読み込み
            </button>
          </div>
          {menus.map((saved) => {
            const menu = availableMenu(saved, exercises);
            return (
              <article className="menu-card" key={menu.id}>
                <button
                  className="wide"
                  disabled={!!onSelect && menu.needsFix}
                  onClick={() =>
                    onSelect ? setSelected(menu) : void open(saved)
                  }
                >
                  <strong>{menu.name}</strong>
                  <span>
                    {menu.needsFix
                      ? "要修正・適用不可"
                      : menu.items
                          .map(
                            (item) =>
                              `${exercises.find((e) => e.id === item.exerciseId)?.name} ${item.plannedSets}セット`,
                          )
                          .join(" / ")}
                  </span>
                </button>
                {onSelect && !menu.needsFix && selected?.id === menu.id && (
                  <button
                    className="primary"
                    onClick={() => {
                      selectionAfterClose.current = menu;
                      close();
                    }}
                  >
                    このメニューを確定
                  </button>
                )}
              </article>
            );
          })}
          {!menus.length && (
            <p className="muted">保存済みメニューはありません。</p>
          )}
          {!onSelect &&
            drafts
              .filter((d) => !menus.some((m) => m.id === d.id))
              .map((d) => (
                <button
                  className="menu-card"
                  key={d.id}
                  onClick={() => setPending(d)}
                >
                  未保存の下書き：{d.name || "名称未入力"}
                </button>
              ))}
        </>
      )}
    </Sheet>
  );
}
