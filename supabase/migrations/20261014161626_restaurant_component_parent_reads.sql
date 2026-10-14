-- Extend only V2. Registry mappings are read correlations, never authority grants.
create or replace function public.get_my_owner_confirmed_restaurants_v2()
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare response jsonb; restaurants jsonb; actor uuid := (select auth.uid());
begin
  response := public.get_my_owner_confirmed_restaurants_v1();
  select coalesce(jsonb_agg(r || jsonb_build_object('menus',
    (select coalesce(jsonb_agg(m || jsonb_build_object('components',
      (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'role',c.role)
        order by c.role,c.name,c.id),'[]'::jsonb)
       from public.purchase_owner_menu_components c
       join public.purchase_owner_menus owner_menu
         on owner_menu.user_id = actor and owner_menu.id = (m->>'id')::uuid
       where c.user_id = actor and (c.owner_menu_id = owner_menu.id
         or c.restaurant_menu_id = owner_menu.resolved_restaurant_menu_id)))), '[]'::jsonb)
     from jsonb_array_elements(r->'menus') m))), '[]'::jsonb)
    into restaurants from jsonb_array_elements(response->'restaurants') r;
  return response || jsonb_build_object('schemaVersion','owner-restaurant-read.v2','restaurants',restaurants);
end;
$function$;
revoke all on function public.get_my_owner_confirmed_restaurants_v2() from public,anon;
grant execute on function public.get_my_owner_confirmed_restaurants_v2() to authenticated;
comment on function public.get_my_owner_confirmed_restaurants_v2() is
  'Owner-private components from owner menu or its resolved registry menu. Does not grant global identity authority or create price observations. V1 unchanged.';
notify pgrst, 'reload schema';
