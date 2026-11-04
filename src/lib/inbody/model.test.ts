import { it, expect } from "vitest";
import {
  fields,
  fixtureProfile,
  headers,
  measurement,
  csv,
} from "../../../tests/fixtures/inbody";
import {
  filenameDate,
  normalizeCell,
  numeric,
  validDay,
  validateProfile,
  fieldIssues,
  duplicate,
  latestGroup,
  graphSeries,
  metricValue,
  metrics,
} from "./model";
import { previewCsv, csvTable } from "./csv";
import { verifiedCsvProfile } from "./profile";
const now = new Date("2026-11-04T09:00:00Z");
it("uses the reviewed 44-column production profile", () => {
  expect(verifiedCsvProfile.headers).toHaveLength(44);
  validateProfile(verifiedCsvProfile);
});

it("IB-010/011 AT-021: handles BOM, 44 fields, quoted delimiters/newlines/quotes, null and numeric zero without discarding raw text", () => {
  const raw = fields();
  raw[headers[15]] = 'a, "quoted"\nline';
  raw[headers[16]] = "";
  raw[headers[17]] = "-";
  raw[headers[18]] = "70.00";
  const parsed = previewCsv(
    csv([raw, fields("71")], true),
    "InBody-20261104.csv",
    fixtureProfile,
  );
  expect(parsed.headers).toEqual(headers);
  expect(parsed.rows).toHaveLength(2);
  expect(parsed.issues).toEqual([]);
  expect(Object.keys(parsed.rows[0].rawFields)).toHaveLength(44);
  expect(parsed.rows[0].rawFields[headers[15]]).toBe(raw[headers[15]]);
  expect(parsed.rows[0].rawFields[headers[16]]).toBeNull();
  expect(parsed.rows[0].rawFields[headers[17]]).toBeNull();
  expect(parsed.rows[0].rawFields[headers[18]]).toBe("70.00");
  expect(numeric(parsed.rows[0].rawFields[headers[1]])).toBe(0);
  expect(normalizeCell(0)).toBe(0);
});
it("retains 44 missing values as a real CSV row rather than an empty line", () => {
  expect(
    previewCsv(
      headers.join(",") + "\n" + Array(44).fill("").join(","),
      "InBody-20261104.csv",
      fixtureProfile,
    ).rows,
  ).toHaveLength(1);
});
it.each(["InBody-20260229.csv", "InBody-20261301.csv", "arbitrary.csv"])(
  "rejects invalid or guessed filename dates: %s",
  (name) => expect(filenameDate(name)).toBe(""),
);
it("IB-012 AT-022: filename is the default; exponential date text is not guessed as a date", () => {
  const raw = fields();
  raw[headers[43]] = "2.0261104E+7";
  const row = previewCsv(csv([raw]), "InBody-20261104.csv", fixtureProfile)
    .rows[0];
  expect(row.measuredOn).toBe("2026-11-04");
  expect(validDay("2024-02-29")).toBe(true);
  expect(validDay("2026-02-29")).toBe(false);
});
it("uses a per-row date only with an explicitly verified date parser", () => {
  const raw = fields();
  raw[headers[43]] = "2026-11-01";
  const profile = {
    ...fixtureProfile,
    dateHeader: headers[43],
    parseDate: (v: unknown) =>
      typeof v === "string" && validDay(v) ? v : null,
  };
  expect(
    previewCsv(csv([raw]), "InBody-20261104.csv", profile).rows[0].measuredOn,
  ).toBe("2026-11-01");
});
it("rejects blank/duplicate headers and malformed CSV syntax with line information", () => {
  expect(() => previewCsv("a,a\n1,2", "x.csv", null)).toThrow("重複");
  expect(() => previewCsv("a,\n1,2", "x.csv", null)).toThrow("空");
  expect(() => csvTable('a,b\n"open')).toThrow("2行");
  expect(() => csvTable('a,b\na"b,c')).toThrow("2行");
  expect(() => csvTable('"a"x,b')).toThrow("1行");
});
it("reports missing/extra columns and numeric errors by row/column; preserves valid rows", () => {
  const bad = fields();
  bad[headers[0]] = "not numeric";
  const p = previewCsv(
    csv([fields(), bad]),
    "InBody-20261104.csv",
    fixtureProfile,
  );
  expect(p.rows[0].issues).toEqual([]);
  expect(p.rows[1].issues).toContainEqual({
    column: headers[0],
    message: "数値を確認してください。",
  });
  const incomplete = previewCsv("one,two\n1,2,3", "x.csv", fixtureProfile);
  expect(incomplete.issues.some((i) => i.includes("不足列"))).toBe(true);
  expect(
    incomplete.rows[0].issues.some((i) => i.message.startsWith("列数")),
  ).toBe(true);
});
it("never treats unverified 44-column syntax as a verified InBody import", () => {
  expect(
    previewCsv(csv([fields()]), "InBody-20261104.csv", null).issues,
  ).toContain("実CSVの列対応が未確認のため、正式取り込みはできません。");
  expect(() =>
    validateProfile({
      ...fixtureProfile,
      columns: {
        ...fixtureProfile.columns,
        skeletalMuscleMass: fixtureProfile.columns.muscleMass,
      },
    }),
  ).toThrow("区別");
});
it("IB-014/016 AT-023: all 44 values and normalized measurement date determine exact duplicates, irrespective of header order", () => {
  const one = measurement();
  expect(
    duplicate([one], one.measuredOn, {
      ...Object.fromEntries(Object.entries(one.rawFields).reverse()),
    })?.id,
  ).toBe(one.id);
  expect(duplicate([one], "2026-11-03", one.rawFields)).toBeUndefined();
  const other = { ...one.rawFields, [headers[43]]: "different" };
  expect(duplicate([one], one.measuredOn, other)).toBeUndefined();
  expect(
    duplicate([one], one.measuredOn, one.rawFields, one.id),
  ).toBeUndefined();
});
it("IB-007 AT-024: latest day dominates registration time; latest registration on same day is initial selection", () => {
  const a = measurement("a"),
    b = measurement("b", undefined, "71", "2026-11-04T02:00:00Z"),
    old = measurement("old", "2026-11-03", "99", "2026-11-04T03:00:00Z");
  expect(latestGroup([old, a, b]).map((r) => r.id)).toEqual(["b", "a"]);
});
it("IB-002/003/005: muscle mass and skeletal muscle are independently mapped and all 12 metric keys are supported", () => {
  const record = measurement();
  record.rawFields[fixtureProfile.columns.muscleMass] = "45";
  record.rawFields[fixtureProfile.columns.skeletalMuscleMass] = "30";
  expect(metricValue(record, "muscleMass", fixtureProfile)).toBe(45);
  expect(metricValue(record, "skeletalMuscleMass", fixtureProfile)).toBe(30);
  for (const key of Object.keys(metrics) as (keyof typeof metrics)[])
    expect(metricValue(record, key, fixtureProfile)).not.toBeNull();
  expect(metricValue(record, "weight", null)).toBeNull();
});
it("IB-004/006/008: keeps two same-day points, omits null, retains zero, obeys periods and never fabricates points", () => {
  const a = measurement("a"),
    b = measurement("b", undefined, "0"),
    old = measurement("old", "2025-01-01"),
    missing = measurement("missing");
  missing.rawFields[headers[0]] = null;
  expect(
    graphSeries(
      [a, b, old, missing],
      ["weight"],
      fixtureProfile,
      "month",
      now,
      "Asia/Tokyo",
    )[0]
      .points.map((p) => p.value)
      .sort((a, b) => a - b),
  ).toEqual([0, 70]);
  expect(
    graphSeries(
      [a, old],
      ["weight"],
      fixtureProfile,
      "all",
      now,
      "Asia/Tokyo",
    )[0].points,
  ).toHaveLength(2);
  expect(
    graphSeries([], ["weight"], fixtureProfile, "all", now, "Asia/Tokyo")[0]
      .points,
  ).toEqual([]);
  expect(
    graphSeries(
      [a],
      ["leftArm", "rightArm"],
      fixtureProfile,
      "all",
      now,
      "Asia/Tokyo",
    ).map((s) => s.points.length),
  ).toEqual([1, 1]);
});
it("IB-021/022 AT-025: editing or deleting immediately changes projections and latest selection", () => {
  const a = measurement("a"),
    b = measurement("b", undefined, "80", "2026-11-04T02:00:00Z");
  const project = (rows: ReturnType<typeof measurement>[]) =>
    graphSeries(
      rows,
      ["weight"],
      fixtureProfile,
      "all",
      now,
      "Asia/Tokyo",
    )[0].points.map((p) => p.value);
  expect(project([a, b])).toEqual([70, 80]);
  expect(project([a, { ...b, rawFields: fields("90") }])).toEqual([70, 90]);
  expect(project([a])).toEqual([70]);
  expect(latestGroup([a])[0].id).toBe("a");
});
it("validates all 44 raw fields and rejects non-finite numeric fields", () => {
  expect(fieldIssues(fields(), fixtureProfile)).toEqual([]);
  expect(fieldIssues({}, null)).not.toEqual([]);
  const raw = fields();
  raw[headers[0]] = Infinity;
  expect(fieldIssues(raw, fixtureProfile).length).toBeGreaterThan(0);
  expect(numeric("")).toBeNull();
  expect(numeric("-")).toBeNull();
  expect(numeric("Infinity")).toBeNull();
  expect(numeric("1x")).toBeNull();
});

it("preserves sub-millisecond registration order without inventing measurement time", () => {
  const a = measurement("a", undefined, "70", "2026-11-04T01:00:00.000001Z"),
    b = measurement("b", undefined, "71", "2026-11-04T01:00:00.000002Z");
  expect(latestGroup([a, b])[0].id).toBe("b");
});
