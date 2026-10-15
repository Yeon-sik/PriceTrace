-- A canonical fingerprint/local key can recur in independent purchases.
-- Keep the source-bound PK and RPC immutable parent/facts checks intact.
alter table public.purchase_owner_menu_component_sources
  drop constraint purchase_owner_menu_component_user_id_canonical_fingerprint_key;
comment on table public.purchase_owner_menu_component_sources is
  'Append-only evidence identity: (user_id,purchase_source_id,canonical_fingerprint,nutrition_client_key). Same-source replay reuses; changed parent/facts conflicts; new revision appends. Producer local keys do not identify other purchases.';
