import { describe, expect, it } from "vitest";
import {
  apparelSizes,
  findApparelSizeByKr,
  parseOfficialApparelSize,
} from "./apparel-size";

describe("apparel size", () => {
  it("keeps the supported Korean size mapping explicit", () => {
    expect(apparelSizes.map((size) => size.label)).toEqual([
      "S(90)",
      "M(95)",
      "L(100)",
      "XL(105)",
      "XXL(110)",
      "XXXL(115)",
    ]);
  });

  it("parses only a supported official Korean apparel size", () => {
    expect(parseOfficialApparelSize("105")).toEqual({
      alpha: "XL",
      kr: 105,
      label: "XL(105)",
    });
    expect(parseOfficialApparelSize("size 110호")).toEqual(findApparelSizeByKr(110));
    expect(parseOfficialApparelSize("120")).toBeNull();
    expect(parseOfficialApparelSize("100ml")).toBeNull();
  });
});
