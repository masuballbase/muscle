"use client";
import { useState } from "react";
import {
  metrics,
  metricUnits,
  type Metric,
  type graphSeries,
} from "@/lib/inbody/model";
type Series = ReturnType<typeof graphSeries>;
export function InBodyChart({ series }: { series: Series }) {
  const [selected, setSelected] = useState<{
    metric: Metric;
    id: string;
  } | null>(null);
  const points = series.flatMap((s) => s.points),
    days = [...new Set(points.map((p) => p.day))].sort();
  if (!points.length)
    return <p role="status">対象の値はありません。欠損値は補完しません。</p>;
  const min = Date.parse(days[0]),
    max = Date.parse(days.at(-1)!);
  const values = points.map((p) => p.value),
    low = Math.min(0, ...values),
    high = Math.max(1, ...values);
  const x = (day: string, id: string) => {
    const same = [
      ...new Set(points.filter((p) => p.day === day).map((p) => p.id)),
    ].sort();
    const center =
      min === max ? 300 : 65 + ((Date.parse(day) - min) / (max - min)) * 470;
    return (
      center +
      (same.indexOf(id) - (same.length - 1) / 2) *
        Math.min(14, 60 / Math.max(1, same.length))
    );
  };
  const y = (value: number) => 200 - ((value - low) / (high - low)) * 160;
  const value =
    selected &&
    series
      .find((s) => s.metric === selected.metric)
      ?.points.find((p) => p.id === selected.id);
  return (
    <>
      <svg
        viewBox="0 0 600 245"
        className="growth-chart"
        role="group"
        aria-label="InBody測定グラフ"
      >
        <line x1="55" y1="40" x2="55" y2="200" stroke="currentColor" />
        <line x1="55" y1="200" x2="555" y2="200" stroke="currentColor" />
        <text x="4" y="30">
          {high}
        </text>
        <text x="4" y="205">
          {low}
        </text>
        {series.map((s, index) => (
          <g key={s.metric}>
            {s.points.map((p) => (
              <circle
                key={p.id}
                data-measurement-id={p.id}
                cx={x(p.day, p.id)}
                cy={y(p.value)}
                r={index === 0 ? 6 : 4}
                fill={index === 0 ? "var(--accent)" : "var(--foreground)"}
                role="button"
                tabIndex={0}
                aria-label={`${p.day} ${metrics[s.metric]} ${p.value}`}
                onClick={() => setSelected({ metric: s.metric, id: p.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected({ metric: s.metric, id: p.id });
                  }
                }}
              >
                <title>
                  {p.day} {metrics[s.metric]} {p.value}
                </title>
              </circle>
            ))}
          </g>
        ))}
        <text x="55" y="235">
          {days[0]}
        </text>
        {days.length > 1 && (
          <text x="555" y="235" textAnchor="end">
            {days.at(-1)}
          </text>
        )}
      </svg>
      {series.length > 1 && (
        <p className="small">
          大きな点：{metrics[series[0].metric]} ／ 小さな点：
          {metrics[series[1].metric]}
        </p>
      )}
      {value && selected && (
        <p role="status">
          {value.day}・{metrics[selected.metric]}：{value.value}
          {metricUnits[selected.metric]}
        </p>
      )}
      {new Set(points.map((p) => p.id)).size === 1 && (
        <p className="muted">測定は1件です。</p>
      )}
      <p className="muted small">
        測定時刻は未確認です。同日の点は見やすく横にずらし、測定順は示しません。点をタップすると日付と値を確認できます。
      </p>
      <details>
        <summary>測定値を一覧で確認</summary>
        <div className="chart-scroll">
          <table className="analysis-table">
            <thead>
              <tr>
                <th>測定日</th>
                <th>指標</th>
                <th>値</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.metric}:${p.id}`}>
                    <td>{p.day}</td>
                    <td>{metrics[s.metric]}</td>
                    <td>
                      {p.value}
                      {metricUnits[s.metric]}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
