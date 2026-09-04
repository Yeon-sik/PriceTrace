"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { PrivateIdentityRepository } from "../../repositories/private-identity.repository";
import type { PrivateIdentityRead, PrivateIdentitySelector } from "../../domain/private-identity-read";

export function usePrivateIdentityDetail(selector: PrivateIdentitySelector | null) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new PrivateIdentityRepository(client) : null,
    [client],
  );
  const [data, setData] = useState<PrivateIdentityRead | null>(null);
  const [loading, setLoading] = useState(Boolean(repository && selector));
  const [error, setError] = useState("");
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    if (!client) return;
    const { data: authListener } = client.auth.onAuthStateChange(() => {
      setAuthRevision((revision) => revision + 1);
    });
    return () => authListener.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    let active = true;
    if (!repository || !selector) {
      setData(null);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }

    setLoading(true);
    setError("");
    void repository.read(selector).then((nextData) => {
      if (active) setData(nextData);
    }).catch((reason: unknown) => {
      if (!active) return;
      setData(null);
      setError(reason instanceof Error ? reason.message : "private identity 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [authRevision, repository, selector]);

  return { configured: repository !== null, data, loading, error };
}
