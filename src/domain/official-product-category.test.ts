import { describe, expect, it } from "vitest";
import {
  buildExistingProductCategoryIndex,
  classifyOfficialProduct,
  normalizeOfficialProductMatchName,
} from "./official-product-category";

describe("official product category", () => {
  it("uses an existing classified product before curated PX rules", () => {
    const index = buildExistingProductCategoryIndex([{ productName: "더위사냥 커피" }]);

    expect(classifyOfficialProduct({
      sourceProductCode: "existing-match",
      sourceNameRaw: "더위사냥 커피",
    }, index)).toEqual({
      category: "간식",
      assignment: {
        method: "existing_product_match",
        basis: "더위사냥 커피",
      },
    });
  });

  it("does not inherit an existing unclassified result", () => {
    const index = buildExistingProductCategoryIndex([{ productName: "밀키스제로" }]);

    expect(classifyOfficialProduct({
      sourceProductCode: "curated-rule",
      sourceNameRaw: "밀키스제로",
    }, index)).toMatchObject({
      category: "음료",
      assignment: { method: "curated_rule", basis: "beverages-and-alcohol" },
    });
  });

  it("keeps meaningful option text while ignoring the PX location prefix", () => {
    expect(normalizeOfficialProductMatchName("(영외)국산콩 순두부")).toBe(normalizeOfficialProductMatchName("국산콩 순두부"));
    expect(normalizeOfficialProductMatchName("비트 트리플액션 2.8L(드럼)")).not.toBe(normalizeOfficialProductMatchName("비트 트리플액션 2.8L(일반)"));
  });

  it("classifies representative PX products into the existing category set", () => {
    const index = new Map();
    const classify = (sourceNameRaw: string) => classifyOfficialProduct({
      sourceProductCode: sourceNameRaw,
      sourceNameRaw,
    }, index)?.category;

    expect(classify("나무젓가락")).toBe("주방용품");
    expect(classify("스낵면")).toBe("간식");
    expect(classify("국산콩 순두부")).toBe("신선식품");
    expect(classify("밀키스제로")).toBe("음료");
    expect(classify("비트 트리플액션 세탁세제")).toBe("생활용품");
    expect(classify("비비고 한우사골곰탕")).toBe("식품");
  });

  it("does not classify products from incidental keyword substrings", () => {
    const index = new Map();
    const classify = (sourceNameRaw: string) => classifyOfficialProduct({
      sourceProductCode: sourceNameRaw,
      sourceNameRaw,
    }, index)?.category;

    expect(classify("스프라이트제로 500ml")).toBe("음료");
    expect(classify("스타벅스더블샷에스프레소")).toBe("음료");
    expect(classify("베지밀팩(A.B)")).toBe("음료");
    expect(classify("스파이시치킨샌드위치")).toBe("식품");
    expect(classify("약과도넛")).toBe("간식");
    expect(classify("밀카 타블렛 스트로베리")).toBe("간식");
    expect(classify("로얄크랩")).toBe("식품");
    expect(classify("일품홍삼 앰플")).toBe("식품");
    expect(classify("스카이보틀 화이트레인 퍼퓸 핸드크림")).toBe("생활용품");
    expect(classify("잠스트 리스트 랩")).toBe("생활용품");
    expect(classify("버터플라이BIRIBA라켓")).toBe("생활용품");
  });

  it("records an auditable source-code override for opaque official names", () => {
    const result = classifyOfficialProduct({
      sourceProductCode: "36982",
      sourceNameRaw: "짜라란",
    }, new Map());

    expect(result).toEqual({
      category: "신선식품",
      assignment: {
        method: "curated_rule",
        basis: "source-code-override:packaged-eggs",
      },
    });
  });
});
