import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { RestaurantProfileRepository } from "./restaurant-profile.repository";

describe("RestaurantProfileRepository", () => {
  it("explains how to recover from a JWT clock-skew error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "JWT issued at future" },
    });
    const repository = new RestaurantProfileRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.read()).rejects.toThrow(
      /시스템 시간이 Supabase 서버보다 느려.*FitnessApp의 식당·메뉴 공개 상태 문제는 아닙니다/u,
    );
  });
});
