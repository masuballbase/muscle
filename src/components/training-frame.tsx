"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTraining, SaveStatus } from "./training-context";
import { TrainingScreen } from "./training-screen";
const tabs = [
  { href: "/", label: "記録", icon: "＋" },
  { href: "/history", label: "履歴", icon: "▦" },
  { href: "/analysis", label: "分析", icon: "↗" },
  { href: "/inbody", label: "InBody", icon: "◎" },
];
export function TrainingFrame({
  email,
  busy,
  logout,
  children,
}: {
  email?: string;
  busy: boolean;
  logout: () => Promise<void>;
  children: ReactNode;
}) {
  const { controller, fullScreen, error } = useTraining();
  const path = usePathname();
  if (fullScreen && controller.active) return <TrainingScreen />;
  return (
    <div className="app">
      <header className="header">
        <Link href="/" className="brand">
          MUSCLE<span>筋トレ記録</span>
        </Link>
        <button
          disabled={busy}
          onClick={async () => {
            await controller.flushLocal();
            await logout();
          }}
        >
          ログアウト
        </button>
      </header>
      <div className="account">
        <span>{email}</span>
        <span>端末保存基盤：利用可能</span>
        <SaveStatus />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {controller.active && path !== "/" && (
        <Link className="resume-bar" href="/" onClick={() => controller.open()}>
          進行中のトレーニングを再開
        </Link>
      )}
      <main className="content">
        {children}
        <aside className="notice">
          端末のサイトデータを消去すると、未同期の記録や下書きが失われます。
        </aside>
      </main>
      <nav className="tabs" aria-label="メインナビゲーション">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={path === tab.href ? "page" : undefined}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
