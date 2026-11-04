import { type Period, periodStart } from "../analytics/model";
import { dayKey } from "../history/model";
export type RawValue = string | number | null;
export type RawFields = Record<string, RawValue>;
export type Measurement = {
  id: string;
  measuredOn: string;
  importedAt: string;
  sourceFilename: string | null;
  rawFields: RawFields;
};
export const metrics = {
  weight: "体重",
  bodyFatPercent: "体脂肪率",
  muscleMass: "筋肉量",
  bmi: "BMI",
  skeletalMuscleMass: "骨格筋量",
  fatMass: "体脂肪量",
  leftArm: "左腕",
  rightArm: "右腕",
  leftLeg: "左脚",
  rightLeg: "右脚",
  trunk: "体幹",
  score: "InBody点数",
} as const;
export const metricUnits: Record<keyof typeof metrics, string> = {
  weight: "kg",
  bodyFatPercent: "%",
  muscleMass: "kg",
  bmi: "kg/m²",
  skeletalMuscleMass: "kg",
  fatMass: "kg",
  leftArm: "kg",
  rightArm: "kg",
  leftLeg: "kg",
  rightLeg: "kg",
  trunk: "kg",
  score: "点",
};
export type Metric = keyof typeof metrics;
export type CsvProfile = {
  headers: string[];
  numericHeaders: string[];
  columns: Record<Metric, string>;
  dateHeader?: string;
  parseDate?: (value: RawValue) => string | null;
};
export const graphTypes = {
  weight: "体重",
  skeletalMuscleMass: "骨格筋量",
  bodyFatPercent: "体脂肪率",
  fatMass: "体脂肪量",
  regional: "部位別筋肉量",
  score: "InBody点数",
} as const;
export type GraphType = keyof typeof graphTypes;
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function filenameDate(name: string) {
  const match = /^InBody-(\d{4})(\d{2})(\d{2})(?: ?\([1-9]\d*\))?\.csv$/i.exec(
    name,
  );
  const day = match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  return validDay(day) ? day : "";
}
export function normalizeCell(value: RawValue): RawValue {
  return value === null ||
    (typeof value === "string" && ["", "-"].includes(value.trim()))
    ? null
    : value;
}
export function numeric(value: RawValue | undefined): number | null {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function validateProfile(profile: CsvProfile) {
  if (
    profile.headers.length !== 44 ||
    new Set(profile.headers).size !== 44 ||
    profile.headers.some((h) => !h.trim())
  )
    throw new Error("44項目の確認済みヘッダーが必要です。");
  if (
    Object.keys(metrics).some(
      (m) => !profile.headers.includes(profile.columns[m as Metric]),
    ) ||
    profile.numericHeaders.some((h) => !profile.headers.includes(h)) ||
    Object.values(profile.columns).some(
      (h) => !profile.numericHeaders.includes(h),
    )
  )
    throw new Error("確認済みの数値列対応が必要です。");
  if (profile.columns.muscleMass === profile.columns.skeletalMuscleMass)
    throw new Error("筋肉量と骨格筋量は区別してください。");
  if (
    profile.dateHeader &&
    (!profile.headers.includes(profile.dateHeader) || !profile.parseDate)
  )
    throw new Error("日付列には確認済みの解析方法が必要です。");
}
export type FieldIssue = { column: string; message: string };
export function fieldIssues(
  fields: RawFields,
  profile: CsvProfile | null,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (Object.keys(fields).length !== 44)
    issues.push({ column: "全体", message: "44項目すべてが必要です。" });
  for (const [column, value] of Object.entries(fields))
    if (!(
      value === null ||
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    ))
      issues.push({ column, message: "値の形式が不正です。" });
  if (profile) {
    validateProfile(profile);
    for (const h of profile.headers)
      if (!Object.hasOwn(fields, h))
        issues.push({ column: h, message: "必須列がありません。" });
    for (const h of Object.keys(fields))
      if (!profile.headers.includes(h))
        issues.push({ column: h, message: "未確認の列です。" });
    for (const h of profile.numericHeaders)
      if (
        fields[h] !== null &&
        fields[h] !== undefined &&
        numeric(fields[h]) === null
      )
        issues.push({ column: h, message: "数値を確認してください。" });
  }
  return issues;
}
export function validateMeasurement(
  record: Measurement,
  profile: CsvProfile | null,
) {
  if (!validDay(record.measuredOn))
    throw new Error("測定日を確認してください。");
  const issues = fieldIssues(record.rawFields, profile);
  if (issues.length)
    throw new Error(`${issues[0].column}：${issues[0].message}`);
}
export function duplicate(
  records: Measurement[],
  day: string,
  fields: RawFields,
  excludeId?: string,
) {
  const keys = Object.keys(fields).sort();
  return records.find(
    (r) =>
      r.id !== excludeId &&
      r.measuredOn === day &&
      Object.keys(r.rawFields).length === keys.length &&
      keys.every(
        (k) =>
          Object.hasOwn(r.rawFields, k) &&
          (r.rawFields[k] === fields[k] ||
            (typeof r.rawFields[k] === "number" &&
              String(r.rawFields[k]) === fields[k]) ||
            (typeof fields[k] === "number" &&
              String(fields[k]) === r.rawFields[k])),
      ),
  );
}
export function ordered(records: Measurement[]) {
  // Registration order is only a display order, never a claimed measurement time.
  return [...records].sort(
    (a, b) =>
      b.measuredOn.localeCompare(a.measuredOn) ||
      Date.parse(b.importedAt) - Date.parse(a.importedAt) ||
      (b.importedAt.match(/\.(\d+)/)?.[1] ?? "")
        .padEnd(9, "0")
        .localeCompare(
          (a.importedAt.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0"),
        ) ||
      b.id.localeCompare(a.id),
  );
}
export function latestGroup(records: Measurement[]) {
  const sorted = ordered(records);
  return sorted.filter((r) => r.measuredOn === sorted[0]?.measuredOn);
}
export function metricValue(
  record: Measurement,
  metric: Metric,
  profile: CsvProfile | null,
) {
  return profile ? numeric(record.rawFields[profile.columns[metric]]) : null;
}
export function graphSeries(
  records: Measurement[],
  keys: Metric[],
  profile: CsvProfile | null,
  period: Period,
  now: Date,
  timeZone: string,
) {
  const start = periodStart(period, now, timeZone),
    today = dayKey(now, timeZone);
  const selected = ordered(records)
    .filter((r) => (!start || r.measuredOn >= start) && r.measuredOn <= today)
    .reverse();
  return keys.map((metric) => ({
    metric,
    points: selected.flatMap((r) => {
      const value = metricValue(r, metric, profile);
      return value === null
        ? []
        : [{ id: r.id, day: r.measuredOn, importedAt: r.importedAt, value }];
    }),
  }));
}

export function orderedFields(fields: RawFields, profile: CsvProfile | null) {
  const keys = profile
    ? [
        ...profile.headers.filter((h) => Object.hasOwn(fields, h)),
        ...Object.keys(fields).filter((h) => !profile.headers.includes(h)),
      ]
    : Object.keys(fields);
  return keys.map((key) => [key, fields[key]] as const);
}
