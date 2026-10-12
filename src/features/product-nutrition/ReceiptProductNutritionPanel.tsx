"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { NutritionFood } from "../../domain/product-nutrition-link";
import { getNutritionSupabaseBrowserClient } from "../../lib/supabase/nutrition-client";
import { NutritionCatalogRepository } from "../../repositories/nutrition-catalog.repository";
import { NutritionSummary } from "./ProductNutritionPanel";
import styles from "../../app/page.module.css";

export function ReceiptProductNutritionPanel({ storeProductId }: { storeProductId: string }) {
  const client = getNutritionSupabaseBrowserClient();
  const [foods, setFoods] = useState<NutritionFood[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    let active = true;
    setFoods([]); setLoading(true); setError(""); setSignedIn(false);
    if (!client) { setLoading(false); return; }
    void (async () => {
      const { data, error: authError } = await client.auth.getUser();
      if (!active) return;
      if (!data.user) { setLoading(false); return; }
      if (authError) throw authError;
      setSignedIn(true);
      const rows = await new NutritionCatalogRepository(client).readVerifiedReceiptProductFoods(storeProductId);
      if (active) { setFoods(rows); setLoading(false); }
    })().catch(() => { if (active) { setError("구매 상품의 영양 정보를 불러오지 못했습니다."); setLoading(false); } });
    return () => { active = false; };
  }, [client, storeProductId, revision]);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange(() => setRevision((current) => current + 1));
    return () => data.subscription.unsubscribe();
  }, [client]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!client || signingIn) return;
    setSigningIn(true); setError("");
    try {
      const { error: failure } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (failure) throw failure;
      setPassword("");
    } catch { setError("Fitness 로그인에 실패했습니다. 계정 정보를 확인해 주세요."); }
    finally { setSigningIn(false); }
  }
  return <section className={styles.productNutritionSection} aria-labelledby="receipt-product-nutrition-title">
    <h3 id="receipt-product-nutrition-title">Fitness 영양 정보</h3>
    <p>OCR에서 검수한 이 구매 상품의 영양 기록입니다. 표준상품 연결은 별도로 할 수 있습니다.</p>
    {loading && <p role="status">영양 정보를 불러오는 중입니다.</p>}
    {!client && <p>Fitness 연결 설정이 필요합니다.</p>}
    {client && !loading && !signedIn && <form className={styles.nutritionSearch} onSubmit={signIn}>
      <p>내 영양 기록을 보려면 OCR에서 사용한 Fitness 계정으로 로그인해 주세요.</p>
      <label>이메일<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>비밀번호<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={signingIn}>{signingIn ? "로그인 중" : "Fitness 로그인"}</button>
    </form>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision((current) => current + 1)}>다시 확인</button></p>}
    {signedIn && !loading && !error && foods.length === 0 && <p>이 구매 상품에 연결된 내 영양 기록이 없습니다.</p>}
    <div className={styles.nutritionLinks}>{foods.map((food) => <article key={food.id}><div>
      <strong>{food.name}</strong><NutritionSummary food={food} />
      <small>OCR 검수 완료 · 구매 상품 연결 완료</small>
    </div></article>)}</div>
  </section>;
}
