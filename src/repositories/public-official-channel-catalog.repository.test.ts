import { describe, expect, it } from "vitest";
import { findUniqueOfficialExactNameMatch } from "../domain/standard-product-registration";
import { PublicOfficialChannelCatalogRepository } from "./public-official-channel-catalog.repository";
import { PublicReceiptRepository } from "./public-receipt.repository";

describe("PublicOfficialChannelCatalogRepository", () => {
  it("loads the generated PX official catalog projection", () => {
    const catalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();

    expect(catalog.channel.id).toBe("korean-military-px");
    expect(catalog.collection.key).toBe("welfare.mil.kr|mart-sale-products|all-products");
    expect(catalog.collection.listingCount).toBe(2_269);
    expect(catalog.listings).toHaveLength(2_269);
    expect(catalog.classification.unclassifiedCount).toBe(0);
    expect(Object.values(catalog.classification.categoryCounts).reduce((sum, count) => sum + count, 0)).toBe(2_269);
    expect(catalog.listings.every((listing) => listing.standardProductLink.status === "unlinked")).toBe(true);
  });

  it("matches the strawberry cube by exact name while preserving different code namespaces", () => {
    const receiptObservation = new PublicReceiptRepository().loadAll().observations.find(
      (observation) => observation.item.sourceProductCode === "250428",
    );
    const catalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();
    expect(receiptObservation?.item.productName).toBe("베리베리스트로베리큐브");

    const officialListing = findUniqueOfficialExactNameMatch(
      catalog.listings,
      receiptObservation?.item.productName ?? "",
    );
    expect(officialListing?.sourceProductCode).toBe("35276");
    expect(officialListing?.sourceProductCode).not.toBe(receiptObservation?.item.sourceProductCode);
  });
});
