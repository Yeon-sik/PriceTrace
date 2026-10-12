-- OCR-reviewed purchases are readable by their owner without a second admin review.
-- Public menu observations and all write permissions keep their existing rules.
create policy "Owners read verified restaurant purchases"
on public.restaurant_menu_manual_observations
for select to authenticated
using (
  created_by = (select auth.uid())
  and verification_status = 'verified'
  and observation_kind = 'standalone_purchase'
);
