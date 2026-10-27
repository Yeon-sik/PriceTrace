import type { SupabaseClient } from "@supabase/supabase-js";
import { IdentitySearchSchema, IdentitySourcesSchema, type IdentitySource, type IdentityChoice } from "../domain/identity-connection";

export class IdentityConnectionRepository {
  constructor(private readonly client: SupabaseClient) {}
  private async owner() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("로그인한 뒤 다시 시도해 주세요.");
    return data.user.id;
  }
  private failure(error: { code?: string } | null) {
    if (error) throw new Error(error.code === "PGRST202" ? "서버에 연결 기능이 아직 적용되지 않았습니다." :
      error.code === "23505" ? "이미 다른 연결이 있습니다. 목록을 새로고침해 주세요." : "연결 정보를 처리하지 못했습니다. 다시 시도해 주세요.");
  }
  async load() {
    const owner = await this.owner();
    const { data, error } = await this.client.rpc("get_my_identity_connection_sources_v1");
    this.failure(error);
    const result = IdentitySourcesSchema.parse(data);
    if (result.ownerId !== owner || await this.owner() !== owner) throw new Error("로그인 계정이 바뀌었습니다. 다시 불러와 주세요.");
    return result;
  }
  async search(source: IdentitySource, query: string) {
    const owner = await this.owner();
    const { data, error } = await this.client.rpc("search_my_identity_connections_v1", {
      p_entity: source.entity, p_source_id: source.sourceId, p_query: query,
    });
    this.failure(error);
    const result = IdentitySearchSchema.parse(data);
    if (result.entity !== source.entity || result.sourceId !== source.sourceId || result.query !== query || await this.owner() !== owner)
      throw new Error("검색 대상이 바뀌었습니다. 다시 검색해 주세요.");
    return result;
  }
  async connect(source: IdentitySource, choice: IdentityChoice, query: string) {
    const owner = await this.owner();
    const { data, error } = await this.client.rpc("connect_my_identity_v1", {
      p_entity: source.entity, p_source_id: source.sourceId, p_target_id: choice.id, p_query: query, p_user_verified: true,
    });
    this.failure(error);
    const result = IdentitySourcesSchema.parse(data);
    if (result.ownerId !== owner || await this.owner() !== owner || !result.sources.some(row =>
      row.entity === source.entity && row.sourceId === source.sourceId && row.selected?.id === choice.id))
      throw new Error("저장된 연결을 확인하지 못했습니다. 새로고침해 주세요.");
    return result;
  }
}
