import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cashOsBrowserClient: SupabaseClient | undefined;

/**
 * Optional CashOS read client used only by the admin direct-link picker.
 *
 * The client intentionally accepts only a publishable/anon key. CashOS rows
 * remain protected by CashOS RLS and are never copied into PriceTrace until
 * the administrator submits a direct-link registration.
 */
export function getCashOsSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_CASHOS_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_CASHOS_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_CASHOS_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cashOsBrowserClient ??= createBrowserClient(url, key);
  return cashOsBrowserClient;
}
