export const apparelSizes = [
  { alpha: "S", kr: 90, label: "S(90)" },
  { alpha: "M", kr: 95, label: "M(95)" },
  { alpha: "L", kr: 100, label: "L(100)" },
  { alpha: "XL", kr: 105, label: "XL(105)" },
  { alpha: "XXL", kr: 110, label: "XXL(110)" },
  { alpha: "XXXL", kr: 115, label: "XXXL(115)" },
] as const;

export type ApparelSize = (typeof apparelSizes)[number];
export type ApparelSizeLabel = ApparelSize["label"];

export function findApparelSizeByKr(kr: number): ApparelSize | null {
  return apparelSizes.find((size) => size.kr === kr) ?? null;
}

export function parseOfficialApparelSize(value: string): ApparelSize | null {
  const normalized = value.normalize("NFKC").trim();
  const numeric = /^(?:SIZE\s*)?([0-9]{2,3})(?:\s*호)?$/iu.exec(normalized)?.[1];
  if (!numeric) return null;
  return findApparelSizeByKr(Number(numeric));
}
