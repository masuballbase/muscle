// GENERATED FICTIONAL MEASUREMENTS. No personal or uploaded measurement values.
import { verifiedCsvProfile } from "../../src/lib/inbody/profile";
import type { Measurement, RawFields } from "../../src/lib/inbody/model";
export function verifiedFields(weight = "70"): RawFields {
  const raw: RawFields = Object.fromEntries(
    verifiedCsvProfile.headers.map((h) => [h, "1"]),
  );
  Object.assign(raw, {
    日付: "2.0261E+13",
    測定機器: "TEST-DEVICE",
    "体重(kg)": weight,
    "筋肉量(kg)": "45",
    "骨格筋量(kg)": "30",
    "体脂肪率(%)": "20",
    "BMI(kg/m²)": "24",
    "体脂肪量(kg)": "14",
    "右腕筋肉量(kg)": "3.2",
    "左腕筋肉量(kg)": "3.1",
    "右脚筋肉量(kg)": "9.2",
    "左脚筋肉量(kg)": "9.1",
    "体幹筋肉量(kg)": "24",
    InBody点数: "80",
    上半身均衡: "0",
    下半身均衡: "0",
  });
  for (const h of [
    "右腕体脂肪量(kg)",
    "左腕体脂肪量(kg)",
    "体幹体脂肪量(kg)",
    "右脚体脂肪量(kg)",
    "左脚体脂肪量(kg)",
    "右腕 細胞外水分比",
    "左腕 細胞外水分比",
    "体幹 細胞外水分比",
    "右脚 細胞外水分比",
    "左脚 細胞外水分比",
    "腹囲(cm)",
    "内臓脂肪断面積(cm²)",
    "細胞内水分量(L)",
    "細胞外水分量(L)",
  ])
    raw[h] = null;
  return raw;
}
export function verifiedMeasurement(
  id = "one",
  weight = "70",
  day = "2026-11-04",
  importedAt = "2026-11-04T01:00:00Z",
): Measurement {
  return {
    id,
    measuredOn: day,
    importedAt,
    rawFields: verifiedFields(weight),
    sourceFilename: "InBody-20261104(1).csv",
  };
}
export function verifiedCsv(rows: RawFields[], bom = true) {
  const h = verifiedCsvProfile.headers;
  return (
    (bom ? "\uFEFF" : "") +
    [h, ...rows.map((r) => h.map((k) => r[k] ?? "-"))]
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
