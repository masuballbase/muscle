import { type CsvProfile, validDay } from "./model";
// Verified against the user-supplied 44-column schema and anonymized real-format sample.
// Only header metadata is stored here; no personal measurement values are included.
export const inBodyHeaders = [
  "日付",
  "測定機器",
  "体重(kg)",
  "骨格筋量(kg)",
  "筋肉量(kg)",
  "体脂肪量(kg)",
  "BMI(kg/m²)",
  "体脂肪率(%)",
  "基礎代謝量(kcal)",
  "InBody点数",
  "右腕筋肉量(kg)",
  "左腕筋肉量(kg)",
  "体幹筋肉量(kg)",
  "右脚筋肉量(kg)",
  "左脚筋肉量(kg)",
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
  "ウエストヒップ比",
  "腹囲(cm)",
  "内臓脂肪断面積(cm²)",
  "内臓脂肪レベル(Level)",
  "体水分量(L)",
  "細胞内水分量(L)",
  "細胞外水分量(L)",
  "細胞外水分比",
  "上下均衡",
  "上半身均衡",
  "下半身均衡",
  "下肢筋力レベル(Level)",
  "下半身筋肉量(kg)",
  "タンパク質量(kg)",
  "ミネラル量(kg)",
  "骨ミネラル量(kg)",
  "体細胞量(kg)",
  "骨格筋指数(kg/m²)",
  "全身位相角(°)",
] as const;
export const verifiedCsvProfile: CsvProfile = {
  headers: [...inBodyHeaders],
  numericHeaders: inBodyHeaders.filter((h) => h !== "日付" && h !== "測定機器"),
  columns: {
    weight: "体重(kg)",
    bodyFatPercent: "体脂肪率(%)",
    muscleMass: "筋肉量(kg)",
    bmi: "BMI(kg/m²)",
    skeletalMuscleMass: "骨格筋量(kg)",
    fatMass: "体脂肪量(kg)",
    rightArm: "右腕筋肉量(kg)",
    leftArm: "左腕筋肉量(kg)",
    trunk: "体幹筋肉量(kg)",
    rightLeg: "右脚筋肉量(kg)",
    leftLeg: "左脚筋肉量(kg)",
    score: "InBody点数",
  },
  dateHeader: "日付",
  parseDate(value) {
    // No numeric/scientific-notation recovery: the original date may be rounded.
    if (typeof value !== "string") return null;
    const text = value.trim();
    const day = /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(text)
      ? text.replaceAll("/", "-")
      : /^\d{8}$/.test(text)
        ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
        : "";
    return validDay(day) ? day : null;
  },
};
