import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
export async function verifyInformationSellerReview(db, root) {
 const owner='00000000-0000-4000-8000-000000000011', admin='00000000-0000-4000-8000-000000000022';
 const record=JSON.parse(readFileSync(`${root}/contracts/information-record.v1.cases.json`,'utf8')).accepted.find(e=>e.record.owner_app==='pricetrace').record;
 const request='98000000-0000-4000-8000-000000000001';
 const details={display_name:'Explicit fixture seller',location_label:'Exact fixture branch',evidence_url:'https://example.test/exact-branch',evidence_note:'PRIVATE_SELLER_EVIDENCE'};
 const auth=async(id,metadata={})=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,...metadata})]);await db.exec('set role authenticated');};
 const submit=async(d=details,id=request)=>(await db.query('select public.submit_pricetrace_seller_review_v1($1,$2,$3,$4) result',[id,record.record_id,owner,JSON.stringify(d)])).rows[0].result;
 const review=async(digest,approve=true,note='Exact identity independently checked')=>(await db.query('select public.review_pricetrace_seller_v1($1,$2,$3,$4,$5) result',[request,admin,digest,approve,note])).rows[0].result;
 const rejects=async(action,code)=>{await db.exec('savepoint expected_failure');try{await assert.rejects(action,error=>error.code===code);}finally{await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}};
 await db.exec('begin');
 try {
  await auth(owner); await db.query('select public.ingest_pricetrace_information_record_v1($1,$2)',[JSON.stringify(record),owner]);
  await rejects(()=>submit({...details,evidence_url:'javascript:alert(1)'}),'22023');
  await rejects(()=>submit({...details,evidence_note:''}),'22023');
  const pending=await submit(); assert.equal(pending.state,'pending'); assert.equal((await submit()).input_digest,pending.input_digest);
  await rejects(()=>submit({...details,display_name:'Changed identity'}),'23505');
  await rejects(()=>db.exec("update public.pricetrace_seller_review_requests set state='approved'"),'42501');
  const visible=(await db.query('select * from public.get_price_observation_sources_v1()')).rows;
  assert.ok(!visible.some(row=>row.display_name===details.display_name),'pending never public');
  await auth(admin,{user_metadata:{role:'admin'}});
  assert.equal((await db.query('select count(*)::int n from public.pricetrace_seller_review_requests')).rows[0].n,0,'user metadata cannot grant admin');
  await rejects(()=>review(pending.input_digest),'42501');
  await auth(admin,{app_metadata:{role:'admin'}});
  assert.equal((await db.query('select count(*)::int n from public.pricetrace_seller_review_requests')).rows[0].n,1);
  await rejects(()=>review('0'.repeat(64)),'23505'); await rejects(()=>review(pending.input_digest,true,''),'22023');
  const approved=await review(pending.input_digest);assert.equal(approved.state,'approved');assert.ok(approved.store_id);
  assert.equal((await review(pending.input_digest)).store_id,approved.store_id);
  await rejects(()=>review(pending.input_digest,false),'23505');
  await auth(owner); const second=await submit(details,'98000000-0000-4000-8000-000000000002');
  await auth(admin,{app_metadata:{role:'admin'}});
  const duplicate=(await db.query('select public.review_pricetrace_seller_v1($1,$2,$3,true,$4) result',[second.request_id,admin,second.input_digest,'Exact duplicate confirmed'])).rows[0].result;
  assert.equal(duplicate.store_id,approved.store_id,'exact identity replay shares the public seller');
  await db.exec('reset role;set role anon');
  await rejects(()=>db.query('select * from public.pricetrace_seller_review_requests'),'42501');
  await rejects(()=>submit(),'42501');
  const publicRows=(await db.query('select * from public.get_price_observation_sources_v1()')).rows.filter(row=>row.store_id===approved.store_id);
  assert.equal(publicRows.length,1);assert.ok(!JSON.stringify(publicRows).includes(details.evidence_note));assert.ok(!JSON.stringify(publicRows).includes(owner));
  console.log('INFORMATION_SELLER_PRIVATE_REQUEST_ADMIN_APPROVAL_REPLAY_PASS');
 }finally{await db.exec('rollback;reset role');}
 // Exercise the exact operator rollback script locally with isolated prerequisites.
 await db.exec('begin');
 try {
  await db.query("update auth.users set raw_app_meta_data=$2::jsonb where id=$1",[owner,JSON.stringify({role:'admin'})]);
  await db.exec("insert into public.standard_products(id,purchase_type,canonical_name,verification_status,category_id) values('96000000-0000-4000-8000-000000000001','retail_product','Hosted smoke fixture','verified',(select id from public.catalog_categories where purchase_type='retail_product' limit 1))");
  await db.exec("insert into public.catalog_products(id,standard_product_id,purchase_type,canonical_name,verification_status,specification_status,content_amount,content_unit,package_count,reference_unit,listing_reference_url) values('96000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000001','retail_product','Hosted smoke package','verified','verified',40,'g',1,100,'https://example.test/smoke')");
  const result=await db.exec(readFileSync(`${root}/supabase/tests/information_projection_hosted_rollback.sql`,'utf8').replace(/^begin;\r?$/m,''));
  assert.equal(result.at(-1).rows[0].result,'INFORMATION_SELLER_TO_NATIVE_PUBLIC_PRICE_ROLLBACK_PASS');
  console.log('EXACT_HOSTED_ROLLBACK_SCRIPT_LOCAL_PASS');
 }finally{await db.exec('rollback;reset role');}
}
