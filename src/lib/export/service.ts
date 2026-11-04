import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserStore } from "../local-store";
import {
  columns,
  type Tables,
  type Table,
  sanitizeTables,
  exportWorkout,
  exportDraft,
} from "./model";
export class ExportService {
  constructor(
    private client: SupabaseClient,
    private store: UserStore,
    readonly userId: string,
  ) {}
  private async owner() {
    if (this.store.userId !== this.userId)
      throw new Error("端末ユーザーが一致しません。");
    const { data, error } = await this.client.auth.getSession();
    if (error || data.session?.user.id !== this.userId)
      throw new Error("ログインユーザーを確認できません。出力を中止しました。");
  }
  private async readServer() {
    const tables = {} as Tables;
    for (const table of Object.keys(columns) as Table[]) {
      tables[table] = [];
      for (let offset = 0; ; offset += 500) {
        await this.owner();
        const { data, error } = await this.client
          .from(table)
          .select("*")
          .eq("user_id", this.userId)
          .order("id")
          .range(offset, offset + 499)
          .abortSignal(AbortSignal.timeout(12000));
        if (error) throw new Error("Server read incomplete");
        tables[table].push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
    }
    return sanitizeTables(tables, this.userId);
  }
  async create(
    options: { volatileInputAtRisk: boolean } = { volatileInputAtRisk: false },
  ) {
    await this.owner();
    const device = await this.store.exportSnapshot(),
      deviceCapturedAt = new Date().toISOString(),
      warnings: string[] = [];
    if (device.queue.length)
      throw new Error("未対応の同期キューがあるため、安全に出力できません。");
    let server: {
      source: "server";
      confirmation: "fresh" | "cached" | "unavailable";
      lastConfirmedAt: string | null;
      tables: Tables | null;
      omittedColumns: Record<string, string[]>;
    } = {
      source: "server",
      confirmation: "unavailable",
      lastConfirmedAt: null,
      tables: null,
      omittedColumns: {},
    };
    try {
      const read = await this.readServer();
      await this.owner();
      const confirmedAt = new Date().toISOString();
      server = {
        source: "server",
        confirmation: "fresh",
        lastConfirmedAt: confirmedAt,
        ...read,
      };
      try {
        await this.store.put("cache", "data-export", {
          version: 1,
          userId: this.userId,
          confirmedAt,
          ...read,
        });
      } catch {
        warnings.push(
          "今回のサーバー取得は成功しましたが、端末の出力用キャッシュ保存に失敗しました。",
        );
      }
    } catch {
      // An account change is never handled by silently falling back to the old account's cache.
      await this.owner();
      const cached = device.cache?.value as
        | {
            version?: number;
            userId?: string;
            confirmedAt?: string;
            tables?: unknown;
            omittedColumns?: Record<string, unknown>;
          }
        | undefined;
      if (
        cached?.version === 1 &&
        cached.userId === this.userId &&
        typeof cached.confirmedAt === "string"
      ) {
        const read = sanitizeTables(cached.tables, this.userId);
        for (const table of Object.keys(columns)) {
          const omitted = cached.omittedColumns?.[table];
          if (
            Array.isArray(omitted) &&
            omitted.every((name) => typeof name === "string")
          )
            read.omittedColumns[table] = [
              ...new Set([...read.omittedColumns[table], ...omitted]),
            ];
        }
        server = {
          source: "server",
          confirmation: "cached",
          lastConfirmedAt: cached.confirmedAt,
          ...read,
        };
        warnings.push(
          "サーバー最新データは未確認です。過去に全件取得したキャッシュを出力しています。",
        );
      } else
        warnings.push(
          "サーバーの全件取得を確認できず、利用可能な出力用キャッシュもありません。サーバーデータは含まれません。",
        );
    }
    const sessions = device.sessions
      .filter((r) => {
        const w = r.value as { revision?: unknown; syncedRevision?: unknown };
        return (
          typeof w?.revision !== "number" || w.revision !== w.syncedRevision
        );
      })
      .map((r) => ({
        source: "device_indexeddb" as const,
        syncStatus: "pending" as const,
        confirmation: "not_confirmed" as const,
        persistedAt: r.updatedAt,
        value: exportWorkout(r.value),
      }));
    const menuDrafts = device.menus.map((r) => ({
      source: "device_indexeddb" as const,
      syncStatus: "draft_not_formal" as const,
      confirmation: "not_confirmed" as const,
      persistedAt: r.updatedAt,
      value: exportDraft(r.value),
    }));
    if (sessions.length || menuDrafts.length)
      warnings.push(
        "未同期セッションとメニュー下書きはサーバー版に統合せず、別区分で含めています。",
      );
    if (options.volatileInputAtRisk)
      warnings.push(
        "端末保存失敗の入力があります。この出力に最新の未保存入力が含まれるとは保証できません。",
      );
    if (Object.values(server.omittedColumns).some((v) => v.length))
      warnings.push(
        "既知の業務データ項目以外の列は除外しました。除外列名を確認してください。",
      );
    const incompleteInBody = server.tables
      ? server.tables.inbody_records.filter(
          (row) =>
            Object.keys(row.raw_fields as Record<string, unknown>).length !==
            44,
        ).length
      : null;
    if (incompleteInBody)
      warnings.push(
        `原44項目が揃っていないInBody記録が${incompleteInBody}件あります。欠損を補完せず、保存されている原値だけを出力します。`,
      );
    warnings.push(
      "8テーブルは複数の読み取りで取得します。他端末の同時更新を含む全体の同一時点を保証する形式ではありません。",
    );
    await this.owner();
    return {
      schemaVersion: "muscle-data-export/1",
      exportedAt: new Date().toISOString(),
      userId: this.userId,
      scope: {
        tables: Object.keys(columns),
        devicePendingSessions: true,
        deviceMenuDrafts: true,
        credentials: false,
        restoreSupported: false,
      },
      server,
      device: {
        source: "device_indexeddb",
        capturedAt: deviceCapturedAt,
        volatileInputIncluded: false,
        volatileInputAtRisk: options.volatileInputAtRisk,
        sessions,
        menuDrafts,
      },
      counts: {
        incompleteInBodyRecords: incompleteInBody,
        server: server.tables
          ? Object.fromEntries(
              Object.entries(server.tables).map(([t, r]) => [t, r.length]),
            )
          : null,
        devicePendingSessions: sessions.length,
        deviceMenuDrafts: menuDrafts.length,
      },
      warnings,
    };
  }
}
