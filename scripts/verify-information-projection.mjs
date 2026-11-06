import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export async function verifyInformationProjection(db, root) {
  const owner = "00000000-0000-4000-8000-000000000011", other = "00000000-0000-4000-8000-000000000022";
  const product = "99000000-0000-4000-8000-000000000002", standard = "99000000-0000-4000-8000-000000000001", store = "99000000-0000-4000-8000-000000000003";
  const base = JSON.parse(readFileSync(`${root}/contracts/information-record.v1.cases.json`, "utf8")).accepted.find(e=>e.record.owner_app==="pricetrace").record;
  const mapping = { catalog_product_id: product, store_id: store, price_field: "price", date_field: "day" };
  let sequence = 10;
  const sample = changes => ({ ...base, record_id: `99000000-0000-4000-8000-${String(sequence++).padStart(12,"0")}`, title: "Private original marker DO_NOT_PUBLISH",
    fields:[{key:"price",value_type:"decimal",unit:"KRW",value:"1200.00"},{key:"day",value_type:"date",value:"2026-11-06"}], ...changes });
  const auth = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id})]); await db.exec("set role authenticated"); };
  const ingest = async record => (await db.query("select public.ingest_pricetrace_information_record_v1($1,$2) result",[JSON.stringify(record),owner])).rows[0].result;
  const preview = async (record,receipt,m=mapping) => (await db.query("select public.preview_pricetrace_information_price_v1($1,$2,$3,$4) result",[record.record_id,owner,receipt.content_fingerprint,JSON.stringify(m)])).rows[0].result;
  const apply = async (record,receipt,p,approved=true,m=mapping) => (await db.query("select public.apply_pricetrace_information_price_v1($1,$2,$3,$4,$5,$6) result",[record.record_id,owner,receipt.content_fingerprint,JSON.stringify(m),p.mapping_digest,approved])).rows[0].result;
  const rejects = async (action, predicate) => { await db.exec("savepoint expected_failure"); try { await assert.rejects(action,predicate); } finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); } };
  await db.exec("begin");
  try {
    await db.query("insert into public.standard_products(id,purchase_type,canonical_name,verification_status,category_id) values($1,'retail_product','Projection fixture','verified',(select id from public.catalog_categories where purchase_type='retail_product' limit 1))",[standard]);
    await db.query("insert into public.catalog_products(id,standard_product_id,purchase_type,canonical_name,verification_status,specification_status,content_amount,content_unit,package_count,reference_unit,listing_reference_url) values($1,$2,'retail_product','Exact fixture package','verified','verified',40,'g',1,100,'https://example.test/projection')",[product,standard]);
    await db.query("insert into public.price_observation_sources(id,source_namespace,source_store_code,display_name,review_status) values($1,'projection-test','store-1','Exact fixture store','verified')",[store]);
    const nativeBefore=(await db.query("select count(*)::int count from public.price_observations")).rows[0].count;
    await auth(owner);
    const record=sample(); const source=await ingest(record); const p=await preview(record,source);
    assert.equal(p.status,"ready"); assert.equal(p.impact.additional_observations,1); assert.equal(p.impact.minimum_after,1200);
    await rejects(()=>apply(record,source,p,false),error=>error.code==="22023");
    await rejects(()=>apply(record,source,{...p,mapping_digest:"0".repeat(64)}),error=>error.code==="23505");
    await rejects(()=>preview(record,{...source,content_fingerprint:"0".repeat(64)}),error=>error.code==="23505");
    await db.exec('reset role');
    await db.query("update public.catalog_products set canonical_name='Changed exact product label' where id=$1",[product]);
    await auth(owner); await rejects(()=>apply(record,source,p),error=>error.code==="23505");
    await db.exec('reset role');await db.query("update public.catalog_products set canonical_name='Exact fixture package' where id=$1",[product]);await auth(owner);
    const zero=sample({fields:[{...record.fields[0],value:'0'},record.fields[1]]}); const zs=await ingest(zero);
    assert.equal((await preview(zero,zs)).impact.unit_price_krw,0,'explicit zero survives; unknown never defaults to zero');
    for (const [label,changes,override] of [
      ["service",{fields:[...record.fields,{key:"offering_kind",value_type:"text",value:"service"}]}],
      ["fraction",{fields:[{...record.fields[0],value:"1.5"},record.fields[1]]}],
      ["unknown currency",{fields:[{key:"price",value_type:"decimal",value:"1200"},record.fields[1]]}],
      ["too large",{fields:[{...record.fields[0],value:"2147483648"},record.fields[1]]}],
      ["unknown date",{}, {...mapping,date_field:"$captured_at"}],
      ["unknown seller",{}, {...mapping,store_id:""}],
    ]) { const item=sample(changes); const receipt=await ingest(item); const blocked=await preview(item,receipt,override??mapping); assert.equal(blocked.status,"blocked",label);
      assert.equal((await db.query("select state from public.pricetrace_information_inbox where record_id=$1",[item.record_id])).rows[0].state,"pending"); }
    // A receipt write failure must roll the native RPC and its replay guard back too.
    await db.exec("reset role; create function pg_temp.fail_projection_receipt() returns trigger language plpgsql as $$ begin raise exception 'receipt failure'; end $$; create trigger fixture_fail_receipt before insert on public.pricetrace_information_projection_receipts for each row execute function pg_temp.fail_projection_receipt()");
    await auth(owner);
    await db.exec("savepoint failed_application");
    await rejects(()=>apply(record,source,p),error=>error.code==="P0001");
    await db.exec("rollback to savepoint failed_application; reset role");
    assert.equal((await db.query("select count(*)::int count from public.public_price_observations where catalog_product_id=$1",[product])).rows[0].count,0);
    await db.exec("drop trigger fixture_fail_receipt on public.pricetrace_information_projection_receipts");
    await auth(owner);
    const result=await apply(record,source,p); assert.equal(result.status,"applied");
    assert.equal((await apply(record,source,p)).observation_id,result.observation_id);
    assert.equal((await apply(record,source,p)).replayed,true);
    await rejects(()=>apply(record,source,p,true,{...mapping,date_field:"changed"}),error=>error.code==="23505");
    const duplicate=sample(); const duplicateSource=await ingest(duplicate); const dp=await preview(duplicate,duplicateSource);
    assert.equal(dp.impact.additional_observations,0); assert.equal((await apply(duplicate,duplicateSource,dp)).observation_id,result.observation_id);
    const correction=sample({supersedes_record_id:record.record_id}); const cs=await ingest(correction);
    assert.equal((await preview(correction,cs)).status,"blocked");
    const grandchild=sample({supersedes_record_id:correction.record_id}); const gs=await ingest(grandchild);
    assert.equal((await preview(grandchild,gs)).status,"blocked","applied ancestor blocks through unapplied parent");
    const root=sample(); await ingest(root);
    const child=sample({supersedes_record_id:root.record_id}); const childSource=await ingest(child); await apply(child,childSource,await preview(child,childSource));
    const sibling=sample({supersedes_record_id:root.record_id}); const siblingSource=await ingest(sibling);
    assert.equal((await preview(sibling,siblingSource)).status,"blocked","applied sibling blocks entire known correction lineage");
    assert.equal((await preview(root,await ingest(root))).status,"blocked","applied descendant blocks root");
    const unknown=sample({supersedes_record_id:'99000000-0000-4000-8000-999999999999'}); const xs=await ingest(unknown);
    assert.equal((await preview(unknown,xs)).status,"blocked","unavailable ancestry cannot be assumed safe");
    const cycleA=sample(),cycleB=sample({supersedes_record_id:cycleA.record_id});cycleA.supersedes_record_id=cycleB.record_id;
    const ca=await ingest(cycleA); await ingest(cycleB); assert.equal((await preview(cycleA,ca)).status,"blocked");
    let chain=sample();await ingest(chain);
    for(let i=0;i<65;i++){chain=sample({supersedes_record_id:chain.record_id});await ingest(chain);}
    assert.equal((await preview(chain,await ingest(chain))).status,"blocked","bounded correction ancestry");
    assert.equal((await db.query("select payload_text from public.pricetrace_information_inbox where record_id=$1",[record.record_id])).rows[0].payload_text,JSON.stringify(record));
    await rejects(()=>db.exec("update public.pricetrace_information_projection_receipts set adapter='changed'"),error=>error.code==="42501");
    await rejects(()=>db.exec("delete from public.pricetrace_information_projection_receipts"),error=>error.code==="42501");
    await auth(other);
    assert.equal((await db.query("select count(*)::int count from public.pricetrace_information_projection_receipts")).rows[0].count,0);
    await rejects(()=>apply(record,source,p),error=>error.code==="42501");
    await db.exec("reset role; set role anon");
    await rejects(()=>preview(record,source),error=>error.code==="42501");
    const published=(await db.query("select * from public.get_information_public_prices_v1(0,500)")).rows.filter(row=>row.catalog_product_id===product);
    assert.equal(published.length,1); assert.equal(published[0].unit_price_krw,1200); assert.ok(!JSON.stringify(published).includes("DO_NOT_PUBLISH"));
    assert.deepEqual(Object.keys(published[0]).sort(),["observation_id","catalog_product_id","product_name","store_id","store_name","location_label","observed_on","unit_price_krw"].sort());
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int count from public.price_observations")).rows[0].count,nativeBefore);
    await db.query("update public.catalog_products set verification_status='unverified' where id=$1",[product]);
    await auth(owner); const unverified=sample(); const us=await ingest(unverified); assert.equal((await preview(unverified,us)).status,"blocked");
    assert.equal((await apply(record,source,p)).replayed,true,"durable receipt replays after target eligibility changes");
    console.log("INFORMATION_PUBLIC_PROJECTION_APPROVAL_ATOMIC_REPLAY_RLS_STATS_PASS");
  } finally { await db.exec("rollback; reset role"); }
}
