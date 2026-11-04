import type { UserStore } from "../local-store";
import {
  type Exercise,
  type Workout,
  type PR,
  newWorkout,
  finish,
  validNumber,
  prs,
} from "./model";
import type { TrainingRepository } from "./repository";
export type SaveState =
  | "確認中"
  | "端末保存中"
  | "同期済み"
  | "同期中"
  | "端末保存済み・未同期"
  | "端末保存失敗";
export type TrainingState = {
  ready: boolean;
  exercises: Exercise[];
  workouts: Workout[];
  fullScreen: boolean;
  saveState: SaveState;
  error: string;
  toast: PR[];
};
export class TrainingController {
  state: TrainingState = {
    ready: false,
    exercises: [],
    workouts: [],
    fullScreen: false,
    saveState: "確認中",
    error: "",
    toast: [],
  };
  private listeners = new Set<() => void>();
  private disposed = false;
  private initialization = 0;
  private connected = false;
  private readFailed = false;
  private busy = false;
  private syncing = false;
  private writes = new Set<Promise<void>>();
  private persisted = new Map<string, number>();
  private failures = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private store: UserStore,
    private repo: TrainingRepository,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private set(patch: Partial<TrainingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  get active() {
    return this.state.workouts.find((w) => !w.endedAt);
  }
  get baseline() {
    return this.state.workouts.filter(
      (w) => w.endedAt && w.syncedRevision === w.revision,
    );
  }
  async initialize() {
    this.disposed = false;
    const generation = ++this.initialization;
    try {
      if (!this.state.ready) {
        const [local, cache] = await Promise.all([
          this.store.list<Workout>("session_drafts"),
          this.store.get<{ exercises: Exercise[]; workouts: Workout[] }>(
            "cache",
            "training",
          ),
        ]);
        if (this.disposed || generation !== this.initialization) return;
        const saved = local
          .map((record) => record.value)
          .filter(
            (w) => Array.isArray(w.sections) && typeof w.revision === "number",
          );
        for (const w of saved) this.persisted.set(w.id, w.revision);
        const localIds = new Set(saved.map((w) => w.id));
        this.set({
          exercises: cache?.value.exercises ?? [],
          workouts: [
            ...saved,
            ...(cache?.value.workouts ?? []).filter((w) => !localIds.has(w.id)),
          ],
          saveState: "端末保存済み・未同期",
        });
        this.readFailed = false;
      }
    } catch {
      this.readFailed = true;
      this.set({
        saveState: "端末保存失敗",
        error: "端末データを読み込めません。保存設定を確認してください。",
        ready: false,
      });
      return;
    }
    try {
      const [exercises, remote] = await Promise.all([
        this.repo.exercises(),
        this.repo.workouts(),
      ]);
      if (this.disposed || generation !== this.initialization) return;
      this.connected = true;
      const pending = this.state.workouts.filter(
        (w) => w.revision > w.syncedRevision,
      );
      const pendingIds = new Set(pending.map((w) => w.id));
      const workouts = [
        ...pending,
        ...remote
          .filter((w) => !pendingIds.has(w.id))
          .map((w) => {
            const local = this.state.workouts.find((item) => item.id === w.id);
            return {
              ...w,
              committedPrs: local?.committedPrs ?? prs([w]),
              initialRecords: local?.initialRecords,
            };
          }),
      ];
      // Retain any device-only completed record, even after a partially failed synchronization.
      this.set({ exercises, workouts, error: "", ready: true });
      await this.cache();
      this.refreshStatus();
      this.schedule();
    } catch {
      this.connected = false;
      this.set({
        ready: true,
        error: "サーバーに接続できません。端末の記録を保持しています。",
        saveState: "端末保存済み・未同期",
      });
    }
  }
  private async cache() {
    try {
      await this.store.put("cache", "training", {
        exercises: this.state.exercises,
        workouts: this.state.workouts.filter(
          (w) => w.syncedRevision === w.revision,
        ),
      });
      this.failures.delete("cache");
    } catch {
      this.failures.add("cache");
      this.set({
        saveState: "端末保存失敗",
        error: "端末キャッシュの保存に失敗しました。",
      });
    }
  }
  private refreshStatus() {
    if (this.failures.size) this.set({ saveState: "端末保存失敗" });
    else if (this.writes.size) this.set({ saveState: "端末保存中" });
    else if (this.syncing) this.set({ saveState: "同期中" });
    else
      this.set({
        saveState:
          this.state.workouts.some((w) => w.revision > w.syncedRevision) ||
          !this.connected
            ? "端末保存済み・未同期"
            : "同期済み",
      });
  }
  private persist(workout: Workout) {
    if (this.disposed) return;
    // Start the IndexedDB transaction immediately. Its ordering survives navigation/unmount.
    const task: Promise<void> = this.store
      .put("session_drafts", workout.id, structuredClone(workout))
      .then(() => {
        this.persisted.set(
          workout.id,
          Math.max(this.persisted.get(workout.id) ?? 0, workout.revision),
        );
        this.failures.delete(workout.id);
      })
      .catch(() => {
        if (
          this.state.workouts.find((w) => w.id === workout.id)?.revision ===
          workout.revision
        )
          this.failures.add(workout.id);
        this.set({
          error:
            "端末保存に失敗しました。画面を閉じずに保存を再試行してください。",
        });
      })
      .finally(() => {
        this.writes.delete(task);
        this.refreshStatus();
      });
    this.writes.add(task);
    this.refreshStatus();
  }
  async flushLocal() {
    await Promise.all([...this.writes]);
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.disposed) this.timer = setTimeout(() => void this.sync(), 600);
  }
  async retry() {
    if (this.readFailed) {
      await this.initialize();
      return;
    }
    if (this.failures.has("cache")) await this.cache();
    for (const w of this.state.workouts)
      if (w.revision > w.syncedRevision || this.failures.has(w.id))
        this.persist(w);
    await this.flushLocal();
    if (
      !this.connected &&
      !this.state.workouts.some((w) => w.revision > w.syncedRevision)
    )
      await this.initialize();
    await this.sync();
  }
  async sync() {
    if (this.syncing || this.disposed) return;
    this.syncing = true;
    this.refreshStatus();
    try {
      await this.flushLocal();
      if (this.failures.size || this.disposed) return;
      for (;;) {
        const pending = this.state.workouts
          .filter((w) => w.revision > w.syncedRevision)
          .sort(
            (a, b) =>
              Number(!a.endedAt) - Number(!b.endedAt) ||
              a.startedAt.localeCompare(b.startedAt),
          );
        const w = pending[0];
        if (!w || this.disposed) break;
        await this.flushLocal();
        if ((this.persisted.get(w.id) ?? 0) < w.revision) break;
        const invalid = w.sections.some((s) =>
          s.sets.some(
            (set) =>
              (set.weight !== "" && !validNumber(set.weight, false, 0)) ||
              (set.reps !== "" && !validNumber(set.reps, true, 1)) ||
              (set.seconds !== "" && !validNumber(set.seconds, true, 1)),
          ),
        );
        if (invalid)
          throw new Error(
            "入力値にエラーがあります。端末保存は継続しています。",
          );
        await this.repo.sync(structuredClone(w));
        this.connected = true;
        if (this.disposed) return;
        const current = this.state.workouts.find((item) => item.id === w.id)!;
        const acknowledged = { ...current, syncedRevision: w.revision };
        this.set({
          workouts: this.state.workouts.map((item) =>
            item.id === w.id ? acknowledged : item,
          ),
          error: "",
        });
        this.persist(acknowledged);
        await this.flushLocal();
        if (this.failures.size) break;
      }
      await this.cache();
    } catch (error) {
      this.connected = false;
      this.set({
        error:
          error instanceof Error
            ? error.message
            : "同期に失敗しました。端末の記録は保持されています。",
      });
    } finally {
      this.syncing = false;
      this.refreshStatus();
    }
  }
  async start() {
    if (this.busy || !this.state.ready || this.active || this.failures.size)
      return;
    this.busy = true;
    try {
      const workout = newWorkout();
      this.set({
        workouts: [...this.state.workouts, workout],
        fullScreen: true,
        error: "",
      });
      this.persist(workout);
      this.schedule();
    } finally {
      this.busy = false;
    }
  }
  open() {
    if (this.active) this.set({ fullScreen: true });
  }
  back() {
    this.set({ fullScreen: false });
  }
  error(message: string) {
    this.set({ error: message });
  }
  edit(transform: (w: Workout) => Workout, notify = false, input = false) {
    const current = this.active;
    if (!current) return;
    const changed = {
      ...transform(structuredClone(current)),
      revision: current.revision + 1,
    };
    if (!input) {
      const baseline = prs(this.baseline);
      const before = [...baseline, ...(current.committedPrs ?? prs([current]))];
      const after = prs([...this.baseline, changed]);
      const updated = after.filter((p) => {
        const previous = before.filter(
          (old) => old.exerciseId === p.exerciseId && old.metric === p.metric,
        );
        return (
          previous.length > 0 &&
          p.value > Math.max(...previous.map((old) => old.value))
        );
      });
      const ids = new Set(
        changed.sections.flatMap((s) =>
          s.sets.filter((set) => set.performed).map((set) => set.id),
        ),
      );
      const initial = (current.initialRecords ?? []).filter((p) =>
        ids.has(p.setId),
      );
      for (const p of prs([changed]))
        if (
          !baseline.some(
            (old) => old.exerciseId === p.exerciseId && old.metric === p.metric,
          ) &&
          !initial.some(
            (old) => old.exerciseId === p.exerciseId && old.metric === p.metric,
          )
        ) {
          const section = changed.sections.find(
            (s) => s.exerciseId === p.exerciseId,
          )!;
          const source = section.sets.find((set) =>
            prs([{ ...changed, sections: [{ ...section, sets: [set] }] }]).some(
              (value) => value.metric === p.metric && value.value === p.value,
            ),
          );
          if (source) initial.push({ ...p, setId: source.id });
        }
      changed.committedPrs = prs([changed]);
      changed.initialRecords = initial;
      if (notify && updated.length) {
        this.set({ toast: updated });
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.set({ toast: [] }), 3500);
      } else if (!notify) this.set({ toast: [] });
    }
    this.set({
      workouts: this.state.workouts.map((w) =>
        w.id === changed.id ? changed : w,
      ),
    });
    this.persist(changed);
    this.schedule();
  }
  complete() {
    const current = this.active;
    if (!current) return;
    const ended = { ...finish(current), revision: current.revision + 1 };
    this.set({
      workouts: this.state.workouts.map((w) => (w.id === ended.id ? ended : w)),
      fullScreen: false,
      toast: [],
    });
    this.persist(ended);
    this.schedule();
    return ended;
  }
  async saveExercise(exercise: Exercise, create: boolean) {
    const name = exercise.name.trim();
    if (!name) throw new Error("種目名を入力してください。");
    if (
      this.state.exercises.some(
        (e) =>
          e.id !== exercise.id &&
          !e.archived_at &&
          e.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error("同じ名前の種目が登録されています。");
    const usedLocal = this.state.workouts.some((w) =>
      w.sections.some((s) => s.exerciseId === exercise.id),
    );
    const original = this.state.exercises.find((e) => e.id === exercise.id);
    if (
      !create &&
      original?.record_type !== exercise.record_type &&
      (usedLocal || (await this.repo.used(exercise.id)))
    )
      throw new Error("使用済み種目の記録タイプは変更できません。");
    await this.repo.saveExercise({ ...exercise, name }, create);
    if (this.disposed) return;
    this.set({ exercises: await this.repo.exercises(), error: "" });
    await this.cache();
  }
  async removeExercise(exercise: Exercise) {
    if (this.active?.sections.some((s) => s.exerciseId === exercise.id))
      throw new Error("進行中のトレーニングで使用中の種目は削除できません。");
    await this.repo.archive(exercise);
    const drafts = await this.store.list<{
      items?: { exercise_id?: string; exerciseId?: string }[];
    }>("menu_drafts");
    for (const draft of drafts)
      if (Array.isArray(draft.value.items))
        await this.store.put("menu_drafts", draft.id, {
          ...draft.value,
          items: draft.value.items.filter(
            (item) => (item.exercise_id ?? item.exerciseId) !== exercise.id,
          ),
        });
    if (this.disposed) return;
    this.set({ exercises: await this.repo.exercises(), error: "" });
    await this.cache();
  }
  async isUsed(id: string) {
    return (
      this.state.workouts.some((w) =>
        w.sections.some((s) => s.exerciseId === id),
      ) || (await this.repo.used(id))
    );
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.toastTimer);
    this.listeners.clear();
  }
}
