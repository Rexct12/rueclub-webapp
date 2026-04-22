import { describe, expect, it } from "vitest";
import { syncParticipantSlotPriceWithSessionDefault } from "@/lib/session-slot-sync";

describe("syncParticipantSlotPriceWithSessionDefault", () => {
  it("updates participant slotPrice when it still matches old default", () => {
    const result = syncParticipantSlotPriceWithSessionDefault(
      { slotPrice: 115000, discount: 5000, status: "Belum" },
      115000,
      125000,
    );

    expect(result).toEqual({
      shouldUpdate: true,
      slotPrice: 125000,
      discount: 5000,
      total: 120000,
    });
  });

  it("keeps manual override slotPrice unchanged when different from old default", () => {
    const result = syncParticipantSlotPriceWithSessionDefault(
      { slotPrice: 130000, discount: 0, status: "Lunas" },
      115000,
      125000,
    );

    expect(result).toEqual({
      shouldUpdate: false,
      slotPrice: 130000,
      discount: 0,
      total: 130000,
    });
  });

  it("updates free participant discount to follow synchronized slotPrice", () => {
    const result = syncParticipantSlotPriceWithSessionDefault(
      { slotPrice: 115000, discount: 115000, status: "Free" },
      115000,
      125000,
    );

    expect(result).toEqual({
      shouldUpdate: true,
      slotPrice: 125000,
      discount: 125000,
      total: 0,
    });
  });
});
