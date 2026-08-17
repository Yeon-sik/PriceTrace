import { z } from "zod";
import { getCashOsSupabaseBrowserClient } from "../lib/supabase/cashos-client";
import {
  getNutritionSupabaseBrowserClient,
  getNutritionSupabasePublicBrowserClient,
} from "../lib/supabase/nutrition-client";

const fitnessMenuRowSchema = z.object({
  nutrition_food_id: z.string().trim().min(1),
  brand: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  source_reference: z.string().trim().min(1).nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
}).passthrough();

const nutritionFoodRowSchema = z.object({
  id: z.string().trim().min(1),
  brand: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  source_reference: z.string().trim().min(1).nullable().optional(),
  catalog_product_id: z.string().uuid().nullable().optional(),
}).passthrough();

const nutritionFoodLinkRowSchema = z.object({
  nutrition_food_id: z.string().trim().min(1),
  catalog_product_id: z.string().uuid(),
}).passthrough();

const cashOsLedgerRowSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  merchant_or_counterparty: z.string().trim().min(1).nullable(),
  memo: z.string().trim().min(1).nullable(),
  occurred_on: z.string().date(),
  amount_krw: z.coerce.number().int().nonnegative(),
}).strict();

export type ImportedRestaurantMenuSource = "fitnessapp" | "cashos";

export type ImportedRestaurantMenu = {
  id: string;
  source: ImportedRestaurantMenuSource;
  sourceLabel: string;
  restaurantName: string;
  menuName: string;
  sourceLocationCode: string;
  sourceReference: string | null;
  sourceDescription: string;
  catalogProductId: string | null;
  observedOn: string | null;
  suggestedPriceKrw: number | null;
};

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

function nutritionEndpointLabel() {
  try {
    const url = process.env.NEXT_PUBLIC_NUTRITION_SUPABASE_URL;
    return url ? new URL(url).host : "설정되지 않음";
  } catch {
    return "설정되지 않음";
  }
}

function isNutritionReadSchemaCacheMiss(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLocaleLowerCase("en-US") ?? "";
  return error?.code === "PGRST202" || error?.code === "42501"
    || (message.includes("get_nutrition_read_v2") && message.includes("schema cache"));
}

function isNutritionTableSchemaCacheMiss(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { code?: string; message?: string } : null;
  const message = (error instanceof Error ? error.message : candidate?.message)?.toLocaleLowerCase("en-US") ?? "";
  return candidate?.code === "PGRST205"
    || (message.includes("public.nutrition_foods") && message.includes("schema cache"));
}

function sourceComponent(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 150) || "unknown";
}

function sourceLocationCode(source: ImportedRestaurantMenuSource, restaurantName: string) {
  return `${source}:restaurant:${sourceComponent(restaurantName)}`;
}

function httpSourceUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.startsWith("http://") || normalized.startsWith("https://")
    ? normalized
    : null;
}

function mapFitnessMenuRow(row: {
  nutrition_food_id: string;
  brand?: string | null;
  name: string;
  kind: string;
  source_reference?: string | null;
  catalog_product_id?: string | null;
}): ImportedRestaurantMenu | null {
  const restaurantName = row.brand?.trim();
  if (row.kind !== "external_menu" || !restaurantName) return null;
  const sourceReference = row.source_reference?.trim() || null;
  return {
    id: `fitnessapp:${row.nutrition_food_id}`,
    source: "fitnessapp",
    sourceLabel: "FitnessApp",
    restaurantName,
    menuName: row.name.trim(),
    sourceLocationCode: sourceLocationCode("fitnessapp", restaurantName),
    sourceReference: httpSourceUrl(sourceReference),
    sourceDescription: sourceReference && !httpSourceUrl(sourceReference)
      ? `FitnessApp nutrition_food_id ${row.nutrition_food_id} · ${sourceReference}`
      : `FitnessApp nutrition_food_id ${row.nutrition_food_id}`,
    catalogProductId: row.catalog_product_id ?? null,
    observedOn: null,
    suggestedPriceKrw: null,
  };
}

function mapNutritionRpcRows(data: unknown) {
  return z.array(fitnessMenuRowSchema).parse(data ?? [])
    .map(mapFitnessMenuRow)
    .filter((row): row is ImportedRestaurantMenu => row !== null);
}

async function refreshNutritionSession(
  client: NonNullable<ReturnType<typeof getNutritionSupabaseBrowserClient>>,
) {
  try {
    const { data, error } = await client.auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
  }
}

async function searchFitnessMenusFromTable(
  client: NonNullable<ReturnType<typeof getNutritionSupabaseBrowserClient>>,
  query: string,
) {
  const pattern = `%${query}%`;
  const [brandResult, nameResult] = await Promise.all([
    client.from("nutrition_foods").select("id,brand,name,kind,source_reference").is("deleted_at", null).ilike("brand", pattern).limit(200),
    client.from("nutrition_foods").select("id,brand,name,kind,source_reference").is("deleted_at", null).ilike("name", pattern).limit(200),
  ]);
  const error = brandResult.error ?? nameResult.error;
  if (error) {
    throw new Error(`${errorMessage(error, "FitnessApp 메뉴 정보를 불러오지 못했습니다.")} · 연결 대상 ${nutritionEndpointLabel()}`);
  }

  // catalog_product_id belongs to product_nutrition_links, not nutrition_foods.
  // A partially deployed Nutrition project may not expose that table yet; the
  // menu itself is still safe to import, but no exact PriceTrace ID is inferred.
  const linkResult = await client
    .from("product_nutrition_links")
    .select("nutrition_food_id,catalog_product_id")
    .eq("status", "approved")
    .is("deleted_at", null);
  const approvedCatalogProductIds = new Map<string, string>();
  if (!linkResult.error) {
    for (const row of linkResult.data ?? []) {
      const parsed = nutritionFoodLinkRowSchema.safeParse(row);
      if (parsed.success) approvedCatalogProductIds.set(parsed.data.nutrition_food_id, parsed.data.catalog_product_id);
    }
  }

  const uniqueRows = new Map<string, z.infer<typeof nutritionFoodRowSchema>>();
  for (const row of [...(brandResult.data ?? []), ...(nameResult.data ?? [])]) {
    const parsed = nutritionFoodRowSchema.parse(row);
    uniqueRows.set(parsed.id, {
      ...parsed,
      catalog_product_id: approvedCatalogProductIds.get(parsed.id) ?? null,
    });
  }
  return [...uniqueRows.values()]
    .map((row) => mapFitnessMenuRow({
      nutrition_food_id: row.id,
      brand: row.brand,
      name: row.name,
      kind: row.kind,
      source_reference: row.source_reference,
      catalog_product_id: row.catalog_product_id,
    }))
    .filter((row): row is ImportedRestaurantMenu => row !== null);
}

export class RestaurantMenuSourceRepository {
  async searchFitnessMenus(query: string): Promise<ImportedRestaurantMenu[]> {
    const client = getNutritionSupabaseBrowserClient();
    if (!client) {
      throw new Error("FitnessApp Nutrition 연결이 설정되지 않았습니다.");
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("FitnessApp에서 찾을 식당명 또는 메뉴명을 입력하세요.");
    }

    const { data, error } = await client.rpc("get_nutrition_read_v2", {
      p_query: normalizedQuery,
    });
    if (error) {
      if (isNutritionReadSchemaCacheMiss(error)) {
        if (await refreshNutritionSession(client)) {
          const retry = await client.rpc("get_nutrition_read_v2", {
            p_query: normalizedQuery,
          });
          if (!retry.error) return mapNutritionRpcRows(retry.data);
        }
        try {
          return await searchFitnessMenusFromTable(client, normalizedQuery);
        } catch (fallbackError) {
          const publicClient = getNutritionSupabasePublicBrowserClient();
          if (publicClient && isNutritionTableSchemaCacheMiss(fallbackError)) {
            return searchFitnessMenusFromTable(publicClient, normalizedQuery);
          }
          throw fallbackError;
        }
      }
      throw new Error(errorMessage(error, "FitnessApp 메뉴 정보를 불러오지 못했습니다."));
    }

    return mapNutritionRpcRows(data);
  }

  async searchCashOsMenus(query: string): Promise<ImportedRestaurantMenu[]> {
    const client = getCashOsSupabaseBrowserClient();
    if (!client) {
      throw new Error("CashOS 연결이 설정되지 않았습니다.");
    }

    const { data, error } = await client
      .from("finance_ledger_entries")
      .select("id,title,merchant_or_counterparty,memo,occurred_on,amount_krw")
      .eq("entry_type", "EXPENSE")
      .is("deleted_at", null)
      .order("occurred_on", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(errorMessage(error, "CashOS 지출 정보를 불러오지 못했습니다."));
    }

    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return z.array(cashOsLedgerRowSchema).parse(data ?? [])
      .filter((row) => Boolean(row.merchant_or_counterparty?.trim()))
      .filter((row) => {
        if (!normalizedQuery) return true;
        return [row.merchant_or_counterparty, row.title, row.memo]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
      })
      .map((row) => {
        const restaurantName = row.merchant_or_counterparty!.trim();
        const menuName = row.memo?.trim() || row.title.trim();
        return {
          id: `cashos:${row.id}`,
          source: "cashos" as const,
          sourceLabel: "CashOS",
          restaurantName,
          menuName,
          sourceLocationCode: sourceLocationCode("cashos", restaurantName),
          sourceReference: null,
          sourceDescription: `CashOS ledger ${row.id} · ${row.title}`,
          catalogProductId: null,
          observedOn: row.occurred_on,
          suggestedPriceKrw: row.amount_krw,
        };
      });
  }
}
