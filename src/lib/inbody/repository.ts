import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Measurement,
  type CsvProfile,
  type RawFields,
  validateMeasurement,
  duplicate,
} from "./model";
import { verifiedCsvProfile } from "./profile";
function fromRow(row: Record<string, unknown>): Measurement {
  return {
    id: String(row.id),
    measuredOn: String(row.measured_on),
    importedAt: String(row.imported_at),
    sourceFilename:
      row.source_filename === null ? null : String(row.source_filename),
    rawFields: row.raw_fields as RawFields,
  };
}
export class InBodyRepository {
  constructor(
    private client: SupabaseClient,
    readonly userId: string,
    private profile: CsvProfile | null = verifiedCsvProfile,
  ) {}
  private async owner() {
    const { data, error } = await this.client.auth.getSession();
    if (error || data.session?.user.id !== this.userId)
      throw new Error("ログイン状態を確認してください。");
  }
  async list(): Promise<Measurement[]> {
    await this.owner();
    const records: Measurement[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("inbody_records")
        .select("id,measured_on,imported_at,source_filename,raw_fields")
        .eq("user_id", this.userId)
        .order("id")
        .range(offset, offset + 499);
      if (error)
        throw new Error(
          "InBodyの読み込みに失敗しました。保存済み表示を保持しています。",
        );
      records.push(...(data ?? []).map(fromRow));
      if ((data?.length ?? 0) < 500) return records;
    }
  }
  async save(
    record: Measurement,
    original: Measurement | null,
  ): Promise<Measurement> {
    await this.owner();
    validateMeasurement(record, this.profile);
    if (!original && !this.profile)
      throw new Error(
        "実CSVの列対応が未確認のため、正式取り込みはできません。",
      );
    if (
      original &&
      (record.id !== original.id ||
        Object.keys(record.rawFields).sort().join("\0") !==
          Object.keys(original.rawFields).sort().join("\0"))
    )
      throw new Error("既存の44項目とIDを保持してください。");
    const payload = {
      measured_on: record.measuredOn,
      source_filename: record.sourceFilename,
      raw_fields: record.rawFields,
    };
    // One JSONB row per measurement: all 44 fields are replaced atomically.
    const query = original
      ? this.client
          .from("inbody_records")
          .update(payload)
          .eq("id", original.id)
          .eq("user_id", this.userId)
          .eq("imported_at", original.importedAt)
      : this.client.from("inbody_records").insert({
          ...payload,
          id: record.id,
          user_id: this.userId,
          imported_at: record.importedAt,
        });
    const { data, error } = await query.select(
      "id,measured_on,imported_at,source_filename,raw_fields",
    );
    if (error || data?.length !== 1) {
      // A lost creation response can be reconciled by its stable import-row UUID.
      // Never upsert over an unrelated row after a uniqueness error.
      if (!original) {
        const found = (await this.list()).find((r) => r.id === record.id);
        if (
          found &&
          found.sourceFilename === record.sourceFilename &&
          duplicate([found], record.measuredOn, record.rawFields)
        )
          return found;
      }
      throw new Error(
        "正式保存を確認できません。入力を保持しています。再読み込みして確認してください。",
      );
    }
    return fromRow(data[0]);
  }
  async remove(record: Measurement) {
    await this.owner();
    const { data, error } = await this.client
      .from("inbody_records")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", record.id)
      .eq("imported_at", record.importedAt)
      .select("id");
    if (error || data?.length !== 1)
      throw new Error("削除を確認できません。再読み込みしてください。");
  }
}
