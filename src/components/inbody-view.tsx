"use client";
import { useState } from "react";
import { useInBody } from "./inbody-context";
import { useAnalysisClock } from "./goals-context";
import { InBodyChart } from "./inbody-chart";
import { InBodyDetail } from "./inbody-detail";
import { InBodyImport } from "./inbody-import";
import { PeriodSelect } from "./analytics-view";
import { type Period } from "@/lib/analytics/model";
import {
  metrics,
  metricUnits,
  graphTypes,
  type GraphType,
  type Metric,
  type Measurement,
  latestGroup,
  metricValue,
  ordered,
  graphSeries,
} from "@/lib/inbody/model";
import { previewCsv } from "@/lib/inbody/csv";
import { verifiedCsvProfile } from "@/lib/inbody/profile";
const topMetrics: Metric[] = ["weight", "bodyFatPercent", "muscleMass", "bmi"];
function summary(record: Measurement) {
  return topMetrics
    .map(
      (key) =>
        `${metrics[key]} ${verifiedCsvProfile ? (metricValue(record, key, verifiedCsvProfile) ?? "—") : "列未確認"}`,
    )
    .join(" ／ ");
}
export function InBodyView() {
  const { controller, records, ready, online, busy, message } = useInBody();
  const { now, timeZone } = useAnalysisClock();
  const [selected, setSelected] = useState(""),
    [graph, setGraph] = useState<GraphType>("weight"),
    [region, setRegion] = useState<"arms" | "legs" | "trunk">("arms"),
    [period, setPeriod] = useState<Period>("month");
  const [historyOpen, setHistoryOpen] = useState(false),
    [detail, setDetail] = useState<Measurement | null>(null),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<{
      filename: string;
      value: ReturnType<typeof previewCsv>;
    } | null>(null);
  const latest = latestGroup(records),
    current = latest.find((r) => r.id === selected) ?? latest[0];
  const keys: Metric[] =
    graph === "regional"
      ? region === "arms"
        ? ["leftArm", "rightArm"]
        : region === "legs"
          ? ["leftLeg", "rightLeg"]
          : ["trunk"]
      : [graph];
  const series = graphSeries(
    records,
    keys,
    verifiedCsvProfile,
    period,
    now,
    timeZone,
  );
  return (
    <>
      <div className="inbody-heading">
        <div>
          <p className="eyebrow">YOUR BODY JOURNAL</p>
          <h1>InBody</h1>
        </div>
        <label className="file-button">
          CSV取り込み
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setError("");
              try {
                if (file.size > 2 * 1024 * 1024)
                  throw new Error("CSVは2MB以下にしてください。");
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                setPreview({
                  filename: file.name,
                  value: previewCsv(text, file.name, verifiedCsvProfile),
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "UTF-8 CSVを確認してください。",
                );
              }
            }}
          />
        </label>
      </div>
      <p className="muted">からだの変化を記録する。</p>
      {!verifiedCsvProfile && (
        <p className="panel" role="status">
          実CSV確認待ち：44項目の列対応が未確定のため、指標の数値表示・実CSVによるグラフ・正式取り込みは保留です。列名は推測せず、原項目の履歴を表示します。
        </p>
      )}
      {!online && (
        <p className="muted">InBodyは保存済み表示・サーバー未確認です。</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void controller.initialize()}>
        InBodyを再読み込み
      </button>
      {!ready ? (
        <p role="status">測定を読み込み中です。</p>
      ) : (
        <>
          <section className="panel" aria-label="最新4指標">
            <h2>最新4指標</h2>
            {current ? (
              <>
                <p>測定日 {current.measuredOn}</p>
                {latest.length > 1 && (
                  <label>
                    同日の測定
                    <select
                      aria-label="同日の測定"
                      value={current.id}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {latest.map((r, index) => (
                        <option key={r.id} value={r.id}>
                          登録順 {index + 1}（新しい順）：
                          {new Date(r.importedAt).toLocaleString("ja-JP")} ／
                          体重{" "}
                          {metricValue(r, "weight", verifiedCsvProfile) ?? "—"}
                          kg
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="small muted">
                  初期表示は最新測定日のうち登録が最新のものです。登録順は測定時刻順を意味しません。
                </p>
                <dl className="summary-grid">
                  {topMetrics.map((key) => (
                    <div key={key}>
                      <dt>{metrics[key]}</dt>
                      <dd>
                        {verifiedCsvProfile
                          ? metricValue(current, key, verifiedCsvProfile) ===
                            null
                            ? "—"
                            : `${metricValue(current, key, verifiedCsvProfile)}${metricUnits[key]}`
                          : "列未確認"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button onClick={() => setDetail(current)}>
                  表示中の測定詳細
                </button>
              </>
            ) : (
              <p>測定記録はまだありません。</p>
            )}
          </section>
          <section className="panel" aria-label="InBody成長グラフ">
            <h2>成長グラフ</h2>
            <div className="analysis-controls">
              <label>
                グラフの種類
                <select
                  aria-label="グラフの種類"
                  value={graph}
                  onChange={(e) => setGraph(e.target.value as GraphType)}
                >
                  {Object.entries(graphTypes).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <PeriodSelect value={period} onChange={setPeriod} />
              {graph === "regional" && (
                <label>
                  部位
                  <select
                    aria-label="部位"
                    value={region}
                    onChange={(e) => setRegion(e.target.value as typeof region)}
                  >
                    <option value="arms">両腕（左右比較）</option>
                    <option value="legs">両脚（左右比較）</option>
                    <option value="trunk">体幹</option>
                  </select>
                </label>
              )}
            </div>
            {verifiedCsvProfile ? (
              <InBodyChart
                key={`${graph}:${region}:${period}`}
                series={series}
              />
            ) : (
              <p>
                実CSVの列対応を確認後にグラフへ反映します。筋肉量と骨格筋量は別指標として扱います。
              </p>
            )}
          </section>
          <section className="panel" aria-label="測定履歴入口">
            <h2>測定履歴</h2>
            <button onClick={() => setHistoryOpen(!historyOpen)}>
              {historyOpen
                ? "履歴を閉じる"
                : `測定履歴を開く（${records.length}件）`}
            </button>
            {historyOpen &&
              (records.length ? (
                <ul className="analysis-ranking">
                  {ordered(records).map((r) => (
                    <li key={r.id}>
                      <button onClick={() => setDetail(r)}>
                        {r.measuredOn} ／ {summary(r)}
                        <span className="small muted">
                          {" "}
                          ／ 登録{" "}
                          {new Date(r.importedAt).toLocaleString("ja-JP")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>測定履歴はありません。</p>
              ))}
          </section>
        </>
      )}
      {detail && (
        <InBodyDetail
          key={detail.id}
          record={records.find((r) => r.id === detail.id) ?? detail}
          onClose={() => setDetail(null)}
        />
      )}
      {preview && (
        <InBodyImport
          filename={preview.filename}
          preview={preview.value}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
