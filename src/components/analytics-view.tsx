"use client";
import { useState } from "react";
import { useTraining } from "./training-context";
import { useGoals, useAnalysisClock } from "./goals-context";
import { WeeklyGoal } from "./weekly-goal";
import {
  overallAnalysis,
  weeklyProgress,
  exerciseCatalog,
  exerciseAnalysis,
  metricsFor,
  chartMetrics,
  periods,
  type Period,
  type ChartMetric,
} from "@/lib/analytics/model";
import {
  metricLabels,
  type RecordType,
  type Workout,
} from "@/lib/training/model";
function PeriodSelect({
  value,
  onChange,
}: {
  value: Period;
  onChange: (v: Period) => void;
}) {
  return (
    <label>
      集計期間
      <select
        aria-label="集計期間"
        value={value}
        onChange={(e) => onChange(e.target.value as Period)}
      >
        {Object.entries(periods).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
function formatValue(value: number, metric: string) {
  return metric === "oneRM"
    ? value.toFixed(1)
    : String(Math.round(value * 100) / 100);
}
function unit(metric: string) {
  return ["weight", "oneRM"].includes(metric)
    ? "kg"
    : ["seconds", "totalSeconds"].includes(metric)
      ? "秒"
      : "回";
}
export function GrowthChart({
  points,
  metric,
  timeZone,
}: {
  points: ReturnType<typeof exerciseAnalysis>["points"];
  metric: ChartMetric;
  timeZone: string;
}) {
  if (!points.length)
    return (
      <p role="status">
        対象の記録はありません。条件に合う完了・同期済みセットから表示します。
      </p>
    );
  const min = Date.parse(points[0].startedAt),
    max = Date.parse(points.at(-1)!.startedAt);
  const top = Math.max(1, ...points.map((p) => p.value));
  const x = (time: string) =>
    max === min ? 300 : 50 + ((Date.parse(time) - min) / (max - min)) * 500;
  const y = (value: number) => 200 - (value / top) * 160;
  const date = (iso: string) =>
    new Date(iso).toLocaleString("ja-JP", {
      timeZone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <>
      <svg
        className="growth-chart"
        viewBox="0 0 600 245"
        role="img"
        aria-label={`${chartMetrics[metric]}の成長グラフ・${points.length}点`}
      >
        <line x1="50" y1="40" x2="50" y2="200" stroke="currentColor" />
        <line x1="50" y1="200" x2="550" y2="200" stroke="currentColor" />
        <text x="4" y="35">
          {formatValue(top, metric)}
          {unit(metric)}
        </text>
        <text x="20" y="204">
          0
        </text>
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            points={points
              .map((p) => `${x(p.startedAt)},${y(p.value)}`)
              .join(" ")}
          />
        )}
        {points.map((p) => (
          <circle
            key={p.id}
            data-session-id={p.id}
            cx={x(p.startedAt)}
            cy={y(p.value)}
            r="5"
            fill="var(--accent)"
          >
            <title>
              {date(p.startedAt)} {formatValue(p.value, metric)}
              {unit(metric)}
            </title>
          </circle>
        ))}
        <text x="50" y="235" fontSize="12">
          {date(points[0].startedAt)}
        </text>
        {points.length > 1 && (
          <text x="550" y="235" textAnchor="end" fontSize="12">
            {date(points.at(-1)!.startedAt)}
          </text>
        )}
      </svg>
      {points.length === 1 && (
        <p className="muted">記録は1件です。次の記録から推移を確認できます。</p>
      )}
      <details>
        <summary>グラフの値を表示（{points.length}件）</summary>
        <div className="chart-scroll">
          <table className="analysis-table">
            <caption>{chartMetrics[metric]}・完了セッションごとの値</caption>
            <thead>
              <tr>
                <th>開始日時</th>
                <th>記録名</th>
                <th>{unit(metric)}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>{date(p.startedAt)}</td>
                  <td>{p.name}</td>
                  <td>{formatValue(p.value, metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
function ExerciseDetail({
  exercise,
  workouts,
  now,
  timeZone,
  onBack,
}: {
  exercise: ReturnType<typeof exerciseCatalog>[number];
  workouts: Workout[];
  now: Date;
  timeZone: string;
  onBack: () => void;
}) {
  const [period, setPeriod] = useState<Period>("month"),
    [metric, setMetric] = useState<ChartMetric>(
      metricsFor[exercise.type as RecordType][0],
    );
  const [chosenWeight, setChosenWeight] = useState<number | null>(null);
  const initial = exerciseAnalysis(
    workouts,
    exercise.id,
    period,
    metric,
    chosenWeight,
    now,
    timeZone,
  );
  const weight =
    chosenWeight !== null && initial.weights.includes(chosenWeight)
      ? chosenWeight
      : (initial.weights.at(-1) ?? null);
  const result = exerciseAnalysis(
    workouts,
    exercise.id,
    period,
    metric,
    weight,
    now,
    timeZone,
  );
  return (
    <>
      <button onClick={onBack}>全体分析へ戻る</button>
      <h1>{exercise.name}</h1>
      {exercise.archived && (
        <p className="muted">削除済み種目・過去の実績を表示</p>
      )}
      <section className="panel" aria-label="正式PR">
        <h2>PR（全期間・同期済み）</h2>
        {result.prs.length ? (
          <dl className="summary-grid">
            {result.prs.map((p) => (
              <div key={p.metric}>
                <dt>{metricLabels[p.metric]}</dt>
                <dd>
                  {formatValue(p.value, p.metric)}
                  {unit(p.metric)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>PRはまだありません。</p>
        )}
      </section>
      <section className="panel" aria-label="成長グラフ">
        <h2>成長グラフ</h2>
        <div className="analysis-controls">
          <label>
            グラフの指標
            <select
              aria-label="グラフの指標"
              value={metric}
              onChange={(e) => setMetric(e.target.value as ChartMetric)}
            >
              {metricsFor[exercise.type].map((m) => (
                <option key={m} value={m}>
                  {chartMetrics[m]}
                </option>
              ))}
            </select>
          </label>
          <PeriodSelect value={period} onChange={setPeriod} />
          {metric === "sameWeightReps" && (
            <label>
              比較する重量
              <select
                aria-label="比較する重量"
                value={weight ?? ""}
                onChange={(e) => setChosenWeight(Number(e.target.value))}
              >
                {!result.weights.length && <option value="">記録なし</option>}
                {result.weights.map((w) => (
                  <option key={w} value={w}>
                    {w}kg
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <GrowthChart
          points={result.points}
          metric={metric}
          timeZone={timeZone}
        />
        <p className="muted small">
          開始日時順に1セッション1点。推定1RMは1回＝実重量、2〜10回＝Epley式、11回以上は対象外。
        </p>
      </section>
    </>
  );
}
export function AnalyticsView() {
  const { workouts, exercises, ready, controller, saveState } = useTraining();
  const { goals, loaded, online } = useGoals();
  const { now, timeZone } = useAnalysisClock();
  const [period, setPeriod] = useState<Period>("month"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const overall = overallAnalysis(workouts, exercises, period, now, timeZone),
    progress = weeklyProgress(workouts, goals, now, timeZone);
  const catalog = exerciseCatalog(workouts, exercises),
    exercise = catalog.find((e) => e.id === selected);
  const max = Math.max(1, ...overall.bars.map((b) => b.value));
  if (!ready) return <p role="status">分析データを読み込み中です。</p>;
  return (
    <>
      <p className="eyebrow">YOUR TRAINING JOURNAL</p>
      {!exercise && (
        <>
          <h1>分析</h1>
          <p className="muted">続けた成果を、少しずつ確かめる。</p>
        </>
      )}
      <p className="muted small">
        完了・同期済みの実施済みセットだけを集計。未同期の記録は同期後に反映します。日付は開始日時・
        {timeZone}、週は月曜始まりです。
      </p>
      <button
        disabled={["同期中", "端末保存中"].includes(saveState)}
        onClick={() => void controller.initialize()}
      >
        記録を再読み込み
      </button>
      {exercise ? (
        <ExerciseDetail
          key={exercise.id}
          exercise={exercise}
          workouts={workouts}
          now={now}
          timeZone={timeZone}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          <div className="analysis-controls">
            <PeriodSelect value={period} onChange={setPeriod} />
          </div>
          <p className="muted small">
            期間は今日から指定月数を遡った日以降です。週間指標は常に今週・現在の状態です。
          </p>
          <section className="panel" aria-label="5つの指標">
            <h2>5つの指標</h2>
            <dl className="summary-grid">
              <div>
                <dt>トレーニング日数</dt>
                <dd data-testid="training-days">{overall.days}日</dd>
              </div>
              <div>
                <dt>セッション数</dt>
                <dd data-testid="session-count">{overall.sessions}件</dd>
              </div>
              <div>
                <dt>種目別実施頻度</dt>
                <dd>
                  {overall.ranking.length ? (
                    <ul>
                      {overall.ranking.slice(0, 3).map((e) => (
                        <li key={e.id}>
                          {e.name} {e.count}件
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "記録なし"
                  )}
                  <span className="small muted">全件は下のランキングへ</span>
                </dd>
              </div>
              <div>
                <dt>連続目標達成週数</dt>
                <dd>
                  {!loaded
                    ? "確認できていません"
                    : progress.streak === undefined
                      ? "未設定"
                      : `${progress.streak}週`}
                </dd>
              </div>
              <div>
                <dt>週間目標達成率</dt>
                <dd>
                  {!loaded
                    ? "確認できていません"
                    : progress.rate === undefined
                      ? "未設定"
                      : `${Math.round(progress.rate)}%`}
                </dd>
              </div>
            </dl>
            {!online && (
              <p className="muted small">週間目標はサーバー未確認です。</p>
            )}
          </section>
          <section className="panel" aria-label="トレーニング頻度">
            <h2>トレーニング頻度</h2>
            <p>
              {overall.weekly ? "週別" : "月別"}の実施日数（日・選択期間内）
            </p>
            {overall.days === 0 ? (
              <p>対象の記録はありません。</p>
            ) : (
              <div className="chart-scroll">
                <div
                  className="frequency-bars"
                  style={{ minWidth: overall.bars.length * 64 }}
                >
                  {overall.bars.map((b) => (
                    <div className="frequency-column" key={b.label}>
                      <span>{b.value}日</span>
                      <div className="frequency-track">
                        <div
                          className="frequency-bar"
                          style={{ height: `${(b.value / max) * 100}%` }}
                        />
                      </div>
                      <span>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="panel" aria-label="種目別実施頻度ランキング">
            <h2>種目別実施頻度ランキング</h2>
            <p className="muted small">その種目を実施したセッション数</p>
            {overall.ranking.length ? (
              <ol className="analysis-ranking">
                {overall.ranking.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => setSelected(e.id)}>
                      {e.name}
                      {e.archived ? "（削除済み）" : ""}：{e.count}件
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>対象の記録はありません。</p>
            )}
          </section>
          <section className="panel" aria-label="分析する種目を検索">
            <h2>種目から分析を探す</h2>
            <label>
              種目名で検索
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ul className="analysis-ranking">
              {catalog
                .filter((e) =>
                  e.aliases.some((name) =>
                    name
                      .toLocaleLowerCase()
                      .includes(query.trim().toLocaleLowerCase()),
                  ),
                )
                .map((e) => (
                  <li key={e.id}>
                    <button onClick={() => setSelected(e.id)}>
                      {e.name}
                      {e.archived ? "（削除済み）" : ""}
                    </button>
                  </li>
                ))}
            </ul>
            {!catalog.some((e) =>
              e.aliases.some((name) =>
                name
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              ),
            ) && <p>該当する種目はありません。</p>}
          </section>
          <WeeklyGoal />
        </>
      )}
    </>
  );
}
