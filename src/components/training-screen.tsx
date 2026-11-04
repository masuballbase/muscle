"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTraining, SaveStatus } from "./training-context";
import { ExerciseManager, Sheet } from "./exercise-manager";
import {
  type Section,
  type SetRecord,
  addExercise,
  newSet,
  previousSets,
  copySet,
  changeSet,
  confirmSet,
  validSet,
  metricLabels,
  typeLabels,
} from "@/lib/training/model";
function display(set: SetRecord, type: Section["type"]) {
  return type === "weight_reps"
    ? `${set.weight} kg × ${set.reps} 回`
    : type === "reps"
      ? `${set.reps} 回`
      : `${set.seconds} 秒`;
}
export function TrainingScreen() {
  const { controller, error, toast } = useTraining();
  const workout = controller.active!;
  const path = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(
    workout.sections[0]?.id ?? null,
  );
  const [picker, setPicker] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    if (path !== "/") {
      router.replace("/");
      return;
    }
    if (location.hash !== "#training")
      history.pushState({ ...history.state }, "", "#training");
  }, [path, router]);
  useEffect(() => {
    const back = () => {
      if (ending) {
        setEnding(false);
        return;
      }
      if (picker) {
        if (dirty && !window.confirm("保存していない変更を破棄しますか？")) {
          history.pushState({ ...history.state }, "", "#exercise-picker");
          return;
        }
        setPicker(false);
        return;
      }
      controller.back();
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [controller, picker, dirty, ending]);
  function updateSection(
    id: string,
    transform: (s: Section) => Section,
    notify = false,
    input = false,
  ) {
    controller.edit(
      (w) => ({
        ...w,
        sections: w.sections.map((s) => (s.id === id ? transform(s) : s)),
      }),
      notify,
      input,
    );
  }
  function setValue(
    section: Section,
    set: SetRecord,
    field: "weight" | "reps" | "seconds",
    value: string,
  ) {
    updateSection(
      section.id,
      (s) => ({
        ...s,
        sets: s.sets.map((item) =>
          item.id === set.id ? changeSet(item, field, value, s.type) : item,
        ),
      }),
      false,
      true,
    );
  }
  function commit(section: Section, setId: string, explicit = false) {
    updateSection(
      section.id,
      (s) => ({
        ...s,
        sets: s.sets.map((item) =>
          item.id === setId ? confirmSet(item, s.type, explicit) : item,
        ),
      }),
      true,
    );
  }
  function closePicker() {
    history.back();
  }
  function openPicker() {
    setPicker(true);
    history.pushState({ ...history.state }, "", "#exercise-picker");
  }
  const unperformed = workout.sections
    .flatMap((s) => s.sets)
    .filter((set) => !set.performed).length;
  return (
    <div className="training-full" data-workout-id={workout.id}>
      <header className="training-header">
        <button onClick={() => history.back()}>記録トップへ戻る</button>
        <SaveStatus />
      </header>
      <main className="training-content">
        <p className="eyebrow">TRAINING / 自動保存</p>
        <h1>トレーニング</h1>
        <p className="muted small">
          開始 {new Date(workout.startedAt).toLocaleString("ja-JP")}
        </p>
        {error && <p role="alert">{error}</p>}
        {toast.length > 0 && (
          <div className="pr-toast" role="status">
            暫定PR更新：
            {toast
              .map(
                (p) =>
                  `${p.name} ${metricLabels[p.metric]} ${p.value.toFixed(1)}`,
              )
              .join("、")}
          </div>
        )}
        {!workout.sections.length && (
          <div className="panel">
            <h2>最初の種目を追加しましょう</h2>
            <p className="muted">入力は変更ごとに端末へ保存します。</p>
          </div>
        )}
        {workout.sections.map((section) => {
          const previous = previousSets(
            controller.baseline,
            section.exerciseId,
          );
          return (
            <section className="workout-section" key={section.id}>
              <div className="section-title">
                <button
                  aria-expanded={expanded === section.id}
                  onClick={() =>
                    setExpanded(expanded === section.id ? null : section.id)
                  }
                >
                  {section.name}
                  <span className="muted small">
                    {typeLabels[section.type]} ·{" "}
                    {section.sets.filter((set) => set.performed).length}/
                    {section.sets.length}セット
                  </span>
                </button>
                <button
                  aria-label={`${section.name}をトレーニングから削除`}
                  onClick={() => {
                    if (
                      section.sets.some((set) => set.performed) &&
                      !window.confirm(
                        `実施済みセットを含む「${section.name}」を削除しますか？`,
                      )
                    )
                      return;
                    controller.edit((w) => ({
                      ...w,
                      sections: w.sections.filter((s) => s.id !== section.id),
                    }));
                  }}
                >
                  削除
                </button>
              </div>
              {expanded === section.id && (
                <div className="section-body">
                  {previous.length > 0 && (
                    <button
                      onClick={() => {
                        if (
                          section.sets.some((set) => set.performed) &&
                          !window.confirm(
                            "現在のセットを前回値の未実施コピーに置き換えますか？",
                          )
                        )
                          return;
                        updateSection(section.id, (s) => ({
                          ...s,
                          sets: previous.map(copySet),
                        }));
                      }}
                    >
                      前回の全セットをコピー
                    </button>
                  )}
                  {section.sets.map((set, index) => (
                    <div
                      className={`set-row ${set.performed ? "performed" : ""}`}
                      key={set.id}
                    >
                      <div className="previous">
                        <span>
                          セット {index + 1} · 前回{" "}
                          {previous[index]
                            ? display(previous[index], section.type)
                            : "—"}
                        </span>
                        {previous[index] && (
                          <button
                            onClick={() => {
                              if (
                                set.performed &&
                                !window.confirm(
                                  "実施済みセットを前回値の未実施コピーに置き換えますか？",
                                )
                              )
                                return;
                              updateSection(section.id, (s) => ({
                                ...s,
                                sets: s.sets.map((item) =>
                                  item.id === set.id
                                    ? {
                                        ...copySet(previous[index]),
                                        id: set.id,
                                      }
                                    : item,
                                ),
                              }));
                            }}
                          >
                            この行をコピー
                          </button>
                        )}
                      </div>
                      <div className="set-inputs">
                        {(section.type === "weight_reps"
                          ? ["weight", "reps"]
                          : section.type === "reps"
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
                                type="text"
                                inputMode={
                                  field === "weight" ? "decimal" : "numeric"
                                }
                                aria-label={`${section.name} セット${index + 1} ${label}`}
                                value={set[field]}
                                onChange={(event) =>
                                  setValue(
                                    section,
                                    set,
                                    field,
                                    event.target.value,
                                  )
                                }
                                onBlur={() => commit(section, set.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            </label>
                          );
                        })}
                        <button
                          aria-label={`セット${index + 1}を削除`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `セット${index + 1}を削除しますか？`,
                              )
                            )
                              updateSection(section.id, (s) => ({
                                ...s,
                                sets: s.sets.filter(
                                  (item) => item.id !== set.id,
                                ),
                              }));
                          }}
                        >
                          削除
                        </button>
                      </div>
                      {!validSet(set, section.type) &&
                        [set.weight, set.reps, set.seconds].some(
                          (value) => value !== "",
                        ) && (
                          <p className="small muted">
                            重量は0以上、回数・秒は1以上の整数で必須欄を入力してください。
                          </p>
                        )}
                      <div className="completion">
                        {set.performed ? (
                          <span>✓ 実施済み</span>
                        ) : (
                          <>
                            <span>
                              {set.copied ? "コピー由来・未実施" : "未実施"}
                            </span>
                            {set.copied && (
                              <button
                                disabled={!validSet(set, section.type)}
                                onClick={() => commit(section, set.id, true)}
                              >
                                実施済みにする
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    className="wide"
                    onClick={() =>
                      updateSection(section.id, (s) => ({
                        ...s,
                        sets: [...s.sets, newSet(s.type, previous, s.sets)],
                      }))
                    }
                  >
                    セットを追加
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </main>
      <footer className="training-actions">
        <button className="primary" onClick={openPicker}>
          種目を追加
        </button>
        <button
          onClick={() => {
            setEnding(true);
            history.pushState({ ...history.state }, "", "#finish");
          }}
        >
          トレーニングを終了
        </button>
      </footer>
      {picker && (
        <ExerciseManager
          onDirty={setDirty}
          onClose={closePicker}
          onSelect={(exercise) => {
            controller.edit((w) =>
              addExercise(w, exercise, controller.baseline),
            );
            const section = controller.active?.sections.find(
              (s) => s.exerciseId === exercise.id,
            );
            if (section) setExpanded(section.id);
            history.back();
          }}
        />
      )}
      {ending && (
        <Sheet title="トレーニングを終了" onClose={() => history.back()}>
          {unperformed > 0 ? (
            <p role="alert">
              未実施セットが{unperformed}
              件あります。未実施行を除外して終了します。
            </p>
          ) : (
            <p>このトレーニングを終了しますか？</p>
          )}
          <div className="button-row">
            <button onClick={() => history.back()}>続ける</button>
            <button
              className="primary"
              onClick={() => {
                history.replaceState(
                  { ...history.state },
                  "",
                  location.pathname,
                );
                controller.complete();
              }}
            >
              終了を確定
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
