"use client";
import { useEffect, useRef } from "react";
const stack: { token: string; pop: () => void }[] = [];
let listening = false;
const handledPops = new WeakSet<Event>();
export function isDialogNavigation(event: Event) {
  return handledPops.has(event);
}
function dispatch(event: PopStateEvent) {
  const top = stack.at(-1);
  if (!top) return;
  handledPops.add(event);
  event.stopImmediatePropagation();
  top.pop();
}
export function useDialogHistory(
  onClose: () => void,
  dirty = false,
  blocked = false,
) {
  const latest = useRef({ onClose, dirty, blocked });
  const alreadyConfirmed = useRef(false);
  useEffect(() => {
    latest.current = { onClose, dirty, blocked };
  });
  useEffect(() => {
    const token = crypto.randomUUID();
    const hash = `#dialog-${token}`;
    const restore = () => history.pushState({ ...history.state }, "", hash);
    const entry = {
      token,
      pop: () => {
        const value = latest.current;
        if (value.blocked) {
          restore();
          return;
        }
        const confirmed = alreadyConfirmed.current;
        alreadyConfirmed.current = false;
        if (
          value.dirty &&
          !confirmed &&
          !window.confirm("保存していない変更を破棄しますか？")
        ) {
          restore();
          return;
        }
        value.onClose();
      },
    };
    stack.push(entry);
    restore();
    if (!listening) {
      window.addEventListener("popstate", dispatch, true);
      listening = true;
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty || latest.current.blocked)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      window.removeEventListener("beforeunload", unload);
      if (!stack.length) {
        window.removeEventListener("popstate", dispatch, true);
        listening = false;
      }
    };
  }, []);
  return {
    close: () => history.back(),
    confirmed: () => {
      alreadyConfirmed.current = true;
      history.back();
    },
  };
}
