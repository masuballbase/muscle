"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { openUserStore, type UserStore } from "@/lib/local-store";

const tabs = [
  { href: "/", label: "記録", icon: "＋" },
  { href: "/history", label: "履歴", icon: "▦" },
  { href: "/analysis", label: "分析", icon: "↗" },
  { href: "/inbody", label: "InBody", icon: "◎" },
];
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const store = useRef<UserStore | null>(null);
  const userId = session?.user.id;
  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabase();
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, next) => {
        if (active) {
          setSession(next);
          setReady(true);
        }
      });
      void supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (active) {
            if (error)
              setError(
                "ログイン状態を確認できません。再度ログインしてください。",
              );
            setSession(data.session);
            setReady(true);
          }
        })
        .catch(() => {
          if (active) {
            setError("認証サービスに接続できません。");
            setReady(true);
          }
        });
      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      queueMicrotask(() => {
        if (active) {
          setError("認証サービスの設定を確認してください。");
          setReady(true);
        }
      });
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let connection: UserStore | undefined;
    void openUserStore(userId)
      .then((db) => {
        connection = db;
        if (!active) {
          db.close();
          return;
        }
        store.current = db;
        setStorage("ready");
      })
      .catch(() => {
        if (active) setStorage("failed");
      });
    return () => {
      active = false;
      connection?.close();
      store.current = null;
      setStorage("loading");
    };
  }, [userId]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      });
      if (error)
        setError(
          "ログインできません。メールアドレス・パスワードと通信状態を確認してください。",
        );
      else form.reset();
    } catch {
      setError("認証サービスに接続できません。");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      if (!store.current) {
        setError(
          "端末データを確認できないため、未同期の記録が残っている可能性があります。",
        );
        if (!window.confirm("端末データを確認できません。ログアウトしますか？"))
          return;
      } else if (
        (await store.current.pendingCount()) > 0 &&
        !window.confirm(
          "未同期の記録または下書きが端末に残っています。この端末に保持したままログアウトしますか？",
        )
      )
        return;
      const { error } = await getSupabase().auth.signOut({ scope: "local" });
      if (error) setError("ログアウトできませんでした。再試行してください。");
      else {
        store.current?.close();
        store.current = null;
        setSession(null);
      }
    } catch {
      setError("端末データの確認またはログアウトに失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <main className="auth">
        <p role="status">ログイン状態を確認中…</p>
      </main>
    );
  if (!session)
    return (
      <main className="auth">
        <p className="eyebrow">MUSCLE / TRAINING JOURNAL</p>
        <h1>
          日々の積み重ねを、
          <br />
          自分の力に。
        </h1>
        <p className="muted">筋トレ記録アプリにログイン</p>
        <form onSubmit={login}>
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <button className="primary" disabled={busy}>
            {busy ? "ログイン中…" : "ログイン"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="muted small">登録済みのアカウントを使用してください。</p>
      </main>
    );
  return (
    <div className="app">
      <header className="header">
        <Link href="/" className="brand">
          MUSCLE<span>筋トレ記録</span>
        </Link>
        <button onClick={logout} disabled={busy}>
          ログアウト
        </button>
      </header>
      <div className="account">
        <span>{session.user.email}</span>
        <span role="status">
          {storage === "failed"
            ? "端末保存失敗"
            : storage === "loading"
              ? "端末保存を確認中…"
              : "端末保存基盤：利用可能"}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {storage === "failed" && (
        <p className="error" role="alert">
          端末保存を利用できません。ブラウザの保存設定を確認し、再読み込みしてください。
        </p>
      )}
      <main id="main" className="content" key={userId}>
        {children}
        <aside className="notice">
          現在はPhase
          1の基盤です。記録の作成・サーバー同期は今後の段階で実装します。端末のサイトデータを消去すると、未同期のデータや下書きが失われます。
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
