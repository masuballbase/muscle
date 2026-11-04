import {
  type RawFields,
  type CsvProfile,
  type FieldIssue,
  normalizeCell,
  filenameDate,
  fieldIssues,
  validateProfile,
} from "./model";
export type CsvRow = {
  id: string;
  line: number;
  measuredOn: string;
  rawFields: RawFields;
  issues: FieldIssue[];
  action: "undecided" | "add" | "replace" | "skip";
  replaceId: string;
  state: "pending" | "saved" | "skipped" | "failed";
  error: string;
};
// Generic CSV syntax only: it makes NO assumptions about InBody header names/units.
export function csvTable(text: string): { cells: string[]; line: number }[] {
  if (text.length > 2 * 1024 * 1024)
    throw new Error("CSVは2MB以下にしてください。");
  text = text.replace(/^\uFEFF/, "");
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
    closed = false;
  };
  const endRow = () => {
    endCell();
    if (cells.length > 1 || cells.some((c) => c !== ""))
      rows.push({ cells, line: start });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += c;
        if (c === "\n") line++;
      }
      continue;
    }
    if (c === '"') {
      if (cell || closed)
        throw new Error(`${line}行：引用符の位置が不正です。`);
      quoted = true;
    } else if (c === ",") endCell();
    else if (c === "\r" || c === "\n") {
      endRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      start = line;
    } else {
      if (closed)
        throw new Error(`${line}行：引用符の後に不正な文字があります。`);
      cell += c;
    }
  }
  if (quoted) throw new Error(`${start}行：引用符が閉じていません。`);
  if (cell || cells.length || closed) endRow();
  if (rows.length > 1001)
    throw new Error("1ファイルの測定データは1000行以下にしてください。");
  return rows;
}
export function previewCsv(
  text: string,
  filename: string,
  profile: CsvProfile | null,
) {
  const table = csvTable(text);
  if (!table.length) throw new Error("CSVが空です。");
  const headers = table[0].cells;
  const headerLine = table[0].line;
  if (
    headers.some((h) => !h.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(`${headerLine}行：空または重複したヘッダーがあります。`);
  if (profile) validateProfile(profile);
  const issues: string[] = [];
  if (headers.length !== 44)
    issues.push(
      `${headerLine}行：ヘッダーは${headers.length}項目です。44項目が必要です。`,
    );
  if (!profile)
    issues.push("実CSVの列対応が未確認のため、正式取り込みはできません。");
  if (profile) {
    for (const h of profile.headers)
      if (!headers.includes(h)) issues.push(`${headerLine}行：不足列：${h}`);
    for (const h of headers)
      if (!profile.headers.includes(h))
        issues.push(`${headerLine}行：未確認列：${h}`);
  }
  const fallback = filenameDate(filename);
  const rows: CsvRow[] = table.slice(1).map(({ cells, line }) => {
    const rawFields: RawFields = Object.create(null);
    headers.forEach((h, i) => {
      rawFields[h] = normalizeCell(cells[i] ?? null);
    });
    const rowIssues = fieldIssues(rawFields, profile);
    if (cells.length !== headers.length)
      rowIssues.push({
        column: "全体",
        message: `列数が一致しません（${cells.length}/${headers.length}）。`,
      });
    const measuredOn =
      (profile?.dateHeader
        ? profile.parseDate?.(rawFields[profile.dateHeader])
        : null) || fallback;
    return {
      id: crypto.randomUUID(),
      line,
      measuredOn,
      rawFields,
      issues: rowIssues,
      action: "undecided",
      replaceId: "",
      state: "pending",
      error: "",
    };
  });
  if (!rows.length) issues.push("測定データ行がありません。");
  return { headers, rows, issues };
}
