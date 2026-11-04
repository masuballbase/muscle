"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UserStore } from "@/lib/local-store";
import { InBodyController } from "@/lib/inbody/controller";
import { InBodyRepository } from "@/lib/inbody/repository";
import { getSupabase } from "@/lib/supabase";
const Context = createContext<InBodyController | null>(null);
export function InBodyProvider({
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
      new InBodyController(store, new InBodyRepository(getSupabase(), userId)),
  );
  useEffect(() => {
    void controller.initialize();
    const retry = () => void controller.initialize();
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
      controller.dispose();
    };
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useInBody() {
  const controller = useContext(Context);
  if (!controller) throw new Error("InBodyProvider is required");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  return { controller, ...state };
}
