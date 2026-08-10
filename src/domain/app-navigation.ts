export const APP_PAGES = ["home", "products", "markets", "cart", "admin"] as const;

export type AppPage = (typeof APP_PAGES)[number];

export type AppNavigationState = {
  page: AppPage;
  selectedMarket: string | null;
};

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

  return { page, selectedMarket };
}

export function buildAppNavigationUrl(
  href: string,
  { page, selectedMarket }: AppNavigationState,
) {
  const url = new URL(href);
  if (page === "home") url.searchParams.delete("view");
  else url.searchParams.set("view", page);

  if (page === "markets" && selectedMarket) {
    url.searchParams.set("store", selectedMarket);
  } else {
    url.searchParams.delete("store");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
