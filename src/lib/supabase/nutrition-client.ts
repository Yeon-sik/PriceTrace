import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let nutritionBrowserClient: SupabaseClient | undefined;

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
