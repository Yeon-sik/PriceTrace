import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

export async function verifyInformationInbox(db, root) {
  const vectors = JSON.parse(readFileSync(`${root}/contracts/information-record.v1.cases.json`, "utf8"));
  const sample = vectors.accepted.find(entry => entry.record.owner_app === "pricetrace").record;
  const ownerA = "00000000-0000-4000-8000-000000000011";
  const ownerB = "00000000-0000-4000-8000-000000000022";
  const nativeCounts = () => db.query("select (select count(*) from public.catalog_products) catalog, (select count(*) from public.price_observations) prices, (select count(*) from public.purchase_price_sources) purchases");
  const originalCounts = await nativeCounts();
  let currentOwner;
  const auth = async owner => {
    currentOwner = owner;
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: owner })]);
    await db.exec("set role authenticated");
  };
  const ingest = text => db.query("select public.ingest_pricetrace_information_record_v1($1,$2::uuid) result", [text, currentOwner]);
  try {
    await auth(ownerA);
    for (const entry of vectors.accepted) {
      const { rows } = await db.query("select public.pricetrace_information_record_valid($1) valid", [JSON.stringify(entry.record)]);
      assert.equal(rows[0].valid, entry.record.owner_app === "pricetrace", entry.name);
    }
    for (const entry of vectors.rejected) {
      const record = { ...entry.record, owner_app: "pricetrace" };
      if (entry.record.record_type?.startsWith(`${entry.record.owner_app}.`)) record.record_type = entry.record.record_type.replace(/^[^.]+/, "pricetrace");
      const { rows } = await db.query("select public.pricetrace_information_record_valid($1) valid", [JSON.stringify(record)]);
      assert.equal(rows[0].valid, false, entry.name);
    }
    for (const invalid of [JSON.stringify(sample).replace('"nested":[', '"bad":NaN,"nested":['), JSON.stringify(sample).replace('"nested":[', '"deep":' + '['.repeat(65) + '0' + ']'.repeat(65) + ',"nested":[')]) {
      assert.equal((await db.query("select public.pricetrace_information_record_valid($1) valid", [invalid])).rows[0].valid, false);
    }
    const text = JSON.stringify(sample, null, 2).replace('"nested": [', '"huge": 90071992547409931234567890, "outsideNumeric": 1e999999, "nested": [');
    assert.equal((await ingest(text)).rows[0].result.duplicate, false);
    assert.equal((await ingest(text)).rows[0].result.duplicate, true);
    const reordered = '{"title":' + JSON.stringify(sample.title) + ',' + text.trim().slice(1).replace(/"title": "[^"]+",?\s*/, "");
    assert.equal((await ingest(reordered)).rows[0].result.duplicate, true, "whitespace and object key order are insignificant");
    const saved = (await db.query("select payload_text, state from public.pricetrace_information_inbox")).rows;
    assert.equal(saved.length, 1); assert.equal(saved[0].payload_text, text); assert.equal(saved[0].state, "pending");
    await assert.rejects(() => ingest(text.replace(sample.title, "changed title")), error => error.code === "23505");
    await assert.rejects(() => ingest(text.replace("90071992547409931234567890", "90071992547409931234567891")), error => error.code === "23505");
    await assert.rejects(() => ingest(text.replace("1e999999", "10e999998")), error => error.code === "23505");
    await assert.rejects(() => db.query("insert into public.pricetrace_information_inbox(user_id,record_id,payload_text) values($1,$2,$3)", [ownerA, "00000000-0000-4000-8000-000000000099", JSON.stringify({ ...sample, owner_app: "healthtrace" })]), error => error.code === "23514");
    await assert.rejects(() => db.query("update public.pricetrace_information_inbox set payload_text = $1", [text]), error => error.code === "42501");
    await assert.rejects(() => db.query("update public.pricetrace_information_inbox set user_id = $1", [ownerB]), error => error.code === "42501");
    await assert.rejects(() => db.exec("delete from public.pricetrace_information_inbox"), error => error.code === "42501");
    await db.exec("update public.pricetrace_information_inbox set state = 'reviewed'");
    assert.equal((await db.query("select state from public.pricetrace_information_inbox")).rows[0].state, "reviewed");
    await auth(ownerB);
    await assert.rejects(() => db.query("select public.ingest_pricetrace_information_record_v1($1,$2::uuid)", [text, ownerA]), error => error.code === "42501");
    assert.equal((await db.query("select count(*)::int count from public.pricetrace_information_inbox")).rows[0].count, 0);
    assert.equal((await db.exec("update public.pricetrace_information_inbox set state = 'archived'")).at(-1).affectedRows, 0);
    await assert.rejects(() => db.query("insert into public.pricetrace_information_inbox(user_id,record_id,payload_text) values($1,$2,$3)", [ownerA, sample.record_id, text]), error => error.code === "42501");
    assert.equal((await ingest(text)).rows[0].result.duplicate, false, "same source ID is independent per account");
    await db.exec("reset role; set role anon");
    await assert.rejects(() => ingest(text), error => error.code === "42501");
    await assert.rejects(() => db.exec("select * from public.pricetrace_information_inbox"), error => error.code === "42501");
    await db.exec("reset role");
    assert.deepEqual(await nativeCounts(), originalCounts, "inbox does not create native facts");
    console.log("INFORMATION_INBOX_CONFORMANCE_RLS_IMMUTABILITY_PRECISION_NATIVE_ISOLATION_PASS");
  } finally {
    await db.exec("reset role");
    await db.query("delete from public.pricetrace_information_inbox where record_id = $1", [sample.record_id]);
  }
}
