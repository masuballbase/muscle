import type { UserStore } from "../local-store";
import { type Measurement, duplicate } from "./model";
import type { InBodyRepository } from "./repository";
export type InBodyState = {
  records: Measurement[];
  ready: boolean;
  online: boolean;
  busy: boolean;
  message: string;
};
export class InBodyController {
  private state: InBodyState = {
    records: [],
    ready: false,
    online: false,
    busy: false,
    message: "",
  };
  private listeners = new Set<() => void>();
  private disposed = false;
  private generation = 0;
  constructor(
    private store: UserStore,
    private repo: InBodyRepository,
  ) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(patch: Partial<InBodyState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private async cache() {
    try {
      await this.store.put("cache", "inbody", this.state.records);
    } catch {
      this.set({
        message: "サーバー確認済みですがInBodyの端末保存に失敗しました。",
      });
    }
  }
  async initialize() {
    if (this.state.busy) return;
    this.disposed = false;
    const generation = ++this.generation;
    if (!this.state.ready) {
      try {
        const cached = await this.store.get<Measurement[]>("cache", "inbody");
        if (generation !== this.generation || this.disposed) return;
        if (cached)
          this.set({ records: cached.value, ready: true, online: false });
      } catch {
        /* Retry the remote read without claiming a successful cache read. */
      }
    }
    try {
      const records = await this.repo.list();
      if (generation !== this.generation || this.disposed) return;
      this.set({ records, ready: true, online: true, message: "" });
      await this.cache();
    } catch {
      if (generation === this.generation)
        this.set({
          ready: true,
          online: false,
          message:
            "InBodyはサーバー未確認です。保存済みの表示を保持しています。",
        });
    }
  }
  async save(record: Measurement, original: Measurement | null) {
    if (this.state.busy) throw new Error("保存中です。");
    this.generation++;
    this.set({ busy: true, message: "" });
    try {
      const saved = await this.repo.save(record, original);
      this.set({
        records: [
          ...this.state.records.filter((r) => r.id !== saved.id),
          saved,
        ],
        online: true,
        ready: true,
        message: "InBodyを正式保存しました。",
      });
      await this.cache();
      return saved;
    } catch (error) {
      this.set({ online: false });
      throw error;
    } finally {
      this.set({ busy: false });
    }
  }
  async remove(record: Measurement) {
    if (this.state.busy) throw new Error("保存中です。");
    this.generation++;
    this.set({ busy: true, message: "" });
    try {
      await this.repo.remove(record);
      this.set({
        records: this.state.records.filter((r) => r.id !== record.id),
        online: true,
        message: "InBodyを削除しました。",
      });
      await this.cache();
    } catch (error) {
      this.set({ online: false });
      throw error;
    } finally {
      this.set({ busy: false });
    }
  }
  async fresh() {
    const records = await this.repo.list();
    this.set({ records, online: true, ready: true });
    return records;
  }
  async importRow(record: Measurement, replacementId?: string) {
    const records = await this.fresh();
    if (duplicate(records, record.measuredOn, record.rawFields))
      return "duplicate" as const;
    const original = replacementId
      ? records.find((r) => r.id === replacementId)
      : null;
    if (
      replacementId &&
      (!original || original.measuredOn !== record.measuredOn)
    )
      throw new Error("同じ日の置換対象を選び直してください。");
    await this.save(
      original
        ? { ...record, id: original.id, importedAt: original.importedAt }
        : record,
      original ?? null,
    );
    return "saved" as const;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.listeners.clear();
  }
}
