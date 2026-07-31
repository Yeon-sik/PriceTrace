import { describe, expect, it } from "vitest";
import { PublicOfficialChannelCatalogRepository } from "./public-official-channel-catalog.repository";

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
});
