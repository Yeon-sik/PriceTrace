-- The explicit-offset datetime validator parses timestamptz, whose input
-- routine is STABLE rather than IMMUTABLE. Keep the declared volatility of
-- the validator and its SQL caller aligned with PostgreSQL semantics.

alter function public.is_valid_explicit_offset_datetime(text) stable;

alter function public.is_verified_single_codepoint_name_insertion_deletion(
  jsonb,
  text,
  text,
  text
) stable;
