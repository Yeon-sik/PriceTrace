"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Props = { onChange: () => void; onOpen?: () => void; modal?: boolean; onClose?: () => void };
export function AuthPanel({ onChange, onOpen, modal = false, onClose }: Props) {
  const client = getSupabaseBrowserClient(); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [userEmail, setUserEmail] = useState<string | null>(null); const [mode, setMode] = useState<"login" | "signup">("login"); const [message, setMessage] = useState("");
  useEffect(() => { if (!client) return; void client.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); const { data } = client.auth.onAuthStateChange((_event, session) => { setUserEmail(session?.user?.email ?? null); onChange(); }); return () => data.subscription.unsubscribe(); }, [client, onChange]);
  if (!modal && userEmail) return <div className={styles.userMenu}><span>{userEmail}</span><button onClick={() => void client?.auth.signOut()}>로그아웃</button></div>;
  if (!modal) return <button className={styles.loginButton} onClick={onOpen}>로그인 <span>↗</span></button>;
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!client) { setMessage("로그인 서비스를 준비 중입니다."); return; } const result = mode === "login" ? await client.auth.signInWithPassword({ email, password }) : await client.auth.signUp({ email, password }); if (result.error) setMessage(result.error.message); else { setMessage(mode === "login" ? "로그인되었습니다." : "회원가입 요청이 완료되었습니다."); setPassword(""); if (mode === "login") onClose?.(); } }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}><div className={styles.authModal} role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className={styles.closeButton} onClick={onClose} aria-label="로그인 창 닫기">×</button><p className={styles.kicker}>WELCOME BACK</p><h2 id="auth-title">{mode === "login" ? "로그인" : "회원가입"}</h2><p>가격 추적기를 더 편리하게 이용하세요.</p><form onSubmit={submit}><label>이메일<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>비밀번호<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className={styles.submitButton} type="submit">{mode === "login" ? "로그인" : "회원가입"}</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}<button className={styles.switchAuth} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); }}>{mode === "login" ? "처음 오셨나요? 회원가입" : "이미 계정이 있나요? 로그인"}</button></div></div>;
}
