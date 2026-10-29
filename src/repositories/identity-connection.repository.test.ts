import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { IdentityConnectionRepository } from "./identity-connection.repository";
import { identityMatchLabel, type IdentitySource, type IdentityChoice } from "../domain/identity-connection";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const source: IdentitySource = { entity: "restaurant", sourceId: id(1), name: "한성대학교 학식당", branchName: null, context: null, selected: null };
const choice: IdentityChoice = { id: id(2), name: "한성대학교 학생식당", branchName: null, context: null, similarity: 0.8889, matchKind: "similar" };
const inventory = { schemaVersion: "identity-connections.v1", ownerId: id(11), truncated: false, sources: [source] };
function fixture(data: unknown) {
  const mock = { auth: { getUser: vi.fn().mockResolvedValue({data:{user:{id:id(11)}},error:null}) }, rpc: vi.fn().mockResolvedValue({data,error:null}) };
  return { mock, repo: new IdentityConnectionRepository(mock as unknown as SupabaseClient) };
}
test("search binds response to the exact source and query", async () => {
  const data = { schemaVersion:"identity-search.v1", entity:source.entity, sourceId:source.sourceId,query:source.name,choices:[choice] };
  const {mock,repo}=fixture(data);
  expect((await repo.search(source,source.name)).choices).toEqual([choice]);
  mock.rpc.mockResolvedValue({data:{...data,sourceId:id(99)},error:null});
  await expect(repo.search(source,source.name)).rejects.toThrow("검색 대상");
});
test("connect sends explicit confirmation and validates saved target", async () => {
  const {mock,repo}=fixture({...inventory,sources:[{...source,selected:{id:choice.id,name:choice.name}}]});
  await repo.connect(source,choice,source.name);
  expect(mock.rpc).toHaveBeenCalledWith("connect_my_identity_v1",expect.objectContaining({p_target_id:choice.id,p_user_verified:true}));
  mock.rpc.mockResolvedValue({data:inventory,error:null});
  await expect(repo.connect(source,choice,source.name)).rejects.toThrow("저장된 연결");
});
test("rejects account switches and another owner's inventory",async () => {
  const {mock,repo}=fixture(inventory);
  mock.auth.getUser.mockResolvedValueOnce({data:{user:{id:id(11)}},error:null}).mockResolvedValueOnce({data:{user:{id:id(22)}},error:null});
  await expect(repo.load()).rejects.toThrow("계정");
});
test("unavailable server is reported rather than an empty search",async () => {
  const {mock,repo}=fixture(null); mock.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}} as never);
  await expect(repo.load()).rejects.toThrow("아직 적용");
  expect(identityMatchLabel(choice)).toBe("이름 유사도 89%");
});
