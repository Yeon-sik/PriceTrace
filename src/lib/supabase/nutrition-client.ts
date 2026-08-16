import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let nutritionBrowserClient: SupabaseClient | undefined;
let nutritionPublicBrowserClient: SupabaseClient | undefined;

/**
 * Public Nutrition database client.
 *
 * This boundary accepts only a browser-safe publishable key. A service-role
 * credential must never be added to this client or to NEXT_PUBLIC_* variables.
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
