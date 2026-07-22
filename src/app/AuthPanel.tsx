"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Props = { onChange: () => void; onOpen?: () => void; modal?: boolean; onClose?: () => void };

export function AuthPanel({ onChange, onOpen, modal = false, onClose }: Props) {
  const client = getSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => { setUserEmail(session?.user?.email ?? null); onChange(); });
    return () => data.subscription.unsubscribe();
  }, [client, onChange]);

  useEffect(() => {
    if (!modal || !onClose) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [modal, onClose]);

  if (!modal && userEmail) return <div className={styles.userMenu}><span title={userEmail}>{userEmail}</span><button type="button" onClick={() => void client?.auth.signOut()}>로그아웃</button></div>;
  if (!modal) return <button type="button" className={styles.loginButton} onClick={onOpen}>로그인 <span aria-hidden="true">↗</span></button>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!client) { setMessage("로그인 서비스를 준비 중입니다."); return; }
    setMessage("");
    const result = mode === "login" ? await client.auth.signInWithPassword({ email, password }) : await client.auth.signUp({ email, password });
    if (result.error) setMessage(result.error.message);
    else {
      setMessage(mode === "login" ? "로그인되었습니다." : "회원가입 요청이 완료되었습니다.");
      setPassword("");
      if (mode === "login") onClose?.();
    }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}><section className={styles.authModal} role="dialog" aria-modal="true" aria-labelledby="auth-title"><button type="button" className={styles.closeButton} onClick={onClose} aria-label="로그인 창 닫기">×</button><p className={styles.kicker}>WELCOME BACK</p><h2 id="auth-title">{mode === "login" ? "로그인" : "회원가입"}</h2><p>가격 추적 기록을 계정과 안전하게 연결하세요.</p><form onSubmit={submit}><label>이메일<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoFocus /></label><label>비밀번호<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className={styles.submitButton} type="submit">{mode === "login" ? "로그인" : "회원가입"}</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}<button type="button" className={styles.switchAuth} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>{mode === "login" ? "처음 오셨나요? 회원가입" : "이미 계정이 있나요? 로그인"}</button></section></div>;
}
