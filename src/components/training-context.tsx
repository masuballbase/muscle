"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ExportService } from "@/lib/export/service";
import { InBodyProvider } from "./inbody-context";
import { GoalsProvider } from "./goals-context";
import type { UserStore } from "@/lib/local-store";
import { getSupabase } from "@/lib/supabase";
import { TrainingController } from "@/lib/training/controller";
import { TrainingRepository } from "@/lib/training/repository";
const Context = createContext<TrainingController | null>(null);
const ExportContext = createContext<ExportService | null>(null);
export function useExportService() {
  const service = useContext(ExportContext);
  if (!service) throw new Error("Export provider is required");
  return service;
}
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
  const [exportService] = useState(
    () => new ExportService(getSupabase(), store, userId),
  );
  const [access, setAccess] = useState<
    "waiting" | "writer" | "unsupported" | "failed"
  >("waiting");
  useEffect(() => {
    let active = true,
      release = () => {},
      detach = () => {};
    const abort = new AbortController();
    const supports = typeof navigator !== "undefined" && !!navigator.locks;
    const run = async () => {
      if (!active) return;
      await controller.initialize();
      if (!active) return;
      setAccess(supports ? "writer" : "unsupported");
      const reconnect = () => void controller.retry(),
        retry = () => void controller.sync();
      const warn = (event: BeforeUnloadEvent) => {
        if (
          ["端末保存中", "端末保存失敗"].includes(
            controller.snapshot().saveState,
          )
        )
          event.preventDefault();
      };
      window.addEventListener("online", reconnect);
      window.addEventListener("beforeunload", warn);
      const timer = setInterval(retry, 15000);
      detach = () => {
        window.removeEventListener("online", reconnect);
        window.removeEventListener("beforeunload", warn);
        clearInterval(timer);
      };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    if (supports)
      void navigator.locks
        .request(`muscle:writer:${userId}`, { signal: abort.signal }, run)
        .catch(() => {
          if (active) setAccess("failed");
        });
    else void run();
    return () => {
      active = false;
      detach();
      controller.dispose();
      release();
      abort.abort();
    };
  }, [controller, userId]);
  if (access === "waiting")
    return (
      <main className="content">
        <h1>利用状態を確認中</h1>
        <p role="status">
          別タブが利用中の場合、このタブは保存しません。元のタブを閉じると利用できます。
        </p>
      </main>
    );
  if (access === "failed")
    return (
      <main className="content">
        <p role="alert">
          安全な利用状態を確認できません。ほかのタブを閉じて再読み込みしてください。
        </p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    );
  return (
    <Context.Provider value={controller}>
      <ExportContext.Provider value={exportService}>
        <GoalsProvider userId={userId} store={store}>
          <InBodyProvider userId={userId} store={store}>
            {access === "unsupported" && (
              <p className="notice">
                この環境では複数タブ間の書き込み制御を利用できません。編集は1つのタブで行ってください。
              </p>
            )}
            {children}
          </InBodyProvider>
        </GoalsProvider>
      </ExportContext.Provider>
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
      {controller.hasBlocked && (
        <span role="status">競合のため自動同期停止・端末データ保持</span>
      )}
      {(saveState === "端末保存済み・未同期" || saveState === "端末保存失敗") &&
        (!controller.hasBlocked || saveState === "端末保存失敗") && (
          <button onClick={() => void controller.retry()}>
            {controller.hasBlocked ? "端末保存を再試行" : "保存を再試行"}
          </button>
        )}
    </div>
  );
}
