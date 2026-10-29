import { z } from "zod";

export const IdentityEntitySchema = z.enum(["brand", "store", "restaurant"]);
export type IdentityEntity = z.infer<typeof IdentityEntitySchema>;
export const identityEntityLabel: Record<IdentityEntity, string> = { brand: "브랜드", store: "가게", restaurant: "식당" };
const selection = z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict();
export const IdentitySourceSchema = z.object({
  entity: IdentityEntitySchema, sourceId: z.string().uuid(), name: z.string().min(1),
  branchName: z.string().nullable(), context: z.string().nullable(), selected: selection.nullable(),
}).strict();
export type IdentitySource = z.infer<typeof IdentitySourceSchema>;
export const IdentitySourcesSchema = z.object({
  schemaVersion: z.literal("identity-connections.v1"), ownerId: z.string().uuid(),
  truncated: z.boolean(), sources: z.array(IdentitySourceSchema).max(200),
}).strict();
export const IdentityChoiceSchema = selection.extend({
  branchName: z.string().nullable(), context: z.string().nullable(), similarity: z.number().min(0).max(1),
  matchKind: z.enum(["exact", "alias", "similar", "contains"]),
}).strict();
export type IdentityChoice = z.infer<typeof IdentityChoiceSchema>;
export const IdentitySearchSchema = z.object({
  schemaVersion: z.literal("identity-search.v1"), entity: IdentityEntitySchema, sourceId: z.string().uuid(),
  query: z.string(), choices: z.array(IdentityChoiceSchema).max(20),
}).strict();
export function identityMatchLabel(choice: IdentityChoice) {
  return choice.matchKind === "similar" ? `이름 유사도 ${Math.round(choice.similarity * 100)}%` :
    choice.matchKind === "exact" ? "같은 이름" : choice.matchKind === "alias" ? "등록된 다른 표기" : "이름 포함";
}
