"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function useAdminAccess(authRevision: number) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    if (!client) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    void client.auth.getUser().then(({ data }) => {
      if (!active) return;
      setIsAdmin(data.user?.app_metadata?.role === "admin");
      setLoading(false);
    });
    return () => { active = false; };
  }, [authRevision]);

  return { isAdmin, loading };
}
