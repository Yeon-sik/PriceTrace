"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    const syncUser = (user: User | null) => {
      setUserEmail(user?.email ?? null);
      setIsAdmin(user?.app_metadata?.role === "admin");
    };
    void client.auth.getUser().then(({ data }) => {
      syncUser(data.user);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      syncUser(session?.user ?? null);
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
        <span title={userEmail}>{isAdmin ? "관리자 · " : ""}{userEmail}</span>
        <button type="button" onClick={() => void client?.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  if (!modal) {
    return (
      <button type="button" className={styles.loginButton} onClick={onOpen}>
        로그인 <span aria-hidden="true">↗</span>
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
    setMessage("로그인되었습니다.");
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
          aria-label="로그인 창 닫기"
        >
          ×
        </button>
        <p className={styles.kicker}>PRICETRACE ACCOUNT</p>
        <h2 id="auth-title">로그인</h2>
        <p>로그인하면 영수증·판매처·상품의 private identity 상세를 확인할 수 있습니다. 관리자 기능은 관리자 계정에만 표시됩니다.</p>
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
            로그인
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
