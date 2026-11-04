/** Account-scoped storage. Credentials must never be stored here. */
export type LocalCollection =
  "session_drafts" | "menu_drafts" | "sync_queue" | "cache";
export type LocalRecord<T = unknown> = {
  id: string;
  value: T;
  updatedAt: string;
};
const collections: LocalCollection[] = [
  "session_drafts",
  "menu_drafts",
  "sync_queue",
  "cache",
];
export function openUserStore(userId: string, factory?: IDBFactory) {
  if (!userId.trim())
    return Promise.reject(new Error("ユーザーIDが必要です。"));
  return new Promise<UserStore>((resolve, reject) => {
    const dbFactory = factory ?? globalThis.indexedDB;
    if (!dbFactory) {
      reject(new Error("端末保存を利用できません。"));
      return;
    }
    let failed = false;
    const request = dbFactory.open(
      `muscle:user:${encodeURIComponent(userId)}`,
      2,
    );
    request.onupgradeneeded = () => {
      for (const name of collections)
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onerror = () => {
      failed = true;
      reject(new Error("端末保存を開始できません。"));
    };
    request.onblocked = () => {
      failed = true;
      reject(new Error("ほかのタブを閉じて再試行してください。"));
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(new UserStore(request.result));
    };
  });
}
export class UserStore {
  constructor(private readonly db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }
  close() {
    this.db.close();
  }
  private run<T>(
    collection: LocalCollection,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(collection, mode);
      const request = action(transaction.objectStore(collection));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("端末保存に失敗しました。"));
    });
  }
  async put<T>(collection: LocalCollection, id: string, value: T) {
    await this.run(collection, "readwrite", (store) =>
      store.put({ id, value, updatedAt: new Date().toISOString() }),
    );
  }
  get<T>(
    collection: LocalCollection,
    id: string,
  ): Promise<LocalRecord<T> | undefined> {
    return this.run(collection, "readonly", (store) => store.get(id));
  }
  list<T>(collection: LocalCollection): Promise<LocalRecord<T>[]> {
    return this.run(collection, "readonly", (store) => store.getAll());
  }
  async remove(collection: LocalCollection, id: string) {
    await this.run(collection, "readwrite", (store) => store.delete(id));
  }
  async pendingCount() {
    const [sessions, menus, queue] = await Promise.all(
      collections
        .filter((name) => name !== "cache")
        .map((name) => this.list(name)),
    );
    return (
      sessions.filter((record) => {
        const value = record.value as {
          revision?: number;
          syncedRevision?: number;
        };
        return !(
          typeof value?.revision === "number" &&
          value.syncedRevision === value.revision
        );
      }).length +
      menus.length +
      queue.length
    );
  }
}
