"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getNutritionSupabaseBrowserClient } from "@/lib/supabase/nutrition-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Props = {
  onConnectionChange: (connected: boolean) => void;
};

export function AdminFitnessNutritionAuthPanel({ onConnectionChange }: Props) {
  const adminClient = getSupabaseBrowserClient();
  const nutritionClient = getNutritionSupabaseBrowserClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [nutritionEmail, setNutritionEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!adminClient) {
      setIsAdmin(false);
      return;
    }

    let active = true;
    void adminClient.auth.getUser().then(({ data }) => {
      if (active) setIsAdmin(data.user?.app_metadata?.role === "admin");
    });
    const { data } = adminClient.auth.onAuthStateChange((event, session) => {
      if (active) setIsAdmin(session?.user?.app_metadata?.role === "admin");
      if (event === "SIGNED_OUT" && nutritionClient) {
        void nutritionClient.auth.signOut();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [adminClient, nutritionClient]);

  useEffect(() => {
    if (!isAdmin || !nutritionClient) {
      setNutritionEmail(null);
      onConnectionChange(false);
      return;
    }

    let active = true;
    void nutritionClient.auth.getUser().then(({ data }) => {
      if (!active) return;
      const nextEmail = data.user?.email ?? null;
      setNutritionEmail(nextEmail);
      onConnectionChange(Boolean(nextEmail));
    });
    const { data } = nutritionClient.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextEmail = session?.user?.email ?? null;
      setNutritionEmail(nextEmail);
      onConnectionChange(Boolean(nextEmail));
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [isAdmin, nutritionClient, onConnectionChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nutritionClient || !isAdmin) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { data, error: signInError } = await nutritionClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      setPassword("");
      setNutritionEmail(data.user?.email ?? email.trim());
      onConnectionChange(Boolean(data.session));
      setMessage("FitnessApp 영양 DB에 연결했습니다. 비공개 식당·메뉴를 조회할 수 있습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FitnessApp 영양 DB 로그인에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (!nutritionClient || !isAdmin) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: signOutError } = await nutritionClient.auth.signOut();
      if (signOutError) throw signOutError;
      setNutritionEmail(null);
      onConnectionChange(false);
      setMessage("FitnessApp 영양 DB 연결을 해제했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FitnessApp 영양 DB 연결 해제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) return null;

  return <section className={styles.restaurantSourcePicker} aria-labelledby="fitness-nutrition-auth-title">
    <div className={styles.restaurantSourceConnectionHead}>
      <strong id="fitness-nutrition-auth-title">FitnessApp 영양 DB 연결</strong>
      <span>관리자에게만 표시됩니다. FitnessApp 설정의 ‘영양 DB 계정’과 같은 이메일·비밀번호를 사용하세요. PriceTrace 관리자 로그인과는 별도 계정입니다.</span>
    </div>
    {nutritionClient && nutritionEmail ? <div className={styles.restaurantSourceConnectionStatus}>
      <span><strong>연결됨</strong><span>{nutritionEmail}</span></span>
      <button type="button" onClick={() => void signOut()} disabled={saving}>FitnessApp 연결 해제</button>
    </div> : nutritionClient ? <form className={styles.restaurantSourceSearch} onSubmit={submit}>
      <label>FitnessApp 영양 DB 이메일
        <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>비밀번호
        <input required type="password" autoComplete="current-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit" disabled={saving}>{saving ? "연결 중…" : "FitnessApp 연결"}</button>
    </form> : <p className={styles.error} role="alert">FitnessApp Nutrition URL·publishable key 설정이 필요합니다.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}
  </section>;
}
