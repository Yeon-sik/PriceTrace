import { z } from "zod";

export const RESTAURANT_MENU_READ_SCHEMA_VERSION = "restaurant-menu-read.v1" as const;
export const RESTAURANT_DIRECTORY_SCHEMA_VERSION = "restaurant-directory.v2" as const;
export const RESTAURANT_DIRECTORY_LEGACY_SCHEMA_VERSION = "restaurant-directory.v1" as const;
export const RESTAURANT_DETAIL_SCHEMA_VERSION = "restaurant-detail.v2" as const;
export const RESTAURANT_DETAIL_LEGACY_SCHEMA_VERSION = "restaurant-detail.v1" as const;
export const RESTAURANT_MENU_READ_NAMESPACE = "pricetrace" as const;

const sha256RevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const offsetDateTimeSchema = z.string().datetime({ offset: true });
const nullableTrimmedStringSchema = z.string().trim().min(1).nullable();
const httpUrlSchema = z.string().trim().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "출처 URL은 http 또는 https 주소여야 합니다.",
);
const nullableUrlSchema = httpUrlSchema.nullable();

export const RestaurantMenuReceiptReferenceSchema = z.object({
  receiptId: z.string().trim().min(1),
  receiptItemId: z.string().trim().min(1),
  receiptRevision: z.string().trim().min(1),
}).strict();

export const RestaurantMenuPriceObservationSchema = z.object({
  id: z.string().uuid(),
  restaurantSourceId: z.string().uuid(),
  locationLabel: nullableTrimmedStringSchema,
  unitPriceKrw: z.coerce.number().int().nonnegative(),
  quantity: z.coerce.number().int().positive(),
  totalPriceKrw: z.coerce.number().int().nonnegative(),
  observedAt: offsetDateTimeSchema,
  sourceType: z.enum(["receipt", "database_receipt", "official_menu", "manual_review"]),
  receiptReference: RestaurantMenuReceiptReferenceSchema.nullable(),
  sourceUrl: nullableUrlSchema,
  verifiedAt: offsetDateTimeSchema,
}).strict().superRefine((observation, context) => {
  if (observation.sourceType === "receipt" && observation.receiptReference === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptReference"],
      message: "영수증 관측에는 정확한 영수증 참조가 필요합니다.",
    });
  }
  if (observation.totalPriceKrw !== observation.unitPriceKrw * observation.quantity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalPriceKrw"],
      message: "메뉴 관측 금액이 단가와 수량의 보존식을 만족하지 않습니다.",
    });
  }
});

export const RestaurantMenuSchema = z.object({
  id: z.string().uuid(),
  catalogProductId: z.string().uuid(),
  standardProductId: z.string().uuid(),
  name: z.string().trim().min(1),
  categoryLabel: nullableTrimmedStringSchema,
  servingLabel: z.string().trim().min(1),
  officialUrl: nullableUrlSchema,
  updatedAt: offsetDateTimeSchema,
  observations: z.array(RestaurantMenuPriceObservationSchema),
  revision: sha256RevisionSchema,
}).strict().superRefine((menu, context) => {
  const observationIds = new Set<string>();
  for (const [index, observation] of menu.observations.entries()) {
    if (observationIds.has(observation.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations", index, "id"],
        message: "메뉴 가격 관측 ID가 중복되었습니다.",
      });
    }
    observationIds.add(observation.id);
  }
});

export const RestaurantMenuOptionLinkSchema = z.object({
  id: z.string().uuid(),
  parentMenuId: z.string().uuid(),
  optionMenuId: z.string().uuid(),
  source: z.enum(["automatic", "manual"]),
  confidence: z.coerce.number().min(0).max(1),
}).strict();

export const RestaurantLocationSchema = z.object({
  id: z.string().uuid(),
  sourceLabel: z.string().trim().min(1),
  sourceRestaurantCode: z.string().trim().min(1),
  locationLabel: nullableTrimmedStringSchema,
  sourceUrl: nullableUrlSchema,
}).strict();

export const RestaurantCategoryPathNodeSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
}).strict();

export const RestaurantCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  path: z.array(RestaurantCategoryPathNodeSchema).min(1).max(3),
}).strict().superRefine((category, context) => {
  const leaf = category.path.at(-1);
  if (!leaf || leaf.id !== category.id || leaf.slug !== category.slug || leaf.name !== category.name) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["path"],
      message: "음식점 카테고리 경로의 마지막 노드는 선택된 카테고리여야 합니다.",
    });
  }
  if (new Set(category.path.map((node) => node.id)).size !== category.path.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["path"],
      message: "음식점 카테고리 경로에 순환 또는 중복 노드가 있습니다.",
    });
  }
});

export const RestaurantProfileSchema = z.object({
  id: z.string().uuid(),
  brandId: z.string().uuid().nullable(),
  brand: z.string().trim().min(1),
  legalName: nullableTrimmedStringSchema,
  cuisineType: nullableTrimmedStringSchema,
  category: RestaurantCategorySchema.nullable().optional().default(null),
  officialSiteUrl: nullableUrlSchema,
  updatedAt: offsetDateTimeSchema,
}).strict();

export const RestaurantMenuReadEntrySchema = z.object({
  restaurant: RestaurantProfileSchema,
  locations: z.array(RestaurantLocationSchema).min(1),
  menus: z.array(RestaurantMenuSchema).min(1),
  revision: sha256RevisionSchema,
}).strict().superRefine((entry, context) => {
  const locationIds = new Set<string>();
  const sourceIdentities = new Set<string>();
  for (const [index, location] of entry.locations.entries()) {
    if (locationIds.has(location.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locations", index, "id"],
        message: "음식점 지점 ID가 중복되었습니다.",
      });
    }
    locationIds.add(location.id);

    const sourceIdentity = `${location.sourceLabel}\u0000${location.sourceRestaurantCode}`;
    if (sourceIdentities.has(sourceIdentity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locations", index],
        message: "음식점 source identity가 중복되었습니다.",
      });
    }
    sourceIdentities.add(sourceIdentity);
  }

  const menuIds = new Set<string>();
  const catalogProductIds = new Set<string>();
  for (const [menuIndex, menu] of entry.menus.entries()) {
    if (menuIds.has(menu.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["menus", menuIndex, "id"],
        message: "음식점 메뉴 ID가 중복되었습니다.",
      });
    }
    menuIds.add(menu.id);

    if (catalogProductIds.has(menu.catalogProductId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["menus", menuIndex, "catalogProductId"],
        message: "정확한 메뉴 catalog_product_id가 중복되었습니다.",
      });
    }
    catalogProductIds.add(menu.catalogProductId);

    for (const [observationIndex, observation] of menu.observations.entries()) {
      if (!locationIds.has(observation.restaurantSourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["menus", menuIndex, "observations", observationIndex, "restaurantSourceId"],
          message: "메뉴 가격 관측이 이 음식점의 검증된 지점에 속하지 않습니다.",
        });
      }
    }
  }
});

export const RestaurantMenuReadV1Schema = z.object({
  schemaVersion: z.literal(RESTAURANT_MENU_READ_SCHEMA_VERSION),
  namespace: z.literal(RESTAURANT_MENU_READ_NAMESPACE),
  revision: sha256RevisionSchema,
  restaurants: z.array(RestaurantMenuReadEntrySchema),
}).strict().superRefine((payload, context) => {
  const restaurantIds = new Set<string>();
  const menuIds = new Set<string>();
  const catalogProductIds = new Set<string>();
  const observationIds = new Set<string>();

  for (const [restaurantIndex, entry] of payload.restaurants.entries()) {
    if (restaurantIds.has(entry.restaurant.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["restaurants", restaurantIndex, "restaurant", "id"],
        message: "음식점 ID가 중복되었습니다.",
      });
    }
    restaurantIds.add(entry.restaurant.id);

    for (const [menuIndex, menu] of entry.menus.entries()) {
      if (menuIds.has(menu.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["restaurants", restaurantIndex, "menus", menuIndex, "id"],
          message: "전체 음식점 목록에서 메뉴 ID가 중복되었습니다.",
        });
      }
      menuIds.add(menu.id);

      if (catalogProductIds.has(menu.catalogProductId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["restaurants", restaurantIndex, "menus", menuIndex, "catalogProductId"],
          message: "전체 음식점 목록에서 catalog_product_id가 중복되었습니다.",
        });
      }
      catalogProductIds.add(menu.catalogProductId);

      for (const [observationIndex, observation] of menu.observations.entries()) {
        if (observationIds.has(observation.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["restaurants", restaurantIndex, "menus", menuIndex, "observations", observationIndex, "id"],
            message: "전체 음식점 목록에서 가격 관측 ID가 중복되었습니다.",
          });
        }
        observationIds.add(observation.id);
      }
    }
  }
});

export const RestaurantDirectoryEntrySchema = z.object({
  restaurant: RestaurantProfileSchema,
  locations: z.array(RestaurantLocationSchema),
  menuCount: z.number().int().nonnegative(),
  latestObservedAt: offsetDateTimeSchema.nullable(),
  revision: sha256RevisionSchema,
}).strict();

export const RestaurantDirectoryV1Schema = z.object({
  schemaVersion: z.union([
    z.literal(RESTAURANT_DIRECTORY_LEGACY_SCHEMA_VERSION),
    z.literal(RESTAURANT_DIRECTORY_SCHEMA_VERSION),
  ]),
  namespace: z.literal(RESTAURANT_MENU_READ_NAMESPACE),
  revision: sha256RevisionSchema,
  restaurants: z.array(RestaurantDirectoryEntrySchema),
}).strict().superRefine((payload, context) => {
  const restaurantIds = new Set<string>();
  for (const [index, entry] of payload.restaurants.entries()) {
    if (restaurantIds.has(entry.restaurant.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["restaurants", index, "restaurant", "id"],
        message: "음식점 디렉터리에서 ID가 중복되었습니다.",
      });
    }
    restaurantIds.add(entry.restaurant.id);
  }
});

export const RestaurantDetailV1Schema = z.object({
  schemaVersion: z.union([
    z.literal(RESTAURANT_DETAIL_LEGACY_SCHEMA_VERSION),
    z.literal(RESTAURANT_DETAIL_SCHEMA_VERSION),
  ]),
  namespace: z.literal(RESTAURANT_MENU_READ_NAMESPACE),
  revision: sha256RevisionSchema,
  restaurant: RestaurantProfileSchema,
  locations: z.array(RestaurantLocationSchema),
  menus: z.array(RestaurantMenuSchema),
  optionLinks: z.array(RestaurantMenuOptionLinkSchema).default([]),
}).strict().superRefine((detail, context) => {
  const locationIds = new Set<string>();
  const sourceIdentities = new Set<string>();
  for (const [index, location] of detail.locations.entries()) {
    if (locationIds.has(location.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locations", index, "id"],
        message: "음식점 상세 지점 ID가 중복되었습니다.",
      });
    }
    locationIds.add(location.id);
    const sourceIdentity = `${location.sourceLabel}\u0000${location.sourceRestaurantCode}`;
    if (sourceIdentities.has(sourceIdentity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locations", index],
        message: "음식점 상세 source identity가 중복되었습니다.",
      });
    }
    sourceIdentities.add(sourceIdentity);
  }

  const menuIds = new Set<string>();
  const catalogProductIds = new Set<string>();
  for (const [index, menu] of detail.menus.entries()) {
    if (menuIds.has(menu.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["menus", index, "id"],
        message: "음식점 상세 메뉴 ID가 중복되었습니다.",
      });
    }
    menuIds.add(menu.id);
    if (catalogProductIds.has(menu.catalogProductId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["menus", index, "catalogProductId"],
        message: "음식점 상세 catalog_product_id가 중복되었습니다.",
      });
    }
    catalogProductIds.add(menu.catalogProductId);
    for (const [observationIndex, observation] of menu.observations.entries()) {
      if (!locationIds.has(observation.restaurantSourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["menus", index, "observations", observationIndex, "restaurantSourceId"],
          message: "음식점 상세 가격 관측이 이 음식점의 지점에 속하지 않습니다.",
        });
      }
    }
  }

  const optionLinkIds = new Set<string>();
  const linkedOptionMenuIds = new Set<string>();
  for (const [index, link] of detail.optionLinks.entries()) {
    if (optionLinkIds.has(link.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionLinks", index, "id"],
        message: "메뉴 옵션 연결 ID가 중복되었습니다.",
      });
    }
    optionLinkIds.add(link.id);

    if (link.parentMenuId === link.optionMenuId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionLinks", index],
        message: "메뉴는 자기 자신을 옵션 부모로 연결할 수 없습니다.",
      });
    }
    if (!menuIds.has(link.parentMenuId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionLinks", index, "parentMenuId"],
        message: "옵션 연결의 부모 메뉴가 이 상세 응답에 없습니다.",
      });
    }
    if (!menuIds.has(link.optionMenuId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionLinks", index, "optionMenuId"],
        message: "옵션 연결의 옵션 메뉴가 이 상세 응답에 없습니다.",
      });
    }
    if (linkedOptionMenuIds.has(link.optionMenuId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionLinks", index, "optionMenuId"],
        message: "한 음식점의 옵션 메뉴에는 부모 연결이 하나만 있어야 합니다.",
      });
    }
    linkedOptionMenuIds.add(link.optionMenuId);
  }
});

export type RestaurantMenuPriceObservation = z.infer<typeof RestaurantMenuPriceObservationSchema>;
export type RestaurantMenu = z.infer<typeof RestaurantMenuSchema>;
export type RestaurantMenuOptionLink = z.infer<typeof RestaurantMenuOptionLinkSchema>;
export type RestaurantLocation = z.infer<typeof RestaurantLocationSchema>;
export type RestaurantCategory = z.infer<typeof RestaurantCategorySchema>;
export type RestaurantMenuReadEntry = z.infer<typeof RestaurantMenuReadEntrySchema>;
export type RestaurantMenuReadV1 = z.infer<typeof RestaurantMenuReadV1Schema>;
export type RestaurantDirectoryEntry = z.infer<typeof RestaurantDirectoryEntrySchema>;
export type RestaurantDirectoryV1 = z.infer<typeof RestaurantDirectoryV1Schema>;
export type RestaurantDetailV1 = z.infer<typeof RestaurantDetailV1Schema>;

export const RestaurantCategoryNodeRowSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  slug: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  depth: z.number().int().min(0).max(2),
  sort_order: z.number().int(),
}).strict();

export type RestaurantCategoryNodeRow = z.infer<typeof RestaurantCategoryNodeRowSchema>;

export const RestaurantCategoryAssignmentRpcRowSchema = z.object({
  restaurant_id: z.string().uuid(),
  category_id: z.string().uuid().nullable(),
  category_slug: z.string().trim().min(1).nullable(),
  category_display_name: z.string().trim().min(1).nullable(),
}).strict().superRefine((row, context) => {
  const categoryValues = [row.category_id, row.category_slug, row.category_display_name];
  const populatedCount = categoryValues.filter((value) => value !== null).length;
  if (populatedCount !== 0 && populatedCount !== categoryValues.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category_id"],
      message: "음식점 카테고리 연결 결과는 모두 존재하거나 모두 null이어야 합니다.",
    });
  }
});

export type RestaurantCategoryAssignmentResult = z.infer<typeof RestaurantCategoryAssignmentRpcRowSchema>;

export const RestaurantMenuOptionLinkRpcRowSchema = z.object({
  id: z.string().uuid(),
  restaurant_id: z.string().uuid(),
  parent_menu_id: z.string().uuid(),
  option_menu_id: z.string().uuid(),
  link_source: z.enum(["automatic", "manual"]),
  confidence: z.coerce.number().min(0).max(1),
}).strict();

export function restaurantMenuOptionLinkFromRpc(input: unknown): RestaurantMenuOptionLink {
  const row = RestaurantMenuOptionLinkRpcRowSchema.parse(input);
  return {
    id: row.id,
    parentMenuId: row.parent_menu_id,
    optionMenuId: row.option_menu_id,
    source: row.link_source,
    confidence: row.confidence,
  };
}

const optionalTextInputSchema = z.string().trim().max(500).nullable();
const optionalUrlInputSchema = httpUrlSchema.nullable();

export const RestaurantMenuRegistrationRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  priceObservationId: z.string().uuid(),
  restaurantId: z.string().uuid().nullable(),
  restaurantName: z.string().trim().min(1).max(200),
  restaurantLegalName: optionalTextInputSchema,
  cuisineType: optionalTextInputSchema,
  restaurantOfficialSiteUrl: optionalUrlInputSchema,
  restaurantSourceNamespace: z.literal("pricetrace-db-store"),
  restaurantSourceCode: z.string().uuid(),
  locationLabel: optionalTextInputSchema,
  locationOfficialUrl: optionalUrlInputSchema,
  restaurantMenuId: z.string().uuid().nullable(),
  menuName: z.string().trim().min(1).max(300),
  menuCategoryLabel: optionalTextInputSchema,
  servingLabel: z.string().trim().min(1).max(100),
  menuOfficialUrl: optionalUrlInputSchema,
}).strict();

export type RestaurantMenuRegistrationRequest = z.infer<typeof RestaurantMenuRegistrationRequestSchema>;

export const RestaurantMenuRegistrationRpcRowSchema = z.object({
  restaurant_id: z.string().uuid(),
  restaurant_location_id: z.string().uuid(),
  restaurant_menu_id: z.string().uuid(),
  catalog_product_id: z.string().uuid(),
  receipt_observation_id: z.string().uuid(),
  replayed: z.boolean(),
}).strict();

export type RestaurantMenuRegistrationResult = {
  restaurantId: string;
  restaurantLocationId: string;
  restaurantMenuId: string;
  catalogProductId: string;
  receiptObservationId: string;
  replayed: boolean;
};

export const RestaurantMenuReceiptCandidateSchema = z.object({
  price_observation_id: z.string().uuid(),
  store_id: z.string().uuid(),
  store_name: z.string().trim().min(1),
  location_label: nullableTrimmedStringSchema,
  store_product_id: z.string().uuid(),
  store_product_code: z.string().trim().min(1).nullable(),
  product_name: z.string().trim().min(1),
  receipt_id: z.string().uuid(),
  receipt_item_id: z.string().trim().min(1),
  observed_on: z.string().date(),
  unit_price_krw: z.coerce.number().int().nonnegative(),
  quantity: z.coerce.number().int().positive(),
  total_price_krw: z.coerce.number().int().nonnegative(),
}).strict().superRefine((candidate, context) => {
  if (candidate.total_price_krw !== candidate.unit_price_krw * candidate.quantity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["total_price_krw"],
      message: "영수증 가격 보존식이 일치하지 않습니다.",
    });
  }
});

export type RestaurantMenuReceiptCandidate = z.infer<typeof RestaurantMenuReceiptCandidateSchema>;

export function restaurantMenuRegistrationResultFromRpc(input: unknown): RestaurantMenuRegistrationResult {
  const row = RestaurantMenuRegistrationRpcRowSchema.parse(input);
  return {
    restaurantId: row.restaurant_id,
    restaurantLocationId: row.restaurant_location_id,
    restaurantMenuId: row.restaurant_menu_id,
    catalogProductId: row.catalog_product_id,
    receiptObservationId: row.receipt_observation_id,
    replayed: row.replayed,
  };
}

export function latestRestaurantMenuObservation(menu: RestaurantMenu) {
  return [...menu.observations].sort((left, right) => (
    right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id)
  ))[0] ?? null;
}

export function summarizeRestaurantMenuPrices(menu: RestaurantMenu) {
  const observations = [...menu.observations].sort((left, right) => (
    right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id)
  ));
  if (observations.length === 0) return null;
  const prices = observations.map((observation) => observation.unitPriceKrw);
  return {
    latest: observations[0],
    minimumPriceKrw: Math.min(...prices),
    maximumPriceKrw: Math.max(...prices),
    observationCount: observations.length,
  };
}

export function filterRestaurantMenuEntries(
  entries: readonly RestaurantMenuReadEntry[],
  query: string,
): RestaurantMenuReadEntry[] {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return [...entries];

  return entries.flatMap((entry) => {
    const restaurantText = [
      entry.restaurant.brand,
      entry.restaurant.legalName,
      entry.restaurant.cuisineType,
      ...(entry.restaurant.category?.path.map((node) => node.name) ?? []),
      ...entry.locations.map((location) => location.locationLabel),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");

    if (restaurantText.includes(normalized)) return [entry];
    const menus = entry.menus.filter((menu) => (
      `${menu.name} ${menu.categoryLabel ?? ""} ${menu.servingLabel}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalized)
    ));
    return menus.length > 0 ? [{ ...entry, menus }] : [];
  });
}

export function filterRestaurantDirectoryEntries(
  entries: readonly RestaurantDirectoryEntry[],
  query: string,
  category = "전체",
): RestaurantDirectoryEntry[] {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return entries
    .filter((entry) => {
      if (category === "전체") return true;
      if (entry.restaurant.category) {
        return entry.restaurant.category.path.some((node) => node.id === category);
      }
      return entry.restaurant.cuisineType !== null
        && `legacy:${entry.restaurant.cuisineType}` === category;
    })
    .filter((entry) => !normalized || [
      entry.restaurant.brand,
      entry.restaurant.legalName,
      entry.restaurant.cuisineType,
      ...(entry.restaurant.category?.path.map((node) => node.name) ?? []),
      ...entry.locations.flatMap((location) => [location.locationLabel, location.sourceLabel]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(normalized));
}

export type RestaurantDirectoryCategoryOption = {
  id: string;
  label: string;
  pathLabel: string;
  depth: number;
};

export function restaurantDirectoryCategories(
  entries: readonly RestaurantDirectoryEntry[],
): RestaurantDirectoryCategoryOption[] {
  const options = new Map<string, RestaurantDirectoryCategoryOption>();
  for (const entry of entries) {
    const category = entry.restaurant.category;
    if (category) {
      for (const [depth, node] of category.path.entries()) {
        options.set(node.id, {
          id: node.id,
          label: node.name,
          pathLabel: category.path.slice(0, depth + 1).map((pathNode) => pathNode.name).join(" › "),
          depth,
        });
      }
      continue;
    }
    if (entry.restaurant.cuisineType) {
      const id = `legacy:${entry.restaurant.cuisineType}`;
      options.set(id, {
        id,
        label: entry.restaurant.cuisineType,
        pathLabel: entry.restaurant.cuisineType,
        depth: 0,
      });
    }
  }
  return [...options.values()].sort((left, right) => (
    left.pathLabel.localeCompare(right.pathLabel, "ko-KR")
    || left.depth - right.depth
  ));
}

export function restaurantCategoryPathLabel(restaurant: RestaurantDirectoryEntry["restaurant"]) {
  return restaurant.category?.path.map((node) => node.name).join(" › ")
    ?? restaurant.cuisineType
    ?? null;
}

export function restaurantMenuCategories(menus: readonly RestaurantMenu[]): string[] {
  return [...new Set(menus.map((menu) => menu.categoryLabel ?? "기타"))]
    .sort((left, right) => left.localeCompare(right, "ko-KR"));
}

export function filterRestaurantMenus(
  menus: readonly RestaurantMenu[],
  query: string,
  category: string,
): RestaurantMenu[] {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return menus.filter((menu) => {
    const matchesCategory = category === "전체" || (menu.categoryLabel ?? "기타") === category;
    const matchesQuery = !normalized || [menu.name, menu.categoryLabel, menu.servingLabel]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(normalized);
    return matchesCategory && matchesQuery;
  });
}

const restaurantMenuOptionMarker = /추가|토핑|사리|곱빼기|곱배기|extra|add[\s_-]*on/i;

export function restaurantMenuNameLooksLikeOption(name: string): boolean {
  return restaurantMenuOptionMarker.test(name.trim());
}

export function inferRestaurantMenuOptionParent(
  menus: readonly RestaurantMenu[],
  optionMenuId: string,
): string | null {
  const optionMenu = menus.find((menu) => menu.id === optionMenuId);
  if (!optionMenu || !restaurantMenuNameLooksLikeOption(optionMenu.name)) return null;

  const baseMenus = menus.filter((menu) => (
    menu.id !== optionMenuId
    && !restaurantMenuNameLooksLikeOption(menu.name)
  ));
  return baseMenus.length === 1 ? baseMenus[0].id : null;
}

export type RestaurantMenuOptionGroup = {
  menu: RestaurantMenu;
  options: Array<{
    menu: RestaurantMenu;
    link: RestaurantMenuOptionLink;
  }>;
};

export function groupRestaurantMenusForDisplay(
  menus: readonly RestaurantMenu[],
  optionLinks: readonly RestaurantMenuOptionLink[],
  query: string,
  category: string,
): RestaurantMenuOptionGroup[] {
  const menuById = new Map(menus.map((menu) => [menu.id, menu]));
  const parentByOptionId = new Map(
    optionLinks
      .map((link) => [link.optionMenuId, link.parentMenuId] as const)
      .filter(([optionId, parentId]) => menuById.has(optionId) && menuById.has(parentId)),
  );
  const normalized = query.trim().toLocaleLowerCase("ko-KR");

  const matches = (menu: RestaurantMenu) => {
    const matchesCategory = category === "전체" || (menu.categoryLabel ?? "기타") === category;
    const matchesQuery = !normalized || [menu.name, menu.categoryLabel, menu.servingLabel]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(normalized);
    return matchesCategory && matchesQuery;
  };

  return menus
    .filter((menu) => !parentByOptionId.has(menu.id))
    .flatMap((menu) => {
      const linkedOptions = optionLinks
        .filter((link) => link.parentMenuId === menu.id)
        .map((link) => {
          const optionMenu = menuById.get(link.optionMenuId);
          return optionMenu ? { menu: optionMenu, link } : null;
        })
        .filter((option): option is { menu: RestaurantMenu; link: RestaurantMenuOptionLink } => option !== null);
      const matchingOptions = linkedOptions.filter((option) => matches(option.menu));
      if (!matches(menu) && matchingOptions.length === 0) return [];
      return [{
        menu,
        options: matches(menu) ? linkedOptions : matchingOptions,
      }];
    });
}
