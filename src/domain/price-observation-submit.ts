import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "observed_on must use YYYY-MM-DD.").refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "observed_on must be a real calendar date.");

const MAX_KRW_INTEGER = 2_147_483_647;

/**
 * The only payload allowed to leave the local OCR receipt boundary for the
 * PriceTrace observation endpoint. Keep receipt and submitter identity out of
 * this schema so an accidental caller cannot widen the wire contract.
 */
export const PriceObservationSubmitPayloadSchema = z.object({
  schema_version: z.literal("price-observation-submit.v1"),
  store_id: z.string().uuid(),
  observed_on: isoDateSchema,
  catalog_product_id: z.string().uuid(),
  unit_price_krw: z.number().int().nonnegative().max(MAX_KRW_INTEGER),
  idempotency_key: z.string().trim().min(1).max(200),
}).strict();

export const PriceObservationSubmitResponseSchema = z.object({
  observation_id: z.string().uuid(),
  replayed: z.boolean(),
  applied_action: z.enum(["created", "deduplicated", "replayed"]),
}).strict();

export type PriceObservationSubmitPayload = z.infer<typeof PriceObservationSubmitPayloadSchema>;
export type PriceObservationSubmitResponse = z.infer<typeof PriceObservationSubmitResponseSchema>;

export function parsePriceObservationSubmitPayload(input: unknown): PriceObservationSubmitPayload {
  return PriceObservationSubmitPayloadSchema.parse(input);
}
