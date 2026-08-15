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
