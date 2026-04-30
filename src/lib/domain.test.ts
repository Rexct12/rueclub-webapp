import { describe, expect, it } from "vitest";
import { sessionInputSchema } from "@/lib/domain";

describe("sessionInputSchema legacy duration compatibility", () => {
  const baseSession = {
    date: "2026-04-30",
    time: "19:00",
    code: "RUE-001",
    venue: "Court A",
    defaultSlotPrice: 0,
    courtPrice: 0,
    courtFree: false,
    courtExpenseAccountId: undefined,
    courtMemberPackageId: undefined,
    memberUsageHours: 0,
    active: true,
  };

  it("fallbacks totalDurationHours to 1 when legacy value is 0", () => {
    const parsed = sessionInputSchema.parse({
      ...baseSession,
      totalDurationHours: 0,
    });

    expect(parsed.totalDurationHours).toBe(1);
  });

  it("fallbacks totalDurationHours to 1 when legacy value is empty", () => {
    const parsed = sessionInputSchema.parse({
      ...baseSession,
      totalDurationHours: "",
    });

    expect(parsed.totalDurationHours).toBe(1);
  });
});
