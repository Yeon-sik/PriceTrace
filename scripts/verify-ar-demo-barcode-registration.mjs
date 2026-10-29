import assert from "node:assert/strict";

// Called only with the disposable PGlite DB. Execute the actual operational SQL,
// including COMMIT; no remote connection or credentials are accepted here.
export async function verifyArDemoBarcodeRegistration(db, readSql) {
  const registration = readSql("operations", "register_ar_demo_barcodes_v1.sql");
  const snapshot = async () => (await db.query(`select * from public.catalog_product_identifiers
    where identifier_value in ('8801104671507', '8809375984692') order by identifier_scheme, identifier_value`)).rows;
  const rejectsWithoutChanges = async (message) => {
    const before = await snapshot();
    await assert.rejects(() => db.exec(registration), error => error.message.includes(message));
    await db.exec("rollback");
    assert.deepEqual(await snapshot(), before);
  };
  await db.exec(readSql("tests", "ar_demo_barcode_registration_setup.sql"));
  await db.exec(registration);
  const registered = await snapshot();
  assert.equal(registered.length, 2);
  assert.ok(registered.every(row => row.identifier_scheme === "ean" && row.verification_status === "verified"
    && row.provenance.source_type === "physical_package" && row.provenance.confirmed_by === "user"
    && row.reviewed_at && row.reviewed_by === null));
  assert.equal(registered[1].provenance.comparison_fields.brand, "Dr.Elizabeth's");
  await db.exec("set role anon");
  try {
    for (const row of registered) {
      const { rows } = await db.query("select public.get_public_product_by_barcode_v1($1) as payload", [row.identifier_value]);
      assert.equal(rows[0].payload.status, "matched");
      assert.equal(rows[0].payload.matches[0].catalogProductId, row.catalog_product_id);
    }
  } finally { await db.exec("reset role"); }

  await db.exec(registration);
  assert.deepEqual(await snapshot(), registered); // IDs, provenance and review timestamps untouched.

  // The first row would be inserted before the second-row failure: prove that
  // pending/rejected never get promoted and that both operations roll back.
  await db.exec("delete from public.catalog_product_identifiers where identifier_value = '8801104671507'");
  for (const status of ["pending", "rejected"]) {
    await db.query("update public.catalog_product_identifiers set verification_status = $1 where identifier_value = '8809375984692'", [status]);
    await rejectsWithoutChanges("pending/rejected review");
  }
  await db.exec("update public.catalog_product_identifiers set verification_status = 'verified' where identifier_value = '8809375984692'");
  await db.exec(`insert into public.catalog_product_identifiers(catalog_product_id, identifier_scheme, identifier_value, verification_status)
    values ('18e83c5c-86a4-4e95-a131-411381789687', 'gtin', '8801104671507', 'verified')`);
  await rejectsWithoutChanges("different target");
  await db.exec(`update public.catalog_product_identifiers set catalog_product_id = '1516c3eb-3dfb-4e11-8040-d23fadcdaad0'
    where identifier_scheme = 'gtin' and identifier_value = '8801104671507'`);
  await db.exec(registration);
  assert.equal((await snapshot()).length, 3); // Compatible verified GTIN + new EAN.
  const { rows } = await db.query("select public.get_public_product_by_barcode_v1('8801104671507') as payload");
  assert.equal(rows[0].payload.matches.length, 1);

  await db.exec("update public.catalog_products set package_count = 2 where id = '18e83c5c-86a4-4e95-a131-411381789687'");
  await rejectsWithoutChanges("identity/specification is missing, changed, or not public");
  await db.exec("update public.catalog_products set package_count = 1 where id = '18e83c5c-86a4-4e95-a131-411381789687'");
  console.log("AR_DEMO_REGISTRATION_PASS checks=8 (two inserts, anon IDs, replay, pending rollback, rejected rollback, cross-scheme conflict, compatible GTIN, specification drift)");
}
