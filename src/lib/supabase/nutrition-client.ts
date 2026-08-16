import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let nutritionBrowserClient: SupabaseClient | undefined;
let nutritionPublicBrowserClient: SupabaseClient | undefined;

/**
 * Session-capable Nutrition database client for administrator workflows.
 *
 * The publishable key is safe for browser use; private rows remain protected
 * by Nutrition RLS and require the user's Nutrition Supabase session.
 */
export function getNutritionSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_NUTRITION_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_NUTRITION_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  nutritionBrowserClient ??= createBrowserClient(url, key);
  return nutritionBrowserClient;
}

/**
 * Anonymous client for PriceTrace's read-only public nutrition projection.
 *
 * It intentionally ignores any cached Fitness Nutrition session. Public product
 * pages must not change behavior based on a secondary project's login state.
 */
export function getNutritionSupabasePublicBrowserClient() {
  const url = process.env.NEXT_PUBLIC_NUTRITION_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_NUTRITION_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  nutritionPublicBrowserClient ??= createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return nutritionPublicBrowserClient;
}
