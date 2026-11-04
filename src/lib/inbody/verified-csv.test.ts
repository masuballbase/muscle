import { it, expect } from "vitest";
import { verifiedCsvProfile as profile, inBodyHeaders } from "./profile";
import { previewCsv } from "./csv";
import { metricValue, numeric, filenameDate } from "./model";
import {
  verifiedCsv,
  verifiedFields,
  verifiedMeasurement,
} from "../../../tests/fixtures/inbody-verified";
it("AT-021/022 parses verified Unicode headers, BOM, 14 nulls and 2 zeroes, ignores scientific date, accepts (1) filename", () => {
  const parsed = previewCsv(
    verifiedCsv([verifiedFields()]),
    "InBody-20261104(1).csv",
    profile,
  );
  expect(parsed.headers).toEqual([...inBodyHeaders]);
  expect(parsed.issues).toEqual([]);
  expect(parsed.rows[0].issues).toEqual([]);
  expect(parsed.rows[0].measuredOn).toBe("2026-11-04");
  expect(parsed.rows[0].rawFields["日付"]).toBe("2.0261E+13");
  expect(
    Object.values(parsed.rows[0].rawFields).filter((v) => v === null),
  ).toHaveLength(14);
  expect(numeric(parsed.rows[0].rawFields["上半身均衡"])).toBe(0);
  expect(numeric(parsed.rows[0].rawFields["下半身均衡"])).toBe(0);
  expect(filenameDate("InBody-20261104 (2).csv")).toBe("2026-11-04");
});
it("maps actual named columns separately: muscle vs skeletal and all left/right regional muscles", () => {
  const r = verifiedMeasurement();
  for (const [metric, value] of Object.entries({
    muscleMass: 45,
    skeletalMuscleMass: 30,
    leftArm: 3.1,
    rightArm: 3.2,
    leftLeg: 9.1,
    rightLeg: 9.2,
    trunk: 24,
  }))
    expect(
      metricValue(r, metric as keyof typeof profile.columns, profile),
    ).toBe(value);
  expect(profile.columns.bmi).toBe("BMI(kg/m²)");
  expect(profile.headers).toContain("全身位相角(°)");
  expect(profile.headers).toContain("右腕 細胞外水分比");
});
it("maps by header name even if the 44 columns are reordered, preserves all values", () => {
  const original = verifiedFields();
  const reversed = [...profile.headers].reverse();
  const text = [
    reversed.join(","),
    reversed.map((h) => original[h] ?? "-").join(","),
  ].join("\n");
  const p = previewCsv(text, "InBody-20261104.csv", profile);
  expect(p.issues).toEqual([]);
  expect(p.rows[0].rawFields).toEqual(original);
});
it("validates each numeric column but preserves equipment ID and original numeric formatting", () => {
  const raw = verifiedFields();
  raw["測定機器"] = "000000";
  raw["体重(kg)"] = "70.00";
  raw["基礎代謝量(kcal)"] = "invalid";
  const p = previewCsv(verifiedCsv([raw]), "InBody-20261104.csv", profile);
  expect(p.rows[0].rawFields["測定機器"]).toBe("000000");
  expect(p.rows[0].rawFields["体重(kg)"]).toBe("70.00");
  expect(p.rows[0].issues).toContainEqual({
    column: "基礎代謝量(kcal)",
    message: "数値を確認してください。",
  });
});
