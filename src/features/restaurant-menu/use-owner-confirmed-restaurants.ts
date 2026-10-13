"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { OwnerConfirmedRestaurantRepository } from "../../repositories/owner-confirmed-restaurant.repository";
import type { OwnerConfirmedRestaurantRead } from "../../domain/owner-confirmed-restaurant";

type State = {
  status: "loading" | "signed_out" | "ready" | "error";
  read: OwnerConfirmedRestaurantRead | null; error: string | null;
};
const empty: State = { status: "loading", read: null, error: null };

export function useOwnerConfirmedRestaurants() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const repository = useMemo(() => client ? new OwnerConfirmedRestaurantRepository(client) : null, [client]);
  const [state, setState] = useState<State>(empty);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!client || !repository) {
      setState({ status: "signed_out", read: null, error: null });
      return;
    }
    let active = true;
    let generation = 0;
    async function load() {
      const current = ++generation;
      setState(empty);
      try {
        const read = await repository!.load();
        if (active && generation === current) setState({ status: read ? "ready" : "signed_out", read, error: null });
      } catch (reason) {
        if (active && generation === current) setState({ status: "error", read: null,
          error: reason instanceof Error ? reason.message : "내 확인 식당을 불러오지 못했습니다." });
      }
    }
    void load();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      ++generation;
      // Clear private data immediately on logout/account change, including in-flight responses.
      setState({ status: session ? "loading" : "signed_out", read: null, error: null });
      if (session) setTimeout(() => { if (active) void load(); }, 0);
    });
    return () => { active = false; ++generation; data.subscription.unsubscribe(); };
  }, [client, repository, revision]);
  return { ...state, refresh: () => setRevision(value => value + 1) };
}
