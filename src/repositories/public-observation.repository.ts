import rawObservations from "../../data/public/product-observations.v1.json";
import {
  PublicObservationBundleSchema,
  publicObservationListings,
} from "@/domain/public-observation";

export class PublicObservationRepository {
  loadAll() {
    const bundle = PublicObservationBundleSchema.parse(rawObservations);
    return publicObservationListings(bundle);
  }
}
