import rawReviews from "../../data/curation/px-receipt-product-name-reviews.v1.json";
import {
  assertPxProductNameReviewsMatchOfficialCatalog,
  PxProductNameReviewRegistrySchema,
} from "../domain/px-product-name-review";
import type { PublicOfficialChannelCatalog } from "../domain/public-official-channel-catalog";

export class PxProductNameReviewRepository {
  load(catalog: PublicOfficialChannelCatalog) {
    const registry = PxProductNameReviewRegistrySchema.parse(rawReviews);
    assertPxProductNameReviewsMatchOfficialCatalog(registry.reviews, catalog);
    return registry.reviews;
  }
}
