import { afterEach, expect, test, vi } from "vitest";

// Exercise the real SSR singleton in a Node runner with the browser default enabled.
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createBrowserClient: (url: string, key: string, options?: { isSingleton?: boolean }) =>
      actual.createBrowserClient(url, key, {
        isSingleton: options?.isSingleton ?? true,
        cookies: { getAll: () => [], setAll: () => undefined },
      }),
  };
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

test("PT and Fitness use independent clients and send RPCs to their own projects", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pt-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pt-publishable-test-key");
  vi.stubEnv("NEXT_PUBLIC_NUTRITION_SUPABASE_URL", "https://fitness-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_NUTRITION_SUPABASE_PUBLISHABLE_KEY", "fitness-publishable-test-key");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("[]", { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const { getSupabaseBrowserClient } = await import("./client");
  const { getNutritionSupabaseBrowserClient } = await import("./nutrition-client");
  const pt = getSupabaseBrowserClient()!;
  const fitness = getNutritionSupabaseBrowserClient()!;
  expect(fitness).not.toBe(pt);
  expect(getNutritionSupabaseBrowserClient()).toBe(fitness);
  await pt.rpc("read_pt");
  await fitness.rpc("read_fitness");
  expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
    "https://pt-project.supabase.co/rest/v1/rpc/read_pt",
    "https://fitness-project.supabase.co/rest/v1/rpc/read_fitness",
  ]);
});
