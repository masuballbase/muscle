"use client";
import { useEffect } from "react";
export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport,
      root = document.documentElement;
    let baseline = window.innerHeight,
      frame = 0;
    const update = () => {
      const target = document.activeElement,
        editing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement;
      const height = viewport?.height ?? window.innerHeight,
        scale = viewport?.scale ?? 1;
      if (!editing) baseline = window.innerHeight;
      const inset =
        editing && scale === 1
          ? Math.max(
              0,
              window.innerHeight - height - (viewport?.offsetTop ?? 0),
            )
          : 0;
      const open =
        editing && scale === 1 && (inset > 100 || baseline - height > 120);
      root.style.setProperty("--keyboard-inset", `${inset}px`);
      root.style.setProperty("--usable-viewport", `${height}px`);
      root.dataset.keyboardOpen = open ? "true" : "false";
      cancelAnimationFrame(frame);
      if (open)
        frame = requestAnimationFrame(() => {
          target?.scrollIntoView({ block: "nearest", behavior: "auto" });
          const rect = target?.getBoundingClientRect();
          if (!rect) return;
          const dialog = target?.closest("dialog");
          const top = (viewport?.offsetTop ?? 0) + 16,
            bottom = (viewport?.offsetTop ?? 0) + height - (dialog ? 24 : 120);
          const amount =
            rect.bottom > bottom
              ? rect.bottom - bottom
              : rect.top < top
                ? rect.top - top
                : 0;
          if (amount) {
            if (dialog) dialog.scrollBy({ top: amount, behavior: "auto" });
            else window.scrollBy({ top: amount, behavior: "auto" });
          }
        });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      delete root.dataset.keyboardOpen;
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--usable-viewport");
    };
  }, []);
}
