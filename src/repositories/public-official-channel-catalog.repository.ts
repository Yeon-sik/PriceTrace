import rawPxCatalog from "../../data/public/official-channel-catalog/px.v1.json";
import { PublicOfficialChannelCatalogSchema } from "../domain/public-official-channel-catalog";

export class PublicOfficialChannelCatalogRepository {
  loadPxCatalog() {
    return PublicOfficialChannelCatalogSchema.parse(rawPxCatalog);
  }
}
