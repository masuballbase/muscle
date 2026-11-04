"use client";
import { useEffect, useState } from "react";
export function OfflineShell() {
  const [message, setMessage] = useState("オフライン用画面：未確認");
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    let active = true;
    void navigator.serviceWorker
      .register("/offline-worker.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (active) setMessage("オフライン用画面：準備済み");
      })
      .catch(() => {
        if (active)
          setMessage(
            "オフライン用画面を準備できません。通信断中の再読み込みは保証できません。",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return process.env.NODE_ENV !== "production" ? null : message ? (
    <p className="small muted" role="status">
      {message}
    </p>
  ) : null;
}
