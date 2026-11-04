"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { GoalsProvider } from "./goals-context";
import type { UserStore } from "@/lib/local-store";
import { getSupabase } from "@/lib/supabase";
import { TrainingController } from "@/lib/training/controller";
import { TrainingRepository } from "@/lib/training/repository";
const Context = createContext<TrainingController | null>(null);
export function TrainingProvider({
  userId,
  store,
  children,
}: {
  userId: string;
  store: UserStore;
  children: ReactNode;
}) {
  const [controller] = useState(
    () =>
      new TrainingController(
        store,
        new TrainingRepository(getSupabase(), userId),
      ),
  );
  useEffect(() => {
    void controller.initialize();
    const retry = () => void controller.sync();
    window.addEventListener("online", retry);
    const warn = (event: BeforeUnloadEvent) => {
      if (
        ["端末保存中", "端末保存失敗"].includes(controller.snapshot().saveState)
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    const timer = setInterval(retry, 15000);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("beforeunload", warn);
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller]);
  return (
    <Context.Provider value={controller}>
      <GoalsProvider userId={userId} store={store}>
        {children}
      </GoalsProvider>
    </Context.Provider>
  );
}
export function useTraining() {
  const controller = useContext(Context);
  if (!controller) throw new Error("TrainingProvider is required");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  return { controller, ...state };
}
export function SaveStatus() {
  const { saveState, controller } = useTraining();
  return (
    <div className="save-status">
      <span role="status">{saveState}</span>
      {(saveState === "端末保存済み・未同期" ||
        saveState === "端末保存失敗") && (
        <button onClick={() => void controller.retry()}>保存を再試行</button>
      )}
    </div>
  );
}
