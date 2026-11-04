// SYNTHETIC TEST DATA ONLY. These are NOT real InBody column names.
// Never import this fixture into production code/profile.ts.
import {
  type CsvProfile,
  type RawFields,
  type Measurement,
  metrics,
} from "../../src/lib/inbody/model";
export const headers = Array.from({ length: 44 }, (_, i) => `fixture_${i + 1}`);
const keys = Object.keys(metrics) as (keyof typeof metrics)[];
export const fixtureProfile: CsvProfile = {
  headers,
  numericHeaders: headers.slice(0, 12),
  columns: Object.fromEntries(
    keys.map((k, i) => [k, headers[i]]),
  ) as CsvProfile["columns"],
};
export function fields(weight = "70"): RawFields {
  return Object.fromEntries(
    headers.map((h, i) => [h, i === 0 ? weight : i < 12 ? "0" : null]),
  );
}
export function measurement(
  id = "one",
  date = "2026-11-04",
  weight = "70",
  registered = "2026-11-04T01:00:00Z",
): Measurement {
  return {
    id,
    measuredOn: date,
    importedAt: registered,
    sourceFilename: "InBody-20261104.csv",
    rawFields: fields(weight),
  };
}
export function csv(rows: RawFields[], bom = false) {
  return (
    (bom ? "\uFEFF" : "") +
    [headers, ...rows.map((r) => headers.map((h) => r[h] ?? "-"))]
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n")
  );
}
