import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalInformationJson, parseInformationRecord, parseInformationRecordText, type InformationOwner } from "./information-record";

const cases = JSON.parse(readFileSync(new URL("../../contracts/information-record.v1.cases.json", import.meta.url), "utf8"));

describe("information-record.v1 conformance", () => {
  for (const entry of cases.accepted) it(`accepts ${entry.name}`, () => {
    expect(parseInformationRecord(entry.record, entry.record.owner_app)).toEqual(entry.record);
  });
  for (const entry of cases.rejected) it(`rejects ${entry.name}`, () => {
    expect(() => parseInformationRecord(entry.record, entry.record.owner_app as InformationOwner)).toThrow();
  });
  it("rejects a foreign owner at the receiving boundary", () => {
    expect(() => parseInformationRecord(cases.accepted[0].record, "pricetrace")).toThrow();
  });
  it("canonical equality ignores object ordering but preserves array order and decimal strings", () => {
    expect(canonicalInformationJson({ b: "12345678901234567890.0010", a: [false, null, ""] }))
      .toBe(canonicalInformationJson({ a: [false, null, ""], b: "12345678901234567890.0010" }));
    expect(canonicalInformationJson([1, 2])).not.toBe(canonicalInformationJson([2, 1]));
  });
  it("enforces encoded input size before parsing", () => {
    expect(() => parseInformationRecordText(" ".repeat(1048577), "pricetrace")).toThrow("1 MiB");
  });
  it("validates arbitrary JSON numbers without requiring machine-number precision", () => {
    const fixture = cases.accepted.find((entry: { record: { owner_app: string } }) => entry.record.owner_app === "pricetrace").record;
    const text = JSON.stringify(fixture).replace('"nested":[', '"huge":90071992547409931234567890,"outsideNumeric":1e999999,"nested":[');
    expect(() => parseInformationRecordText(text, "pricetrace")).not.toThrow();
    // The receiver exports text, not this parsed display projection.
    expect(text).toContain("90071992547409931234567890");
  });
  it("rejects non-JSON tokens and excessive nesting before recursive validation", () => {
    for (const token of ["NaN", "Infinity", "-Infinity", "+1", "01"]) expect(() => parseInformationRecordText(token, "pricetrace")).toThrow();
    expect(() => parseInformationRecordText("[".repeat(65) + "0" + "]".repeat(65), "pricetrace")).toThrow("64");
  });
});
