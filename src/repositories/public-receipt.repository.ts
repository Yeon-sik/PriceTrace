import rawReceiptIndex from "../../data/public/receipts/index.v1.json";
import rawObservations from "../../data/public/product-observations.v3.json";
import {
  assertPublicReceiptObservationLinks,
  PublicObservationBundleSchema,
  publicObservationListings,
} from "../domain/public-observation";
import {
  assertNoForbiddenPublicReceiptKeys,
  assertNoForbiddenSourceValues,
  assertPublicReceiptCollection,
  publicReceiptFilesToReceipts,
} from "../domain/public-receipt";
import { publicReceiptFiles } from "./public-receipt-files.generated";

export class PublicReceiptRepository {
  loadAll() {
    const receiptInputs = Object.values(publicReceiptFiles);
    const collection = assertPublicReceiptCollection(rawReceiptIndex, receiptInputs);
    const observationBundle = PublicObservationBundleSchema.parse(rawObservations);
    assertNoForbiddenPublicReceiptKeys(collection.receipts);
    assertNoForbiddenSourceValues(collection.receipts, []);
    assertPublicReceiptObservationLinks(collection.index, collection.receipts, observationBundle);
    const receipts = publicReceiptFilesToReceipts(collection.receipts);
    return {
      revision: collection.index.revision,
      receipts,
      observations: publicObservationListings(observationBundle, receipts),
    };
  }
}
