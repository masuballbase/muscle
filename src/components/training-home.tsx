"use client";
import Link from "next/link";
import { WeeklyGoal } from "./weekly-goal";
import { MenuManager } from "./menu-manager";
import { useEffect, useState } from "react";
import { useTraining } from "./training-context";
import { ExerciseManager } from "./exercise-manager";
import { summary, metricLabels } from "@/lib/training/model";
export function TrainingHome() {
  const { controller, ready, workouts, saveState } = useTraining();
  const [manage, setManage] = useState(false);
  const [menuMode, setMenuMode] = useState<"manage" | "start" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const active = controller.active;
  const latest = [...workouts]
    .filter((w) => w.endedAt)
    .sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))[0];
  const result = latest
    ? summary(
        latest,
        controller.baseline.filter((w) => w.id !== latest.id),
      )
    : null;
  useEffect(() => {
    if (!manage) return;
    const back = () => {
      if (dirty && !window.confirm("保存していない変更を破棄しますか？")) {
        history.pushState({ ...history.state }, "", "#exercises");
        return;
      }
      setManage(false);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [manage, dirty]);
  return (
    <>
      <p className="eyebrow">YOUR TRAINING JOURNAL</p>
      <h1>記録</h1>
      <p className="muted">今日の積み重ねは、ここから。</p>
      <div className="start-panel">
        {active ? (
          <button className="primary wide" onClick={() => controller.open()}>
            トレーニングを再開
          </button>
        ) : (
          <button
            className="primary wide"
            disabled={
              !ready || saveState === "端末保存失敗" || controller.hasBlocked
            }
            onClick={() => void controller.start()}
          >
            自由に開始
          </button>
        )}
        {!active && (
          <button
            className="wide"
            disabled={!ready || controller.hasBlocked}
            onClick={() => setMenuMode("start")}
          >
            メニューから開始
          </button>
        )}
      </div>
      <WeeklyGoal compact />
      <div className="button-row">
        <button
          onClick={() => {
            setManage(true);
            history.pushState({ ...history.state }, "", "#exercises");
          }}
        >
          種目管理
        </button>
        <button onClick={() => setMenuMode("manage")}>メニュー管理</button>
      </div>
      {latest && result && dismissed !== latest.id && (
        <section className="panel" aria-label="完了サマリー">
          <h2>トレーニング完了</h2>
          <p>
            {latest.syncedRevision === latest.revision
              ? "同期済み"
              : "終了済み・未同期（同期後に正式反映）"}
          </p>
          <dl className="summary-grid">
            <div>
              <dt>実施時間</dt>
              <dd>
                {Math.floor(result.seconds / 60)}分{result.seconds % 60}秒
              </dd>
            </div>
            <div>
              <dt>実施種目数</dt>
              <dd>{result.exercises}</dd>
            </div>
            <div>
              <dt>実施済みセット数</dt>
              <dd>{result.sets}</dd>
            </div>
          </dl>
          <h3>
            更新したPR
            {latest.syncedRevision !== latest.revision ? "（暫定）" : ""}
          </h3>
          {result.prs.length ? (
            <ul>
              {result.prs.map((p) => (
                <li key={`${p.exerciseId}:${p.metric}`}>
                  {p.name}：{metricLabels[p.metric]} {p.value.toFixed(1)}
                </li>
              ))}
            </ul>
          ) : (
            <p>更新なし</p>
          )}
          <div className="button-row">
            <button onClick={() => setDismissed(latest.id)}>
              記録トップへ
            </button>
            <Link href="/history">履歴へ</Link>
          </div>
        </section>
      )}
      {menuMode && (
        <MenuManager
          onClose={() => setMenuMode(null)}
          onSelect={
            menuMode === "start"
              ? (menu) => {
                  void controller
                    .start(menu)
                    .catch((e) =>
                      controller.error(
                        e instanceof Error
                          ? e.message
                          : "開始できませんでした。",
                      ),
                    );
                }
              : undefined
          }
        />
      )}
      {manage && (
        <ExerciseManager onDirty={setDirty} onClose={() => history.back()} />
      )}
    </>
  );
}
