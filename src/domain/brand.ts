export type BrandRegistration = {
  canonicalName: string | null;
  officialSourceLabel: string | null;
  /** @deprecated Kept only to parse proposals created before standard-brand-only input. */
  receiptObservedName?: string | null;
  /** @deprecated Kept only to parse proposals created before standard-brand-only input. */
  officialObservedName?: string;
};

type BrandRegistrationInput = {
  canonicalName: string;
  officialSourceUrl: string;
  /** @deprecated Legacy proposal compatibility; never collected by the UI. */
  receiptObservedName?: string;
  /** @deprecated Legacy proposal compatibility; never collected by the UI. */
  officialObservedName?: string;
};

export type BrandRegistrationResult =
  | { value: BrandRegistration; error: null }
  | { value: null; error: string };

export function normalizeBrandLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

type BrandLabelRecord = { canonical_name: string };

function compactBrandLabel(value: string): string {
  return normalizeBrandLabel(value).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function levenshteinDistance(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < rightCharacters.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (leftCharacters[leftIndex] === rightCharacters[rightIndex] ? 0 : 1),
      ));
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

/** Returns existing canonical brands that are close enough to review while typing. */
export function findSimilarBrandNames<T extends BrandLabelRecord>(brands: T[], query: string, limit = 5): T[] {
  const normalizedQuery = compactBrandLabel(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];

  return brands
    .map((brand, index) => {
      const normalizedName = compactBrandLabel(brand.canonical_name);
      if (!normalizedName) return null;
      const distance = levenshteinDistance(normalizedQuery, normalizedName);
      const longestLength = Math.max(normalizedQuery.length, normalizedName.length);
      const similarity = 1 - distance / longestLength;
      const contains = normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName);
      const minimumSimilarity = longestLength <= 4 ? 0.67 : 0.55;
      if (!contains && similarity < minimumSimilarity) return null;
      const exact = normalizedName === normalizedQuery;
      const prefix = normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName);
      return {
        brand,
        index,
        score: (exact ? 1_000 : 0) + (prefix ? 100 : 0) + (contains ? 50 : 0) + similarity,
      };
    })
    .filter((candidate): candidate is { brand: T; index: number; score: number } => candidate !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ brand }) => brand);
}

export function productNameWithoutBrand(productName: string, brandName: string | null | undefined): string {
  const name = normalizeBrandLabel(productName);
  const brand = brandName ? normalizeBrandLabel(brandName) : "";
  if (!brand || name.length <= brand.length) return name;
  const prefix = `${brand} `;
  return name.toLocaleLowerCase("ko-KR").startsWith(prefix.toLocaleLowerCase("ko-KR"))
    ? name.slice(prefix.length).trim() || name
    : name;
}

export function officialBrandSourceLabel(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

export function prepareBrandRegistration(input: BrandRegistrationInput): BrandRegistrationResult {
  const canonicalName = normalizeBrandLabel(input.canonicalName) || null;
  const receiptObservedName = input.receiptObservedName === undefined
    ? undefined
    : normalizeBrandLabel(input.receiptObservedName) || null;
  const officialObservedName = input.officialObservedName === undefined
    ? undefined
    : normalizeBrandLabel(input.officialObservedName) || null;

  if (!canonicalName) {
    return {
      value: null,
      error: receiptObservedName !== undefined || officialObservedName !== undefined
        ? "브랜드 표기 근거를 저장하려면 표준 브랜드명을 입력하세요."
        : "표준 브랜드명을 입력하세요.",
    };
  }

  return {
    value: {
      canonicalName,
      officialSourceLabel: officialBrandSourceLabel(input.officialSourceUrl),
      ...(receiptObservedName !== undefined ? { receiptObservedName } : {}),
      ...(officialObservedName !== undefined ? { officialObservedName: officialObservedName ?? "" } : {}),
    },
    error: null,
  };
}
