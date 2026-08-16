"use client";

import { useEffect, useRef, useState } from "react";
import { trapDialogFocus, useDialogLifecycle } from "@/hooks/use-dialog-lifecycle";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Props = {
  onChange: () => void;
  onOpen?: () => void;
  modal?: boolean;
  onClose?: () => void;
};

export function AuthPanel({ onChange, onOpen, modal = false, onClose }: Props) {
  const emailInputRef = useRef<HTMLInputElement>(null);
  const client = getSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(async ({ data }) => {
      if (data.user?.app_metadata?.role === "admin") {
        setUserEmail(data.user.email ?? null);
        return;
      }
      setUserEmail(null);
      if (data.user) await client.auth.signOut();
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.app_metadata?.role === "admin") {
        setUserEmail(session.user.email ?? null);
      } else {
        setUserEmail(null);
        if (session) void client.auth.signOut();
      }
      onChange();
    });
    return () => data.subscription.unsubscribe();
  }, [client, onChange]);

  useDialogLifecycle({
    enabled: modal && Boolean(onClose),
    initialFocusRef: emailInputRef,
    onClose: () => onClose?.(),
  });

  if (!modal && userEmail) {
    return (
      <div className={styles.userMenu}>
        <span title={userEmail}>{userEmail}</span>
        <button type="button" onClick={() => void client?.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  if (!modal) {
    return (
      <button type="button" className={styles.loginButton} onClick={onOpen}>
        관리자 접근 <span aria-hidden="true">↗</span>
      </button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!client) {
      setMessage("로그인 서비스를 준비 중입니다.");
      return;
    }
    setMessage("");
    const result = await client.auth.signInWithPassword({ email, password });

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    setPassword("");
    if (result.data.user?.app_metadata?.role !== "admin") {
      await client.auth.signOut();
      setMessage("관리자 계정으로만 접근할 수 있습니다.");
      return;
    }

    setMessage("관리자 접근이 허용되었습니다.");
    onClose?.();
  }

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <section
        className={styles.authModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onKeyDown={trapDialogFocus}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="관리자 접근 창 닫기"
        >
          ×
        </button>
        <p className={styles.kicker}>ADMINISTRATION</p>
        <h2 id="auth-title">관리자 접근</h2>
        <p>관리자 계정으로만 접근할 수 있습니다.</p>
        <form onSubmit={submit}>
          <label>
            이메일
            <input
              ref={emailInputRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className={styles.submitButton} type="submit">
            관리자 접근
          </button>
        </form>
        {message && (
          <p className={styles.authMessage} role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
