import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Consumes requests exported by the actual OCR bundle/parser/orchestrator/adapters.
// Only local PGlite SQL executes. Nutrition/CashOS transport responses remain mocks.
export async function verifyOcrComponentContract(db, artifactPath) {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const purchase = artifact.purchaseRequest.p_purchase;
  const component = artifact.componentRequest;
  assert.equal(artifact.bundleVersion, "yeonsik-bundle.v1");
  assert.equal(artifact.canonical.schema_version, "yeonsik-ocr.v5");
  assert.equal(artifact.canonical.consumption.length, 0);
  assert.equal(purchase.items.length, 1);
  assert.equal(purchase.items[0].unit_price, 6000);
  assert.equal(artifact.cashRequest.p_grand_total_amount_krw, 6000);
  assert.equal(artifact.cashRequest.p_items.length, 1);
  assert.equal(artifact.fitnessImports.length, 2);
  assert.equal(component.p_components.length, 1);
  assert.equal(component.p_components[0].role, "complimentary_side");
  assert.deepEqual(component.p_components[0].evidenceRefs, ["food-photo-1"]);
  assert.doesNotMatch(JSON.stringify(artifact.canonical), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const rpc = async (sql, params) => (await db.query(sql, params)).rows[0].result;
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:"00000000-0000-4000-8000-000000000011"})]);
    await db.exec("set local role authenticated");
    const accepted = await rpc("select public.ingest_verified_purchase_price_observation_v1($1,$2::jsonb) as result",
      [artifact.purchaseRequest.p_idempotency_key, JSON.stringify(purchase)]);
    const sourceId = accepted.purchaseSourceId;
    const merchant = await rpc("select public.submit_merchant_identity_candidate_v1($1,$2::jsonb,true) as result",
      ["component-contract-merchant", JSON.stringify({merchant_name:purchase.seller.seller_name,business_kind:"food_service"})]);
    const resolved = await rpc("select public.resolve_user_confirmed_purchase_restaurant_line_v1($1::uuid,$2,$3::uuid,true) as result",
      [sourceId,component.p_line_key,merchant.candidateId]);
    assert.equal(resolved.lineResults[0].authorityStatus,"owner_confirmed");
    const register = () => rpc("select public.register_purchase_menu_components_v1($1::uuid,$2,$3,$4::jsonb,$5) as result",
      [sourceId,component.p_line_key,component.p_canonical_fingerprint,JSON.stringify(component.p_components),component.p_user_verified]);
    const result = await register();
    assert.equal(result.menuComponents.length,1);
    assert.equal(result.menuComponents[0].name,"국물");
    assert.equal(result.menuComponents[0].parentOwnerMenuId,resolved.lineResults[0].ownerConfirmedIds.restaurantMenuId);
    assert.equal(result.menuComponents[0].parentRestaurantMenuId,null);
    assert.deepEqual(result.menuComponents[0].evidenceRefs,["food-photo-1"]);
    assert.deepEqual(await register(),result);
    assert.deepEqual(await rpc("select public.get_purchase_price_ingestion_response_v1($1::uuid) as result",[sourceId]),result);
    const read = await rpc("select public.get_my_owner_confirmed_restaurants_v2() as result",[]);
    assert.equal(read.restaurants.length,1);
    assert.equal(read.restaurants[0].menus[0].components.length,1);
    assert.equal(read.restaurants[0].menus[0].components[0].name,"국물");
    const facts = (await db.query(`select s.source_payload,
      (select count(*)::int from public.purchase_price_source_lines where purchase_source_id=s.id) as lines,
      (select count(*)::int from public.purchase_owner_price_observations o
        join public.purchase_price_source_lines l on l.id=o.purchase_source_line_id and l.user_id=o.user_id
        where l.purchase_source_id=s.id) as prices,
      (select count(*)::int from public.purchase_owner_menu_component_sources where purchase_source_id=s.id) as bindings
      from public.purchase_price_sources s where s.id=$1::uuid`,[sourceId])).rows[0];
    assert.deepEqual(facts.source_payload,purchase);
    assert.equal(facts.lines,1); assert.equal(facts.prices,1); assert.equal(facts.bindings,1);
    assert.equal(read.restaurants[0].menus[0].priceHistory[0].unitPriceKrw,6000);
    console.log("OCR_BUNDLE_TO_REAL_PT_COMPONENT_CONTRACT_PASS", {lines:1,prices:1,components:1,nutritionImports:2,cashItems:1,meals:0});
  } finally { await db.exec("rollback"); }
}
