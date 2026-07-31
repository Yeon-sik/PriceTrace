export type BrandRegistration = {
  canonicalName: string | null;
  receiptObservedName: string | null;
  officialObservedName: string | null;
  officialSourceLabel: string | null;
};

type BrandRegistrationInput = {
  canonicalName: string;
  receiptObservedName: string;
  officialObservedName: string;
  officialSourceUrl: string;
};

export type BrandRegistrationResult =
  | { value: BrandRegistration; error: null }
  | { value: null; error: string };

export function normalizeBrandLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
  const receiptObservedName = normalizeBrandLabel(input.receiptObservedName) || null;
  const officialObservedName = normalizeBrandLabel(input.officialObservedName) || null;

  if ((receiptObservedName || officialObservedName) && !canonicalName) {
    return {
      value: null,
      error: "브랜드 표기 근거를 저장하려면 표준 브랜드명을 입력하세요.",
    };
  }

  return {
    value: {
      canonicalName,
      receiptObservedName,
      officialObservedName,
      officialSourceLabel: officialObservedName
        ? officialBrandSourceLabel(input.officialSourceUrl)
        : null,
    },
    error: null,
  };
}
