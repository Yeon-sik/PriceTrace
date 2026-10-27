import { z } from "zod";

const money = z.number().int().nonnegative().nullable();
const priceHistorySchema = z.object({
  id: z.string().uuid(), purchaseSourceLineId: z.string().uuid(),
  observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string().datetime({ offset: true }),
  quantity: z.number().int().positive().nullable(), unitPriceKrw: money,
  grossPriceKrw: money, discountPriceKrw: money, netPriceKrw: money,
}).strict();
const ownerMenuSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1), servingLabel: z.string().nullable(),
  priceHistory: z.array(priceHistorySchema),
  components: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1),
    role: z.enum(["side", "complimentary_side", "sauce", "beverage", "other"]),
  }).strict()).optional(),
}).strict();

// Deliberately separate from RestaurantDirectory/RestaurantMenu/global catalogue IDs.
export const OwnerConfirmedRestaurantReadSchema = z.object({
  schemaVersion: z.enum(["owner-restaurant-read.v1", "owner-restaurant-read.v2", "owner-restaurant-read.v3"]), ownerId: z.string().uuid(),
  restaurants: z.array(z.object({
    id: z.string().uuid(), locationId: z.string().uuid(), name: z.string().min(1),
    branchName: z.string().nullable(), authorityStatus: z.literal("owner_confirmed"),
    menus: z.array(ownerMenuSchema),
  }).strict()),
}).strict();
export type OwnerConfirmedRestaurantRead = z.infer<typeof OwnerConfirmedRestaurantReadSchema>;
export type OwnerConfirmedMenu = z.infer<typeof ownerMenuSchema>;

export function ownerMenuPriceHistory(menu: OwnerConfirmedMenu) {
  return [...menu.priceHistory].sort((a, b) => b.observedOn.localeCompare(a.observedOn) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}
export function latestOwnerMenuPrice(menu: OwnerConfirmedMenu) {
  return ownerMenuPriceHistory(menu)[0] ?? null;
}
