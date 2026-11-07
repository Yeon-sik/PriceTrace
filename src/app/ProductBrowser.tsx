"use client";
import { Icon } from "@/components/Icon";

import { useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { cartProductFromGroup, cartProductFromOfficialListing, type CartProduct } from "@/domain/cart";
import { productNameWithoutBrand } from "@/domain/brand";
import {
  distinctSellerCount,
  latestSellerRows,
  PRODUCT_CATEGORY_ROOTS,
  productCategoryRoot,
  productSubcategories,
  type MartType,
  type ProductCategory,
  type ProductGroup,
  type ProductSort,
} from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import {
  filterAndSortOfficialChannelListings,
  partitionOfficialChannelListingsByStandardProduct,
} from "@/domain/public-official-channel-catalog";
import {
  officialListingsAreEligible,
  selectGridEntries,
  selectLinkedStandardSummaries,
  selectProductCatalogGroups,
  selectStoreOptions,
  selectVisibleLinkedStandardSummaries,
  selectVisibleProductGroups,
  selectVisibleStandardGroups,
  type CatalogView,
  type OfficialLinkedStandardSummary,
} from "@/features/product-browser/product-browser.selectors";
import { useProductCatalog } from "@/features/product-browser/use-product-catalog";
