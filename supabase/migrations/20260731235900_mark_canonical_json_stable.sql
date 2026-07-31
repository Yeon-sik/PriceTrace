alter function public.canonical_jsonb_text(jsonb) stable;

comment on function public.canonical_jsonb_text(jsonb) is
  'Produces the stable canonical JSON text used for server-side LinkProposal fingerprint validation.';
