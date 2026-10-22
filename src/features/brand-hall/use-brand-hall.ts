"use client";

import { useEffect, useMemo, useState } from "react";
import { brandAncestry, groupBrandHierarchy, type BrandMatch } from "@/domain/brand-hierarchy";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PublicBrandRepository, type BrandProduct } from "@/repositories/public-brand.repository";

export function useBrandHall(query: string, selectedBrandId: string | null) {
  const [brands, setBrands] = useState<BrandMatch[]>([]);
  const [matches, setMatches] = useState<BrandMatch[]>([]);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [revision, setRevision] = useState(0);
  const repository = useMemo(() => {
    const client = getSupabaseBrowserClient();
    return client ? new PublicBrandRepository(client) : null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    if (!repository) {
      setError("브랜드 서비스 연결이 설정되지 않았습니다."); setLoading(false);
      return () => controller.abort();
    }
    void Promise.all([repository.search("", controller.signal), repository.loadProducts(controller.signal)])
      .then(([nextBrands, nextProducts]) => {
        if (controller.signal.aborted) return;
        setBrands(nextBrands); setProducts(nextProducts);
      }).catch(() => {
        if (!controller.signal.aborted) setError("브랜드관을 불러오지 못했습니다. 다시 시도하세요.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repository, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setSearchError(""); setMatches([]);
    if (!query.trim() || !repository) { setSearching(false); return () => controller.abort(); }
    setSearching(true);
    const timer = setTimeout(() => {
      void repository.search(query.trim(), controller.signal).then((next) => {
        if (!controller.signal.aborted) setMatches(next);
      }).catch(() => {
        if (!controller.signal.aborted) setSearchError("검색 결과를 불러오지 못했습니다.");
      }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [repository, query, revision]);

  const hierarchy = useMemo(() => groupBrandHierarchy(brands), [brands]);
  const selected = selectedBrandId ? hierarchy.byId.get(selectedBrandId) : null;
  const ancestry = useMemo(() => selected ? brandAncestry(brands, selected.id) : null, [brands, selected]);
  const children = selected ? hierarchy.children.get(selected.id) ?? [] : [];
  const directProducts = useMemo(() => selected ? products.filter((product) => product.brandId === selected.id) : [], [products, selected]);
  return { brands, products, matches, hierarchy, loading, searching, error, searchError,
    selected, ancestry, children, directProducts,
    retry: () => setRevision((value) => value + 1) };
}
