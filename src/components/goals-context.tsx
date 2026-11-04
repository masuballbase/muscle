"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { UserStore } from "@/lib/local-store";
import { getSupabase } from "@/lib/supabase";
import { GoalsRepository } from "@/lib/analytics/goals-repository";
import type { Goal } from "@/lib/analytics/model";
type State = {
  goals: Goal[];
  loaded: boolean;
  online: boolean;
  message: string;
};
const Context = createContext<
  | (State & {
      reload: () => Promise<void>;
      save: (target: number, timeZone: string) => Promise<void>;
    })
  | null
>(null);
export function GoalsProvider({
  userId,
  store,
  children,
}: {
  userId: string;
  store: UserStore;
  children: ReactNode;
}) {
  const [repo] = useState(() => new GoalsRepository(getSupabase(), userId));
  const [state, setState] = useState<State>({
    goals: [],
    loaded: false,
    online: false,
    message: "",
  });
  const mounted = useRef(false),
    generation = useRef(0),
    saving = useRef(false);
  const cache = useCallback(
    async (goals: Goal[]) => {
      try {
        await store.put("cache", "weekly-goals", goals);
      } catch {
        if (mounted.current)
          setState((s) => ({
            ...s,
            message: "目標はサーバー確認済みですが端末保存に失敗しました。",
          }));
      }
    },
    [store],
  );
  const invalidateReads = useCallback(() => {
    generation.current++;
  }, []);
  const reload = useCallback(async () => {
    if (saving.current) return;
    const version = ++generation.current;
    try {
      const goals = await repo.list();
      if (!mounted.current || version !== generation.current) return;
      setState({ goals, loaded: true, online: true, message: "" });
      await cache(goals);
    } catch {
      if (mounted.current && version === generation.current)
        setState((s) => ({
          ...s,
          online: false,
          message: "週間目標を読み込めません。保存済みの表示を保持しています。",
        }));
    }
  }, [repo, cache]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await store.get<Goal[]>("cache", "weekly-goals");
        if (!cancelled && cached)
          setState({
            goals: cached.value,
            loaded: true,
            online: false,
            message: "保存済みの週間目標を表示しています。",
          });
      } catch {
        /* Remote read still possible; do not claim cache success. */
      }
      if (!cancelled) await reload();
    })();
    const retry = () => void reload();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      cancelled = true;
      mounted.current = false;
      invalidateReads();
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [store, reload, invalidateReads]);
  const save = async (target: number, timeZone: string) => {
    if (saving.current) throw new Error("目標を保存中です。");
    saving.current = true;
    // A focus-triggered read must not overwrite a just-confirmed save.
    invalidateReads();
    setState((s) => ({ ...s, message: "" }));
    try {
      let saved: Goal;
      try {
        saved = await repo.save(target, timeZone);
      } catch (error) {
        if (mounted.current) setState((s) => ({ ...s, online: false }));
        throw error;
      }
      if (!mounted.current) return;
      setState((s) => ({
        ...s,
        loaded: true,
        online: true,
        message: "来週からの目標を保存しました。",
        goals: [
          ...s.goals.filter(
            (g) => g.effective_monday !== saved.effective_monday,
          ),
          saved,
        ].sort((a, b) => a.effective_monday.localeCompare(b.effective_monday)),
      }));
      try {
        const goals = await repo.list();
        if (!mounted.current) return;
        setState((s) => ({ ...s, goals }));
        await cache(goals);
      } catch {
        if (mounted.current)
          setState((s) => ({
            ...s,
            message:
              "目標は保存済みですが再読確認に失敗しました。再読み込みしてください。",
          }));
      }
    } finally {
      saving.current = false;
    }
  };
  return (
    <Context.Provider value={{ ...state, reload, save }}>
      {children}
    </Context.Provider>
  );
}
export function useGoals() {
  const context = useContext(Context);
  if (!context) throw new Error("GoalsProvider is required");
  return context;
}
export function useAnalysisClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return { now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
