"use client";

import { useEffect, useState } from "react";
import type { ProductSpecification } from "../../domain/canonical-price";
import { seededOfficialProducts, type OfficialProductRecord } from "../../domain/official-product";
import {
  buildPublicStandardCatalogIndex,
  publicStandardMappingKey,
  PublicStandardCatalogRowsSchema,
  type PublicCoupangPrice,
} from "../../domain/public-standard-catalog";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { OfficialProductRepository } from "../../repositories/official-product.repository";
import type { CatalogSpecification } from "./product-browser.selectors";

const officialProductRepository = new OfficialProductRepository();

function isMissingCatalogRpc(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202"
    || error?.message?.includes("Could not find the function") === true;
}

export function useProductCatalog(authRevision: number) {
  const client = getSupabaseBrowserClient();
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(
    seededOfficialProducts,
  );
  const [standardMappings, setStandardMappings] = useState<Map<string, string>>(new Map());
  const [exactStandardMappings, setExactStandardMappings] = useState<Map<string, string>>(new Map());
  const [catalogSpecs, setCatalogSpecs] = useState<Map<string, CatalogSpecification>>(new Map());
  const [standardNames, setStandardNames] = useState<Map<string, string>>(new Map());
  const [standardImages, setStandardImages] = useState<Map<string, string>>(new Map());
  const [coupangByStandard, setCoupangByStandard] = useState<Map<string, PublicCoupangPrice>>(new Map());
  const [catalogNotice, setCatalogNotice] = useState("");

  useEffect(() => {
    setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() });
  }, []);

  useEffect(() => {
    let active = true;
    if (!client) {
      setCatalogNotice("표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다.");
      return () => { active = false; };
    }

    const loadStandardCatalog = async () => {
      let publicCatalogReady = false;
      let signedInCatalogReady = false;
      let coupangReady = false;
      let sharedMappings = new Map<string, string>();
      const exactMappings = new Map<string, string>();
      let specs = new Map<string, CatalogSpecification>();
      let names = new Map<string, string>();
      let images = new Map<string, string>();
      let coupangPrices = new Map<string, PublicCoupangPrice>();

      const v2PublicResult = await client.rpc("get_public_exact_standard_product_catalog_v2");
      const exactPublicResult = v2PublicResult.error && isMissingCatalogRpc(v2PublicResult.error)
        ? await client.rpc("get_public_exact_standard_product_catalog")
        : v2PublicResult;
      const publicResult = exactPublicResult.error && isMissingCatalogRpc(exactPublicResult.error)
        ? await client.rpc("get_public_standard_product_catalog")
        : exactPublicResult;
      if (!publicResult.error) {
        const parsed = PublicStandardCatalogRowsSchema.safeParse(publicResult.data ?? []);
        if (parsed.success) {
          const publicIndex = buildPublicStandardCatalogIndex(parsed.data);
          sharedMappings = publicIndex.standardMappings;
          for (const [key, catalogProductId] of publicIndex.exactStandardMappings) {
            exactMappings.set(key, catalogProductId);
          }
          specs = publicIndex.catalogSpecs;
          names = publicIndex.standardNames;
          coupangPrices = publicIndex.coupangByStandard;
          publicCatalogReady = true;
          coupangReady = true;
        }
      }

      const imageResult = await client
        .from("standard_product_images")
        .select("standard_product_id,image_url");
      if (!imageResult.error) {
        images = new Map(
          (imageResult.data ?? []).map((row) => [
            row.standard_product_id as string,
            row.image_url as string,
          ]),
        );
      }

      const { data: authData } = await client.auth.getUser();
      if (authData.user) {
        const [mappingResult, catalogResult, standardResult, coupangResult] = await Promise.all([
          client
            .from("source_product_mappings")
            .select("source_label,source_product_code,catalog_product_id")
            .eq("review_status", "verified"),
          client
            .from("catalog_products")
            .select("id,standard_product_id,content_amount,content_unit,package_count,reference_unit")
            .eq("status", "active")
            .eq("specification_status", "verified"),
          client
            .from("standard_products")
            .select("id,canonical_name")
            .eq("status", "active"),
          client
            .from("standard_product_coupang_prices")
            .select("standard_product_id,listed_price_krw,quantity,content_amount,content_unit,max_bundle_quantity,max_bundle_listed_price_krw,product_url,observed_at")
            .order("observed_at", { ascending: false }),
        ]);
        if (!mappingResult.error) {
          for (const mapping of mappingResult.data ?? []) {
            exactMappings.set(
              publicStandardMappingKey(mapping.source_label, mapping.source_product_code),
              mapping.catalog_product_id as string,
            );
          }
        }
        if (!catalogResult.error) {
          specs = new Map([
            ...specs,
            ...(catalogResult.data ?? [])
              .filter((row) => row.content_amount && row.content_unit)
              .map((row) => [
                row.id as string,
                {
                  contentAmount: row.content_amount as number,
                  contentUnit: row.content_unit as ProductSpecification["contentUnit"],
                  packageCount: row.package_count as number,
                  referenceUnit: row.reference_unit as 10 | 100 | 1000,
                  standardProductId: row.standard_product_id as string,
                },
              ] as const),
          ]);
        }
        if (!standardResult.error) {
          names = new Map([
            ...names,
            ...(standardResult.data ?? []).map((row) => [
              row.id as string,
              row.canonical_name as string,
            ] as const),
          ]);
        }
        if (!coupangResult.error) {
          const mergedCoupang = new Map(coupangPrices);
          for (const row of coupangResult.data ?? []) {
            const standardProductId = row.standard_product_id as string | null;
            if (!standardProductId) continue;
            const existing = mergedCoupang.get(standardProductId);
            if (!existing || (row.observed_at as string) > existing.observedAt) {
              mergedCoupang.set(standardProductId, {
                listedPriceKrw: row.listed_price_krw as number,
                quantity: row.quantity as number,
                maxBundleQuantity: row.max_bundle_quantity as number | null,
                maxBundleListedPriceKrw: row.max_bundle_listed_price_krw as number | null,
                contentAmount: row.content_amount as number | null,
                contentUnit: row.content_unit as ProductSpecification["contentUnit"] | null,
                productUrl: row.product_url as string,
                observedAt: row.observed_at as string,
              });
            }
          }
          coupangPrices = mergedCoupang;
          coupangReady = true;
        }
        signedInCatalogReady = !mappingResult.error
          && !catalogResult.error
          && !standardResult.error;
      }

      if (!active) return;
      setStandardMappings(sharedMappings);
      setExactStandardMappings(exactMappings);
      setCatalogSpecs(specs);
      setStandardNames(names);
      setStandardImages(images);
      setCoupangByStandard(coupangPrices);
      setCatalogNotice(
        !publicCatalogReady && !signedInCatalogReady
          ? "표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다."
          : !coupangReady
            ? "표준 상품은 표시하지만 쿠팡 가격 정보를 불러오지 못했습니다."
            : "",
      );
    };

    void loadStandardCatalog();
    return () => { active = false; };
  }, [authRevision, client]);

  return {
    officialProducts,
    standardMappings,
    exactStandardMappings,
    catalogSpecs,
    standardNames,
    standardImages,
    coupangByStandard,
    catalogNotice,
  };
}
