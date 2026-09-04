export const APP_PAGES = ["home", "restaurants", "products", "markets", "cart", "admin"] as const;

export type AppPage = (typeof APP_PAGES)[number];

export type AppNavigationState = {
  page: AppPage;
  selectedMarket: string | null;
  selectedRestaurant: string | null;
  selectedStoreId: string | null;
  selectedStoreProductId: string | null;
  selectedRestaurantMenuId: string | null;
  selectedCatalogProductId: string | null;
};

export type IdentityDeepLink =
  | { type: "store"; id: string }
  | { type: "store_product"; id: string }
  | { type: "restaurant_menu"; id: string }
  | { type: "catalog_product"; id: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAppPage(value: string | null): value is AppPage {
  return value !== null && APP_PAGES.includes(value as AppPage);
}

export function readAppNavigationUrl(href: string): AppNavigationState {
  const url = new URL(href);
  const requestedPage = url.searchParams.get("view");
  const page = isAppPage(requestedPage) ? requestedPage : "home";
  const requestedMarket = url.searchParams.get("store")?.trim() || null;
  const selectedMarket = page === "markets" && requestedMarket && requestedMarket.length <= 200
    ? requestedMarket
    : null;
  const requestedRestaurant = url.searchParams.get("restaurant")?.trim() || null;
  const selectedRestaurant = page === "restaurants"
    && requestedRestaurant
    && uuidPattern.test(requestedRestaurant)
    ? requestedRestaurant
    : null;
  const requestedStoreId = url.searchParams.get("storeId")?.trim() || null;
  const selectedStoreId = page === "markets"
    && requestedStoreId
    && uuidPattern.test(requestedStoreId)
    ? requestedStoreId
    : null;
  const requestedStoreProductId = url.searchParams.get("storeProductId")?.trim() || null;
  const selectedStoreProductId = page === "products"
    && requestedStoreProductId
    && uuidPattern.test(requestedStoreProductId)
    ? requestedStoreProductId
    : null;
  const requestedRestaurantMenuId = url.searchParams.get("restaurantMenuId")?.trim() || null;
  const selectedRestaurantMenuId = page === "restaurants"
    && requestedRestaurantMenuId
    && uuidPattern.test(requestedRestaurantMenuId)
    ? requestedRestaurantMenuId
    : null;
  const requestedCatalogProductId = url.searchParams.get("catalogProductId")?.trim() || null;
  const selectedCatalogProductId = page === "products"
    && requestedCatalogProductId
    && uuidPattern.test(requestedCatalogProductId)
    ? requestedCatalogProductId
    : null;

  return {
    page,
    selectedMarket,
    selectedRestaurant,
    selectedStoreId,
    selectedStoreProductId,
    selectedRestaurantMenuId,
    selectedCatalogProductId,
  };
}

export function buildAppNavigationUrl(
  href: string,
  {
    page,
    selectedMarket,
    selectedRestaurant,
    selectedStoreId,
    selectedStoreProductId,
    selectedRestaurantMenuId,
    selectedCatalogProductId,
  }: AppNavigationState,
) {
  const url = new URL(href);
  if (page === "home") url.searchParams.delete("view");
  else url.searchParams.set("view", page);

  if (page === "markets" && selectedMarket) {
    url.searchParams.set("store", selectedMarket);
  } else {
    url.searchParams.delete("store");
  }

  if (page === "restaurants" && selectedRestaurant) {
    url.searchParams.set("restaurant", selectedRestaurant);
  } else {
    url.searchParams.delete("restaurant");
  }

  if (page === "markets" && selectedStoreId) {
    url.searchParams.set("storeId", selectedStoreId);
  } else {
    url.searchParams.delete("storeId");
  }

  if (page === "products" && selectedStoreProductId) {
    url.searchParams.set("storeProductId", selectedStoreProductId);
  } else {
    url.searchParams.delete("storeProductId");
  }

  if (page === "restaurants" && selectedRestaurantMenuId) {
    url.searchParams.set("restaurantMenuId", selectedRestaurantMenuId);
  } else {
    url.searchParams.delete("restaurantMenuId");
  }

  if (page === "products" && selectedCatalogProductId) {
    url.searchParams.set("catalogProductId", selectedCatalogProductId);
  } else {
    url.searchParams.delete("catalogProductId");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildIdentityNavigationUrl(href: string, selector: IdentityDeepLink) {
  const state: AppNavigationState = {
    page: selector.type === "store"
      ? "markets"
      : selector.type === "restaurant_menu" ? "restaurants" : "products",
    selectedMarket: null,
    selectedRestaurant: null,
    selectedStoreId: selector.type === "store" ? selector.id : null,
    selectedStoreProductId: selector.type === "store_product" ? selector.id : null,
    selectedRestaurantMenuId: selector.type === "restaurant_menu" ? selector.id : null,
    selectedCatalogProductId: selector.type === "catalog_product" ? selector.id : null,
  };
  return buildAppNavigationUrl(href, state);
}
