import { z } from "zod";

export const carePlaceInputSchema = z.object({
  category: z.enum(["hospital", "pharmacy"]),
  name: z.string().trim().min(1, "기관 이름을 입력하세요.").max(200),
  address: z.string().trim().min(1, "같은 이름의 지점을 구분할 주소를 입력하세요.").max(500),
  phone: z.string().trim().max(60).default(""),
}).strict();
export const carePlaceSchema = carePlaceInputSchema.extend({
  schema_version: z.literal("care-place.v1"), place_id: z.string().uuid(),
}).strict();
export type CarePlace = z.infer<typeof carePlaceSchema>;
export type CarePlaceInput = z.infer<typeof carePlaceInputSchema>;
export const carePlaceLabel = (category: CarePlaceInput["category"]) => category === "hospital" ? "병원" : "약국";
