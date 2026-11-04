"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { TrainingProvider } from "./training-context";
import { TrainingFrame } from "./training-frame";
import { getSupabase } from "@/lib/supabase";
import { openUserStore, type UserStore } from "@/lib/local-store";

export function AppShell({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const store = useRef<UserStore | null>(null);
  const [connection, setConnection] = useState<{userId:string;store:UserStore}|null>(null);
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
        setConnection({userId,store:db});
        setStorage("ready");
      })
      .catch(() => {
        if (active) setStorage("failed");
      });
    return () => {
      active = false;
      connection?.close();
      store.current = null;
      setConnection(null);
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
  if (storage !== "ready" || !connection || connection.userId !== userId)
    return (
      <main className="auth">
        <p role="status">
          {storage === "failed" ? "端末保存失敗" : "端末保存を確認中…"}
        </p>
        {storage === "failed" && (
          <p role="alert">
            端末保存を利用できません。ブラウザの保存設定を確認し、再読み込みしてください。
          </p>
        )}
        <button disabled={busy} onClick={logout}>
          ログアウト
        </button>
      </main>
    );
  return (
    <TrainingProvider
      key={userId}
      userId={session.user.id}
      store={connection.store}
    >
      <TrainingFrame email={session.user.email} busy={busy} logout={logout}>
        {error && <p role="alert">{error}</p>}
        {children}
      </TrainingFrame>
    </TrainingProvider>
  );
}
