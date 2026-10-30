import { describe, expect, it } from "vitest";
import { formatObservationDate, formatObservationDateTime, observationTimePositions } from "./observation-date";

describe("observation date display", () => {
  it("keeps published date-only facts without time-zone reinterpretation", () => {
    expect(formatObservationDate("2026-07-14")).toBe("2026.07.14");
    expect(formatObservationDateTime("2026-07-14")).toBe("2026.07.14");
    expect(formatObservationDate("2025-12-03")).toBe("2025.12.03");
  });

  it("shows timestamps in Asia/Seoul and adds a time only when the source has one", () => {
    expect(formatObservationDate("2026-07-30T13:44:00.000Z")).toBe("2026.07.30");
    expect(formatObservationDateTime("2026-07-30T13:44:00.000Z")).toBe("2026.07.30 22:44");
    expect(formatObservationDate("2026-07-30T16:30:00.000Z")).toBe("2026.07.31");
  });

  it("leaves invalid or missing values missing", () => {
    expect(formatObservationDate("")).toBeNull();
    expect(formatObservationDate("2026-02-30")).toBeNull();
    expect(formatObservationDate("not a date")).toBeNull();
    expect(formatObservationDateTime("2026/07/14")).toBeNull();
  });
});

describe("observation time positions", () => {
  it("places observations proportionally to their dates", () => {
    const [first, middle, last] = observationTimePositions(["2026-05-08", "2026-06-12", "2026-07-14"]);
    expect(first).toBe(0);
    expect(middle).toBeCloseTo(35 / 67);
    expect(last).toBe(1);
  });

  it("shares a position for same-day observations and centers a single distinct date", () => {
    expect(observationTimePositions(["2026-06-12", "2026-06-12"])).toEqual([0.5, 0.5]);
    expect(observationTimePositions(["2026-06-12"])).toEqual([0.5]);
    expect(observationTimePositions(["2026-05-08", "2026-06-12", "2026-06-12"]).slice(1)).toEqual([1, 1]);
  });

  it("does not invent positions for invalid dates", () => {
    expect(observationTimePositions(["bad", "2026-06-12", "2026-07-14"])).toEqual([null, 0, 1]);
    expect(observationTimePositions(["bad"])).toEqual([null]);
  });
});
