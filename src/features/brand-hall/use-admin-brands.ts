"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminBrandRepository, type AdminBrand } from "@/repositories/admin-brand.repository";

export function useAdminBrands() {
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const repository = useMemo(() => {
    const client = getSupabaseBrowserClient();
    return client ? new AdminBrandRepository(client) : null;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    if (!repository) { setError("브랜드 서비스 연결이 설정되지 않았습니다."); setLoading(false); return; }
    void repository.load(controller.signal).then((rows) => {
      if (!controller.signal.aborted) setBrands(rows);
    }).catch(() => {
      if (!controller.signal.aborted) setError("브랜드 목록을 불러오지 못했습니다. 다시 시도하세요.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repository, revision]);
  return { brands, repository, loading, error, reload: () => setRevision((value) => value + 1) };
}
