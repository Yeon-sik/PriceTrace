export const APP_PAGES = ["home", "restaurants", "products", "markets", "cart", "admin"] as const;

export type AppPage = (typeof APP_PAGES)[number];

export type AppNavigationState = {
  page: AppPage;
  selectedMarket: string | null;
  selectedRestaurant: string | null;
};

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

  return { page, selectedMarket, selectedRestaurant };
}

export function buildAppNavigationUrl(
  href: string,
  { page, selectedMarket, selectedRestaurant }: AppNavigationState,
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

  return `${url.pathname}${url.search}${url.hash}`;
}
