import type { ParticipantPayment } from "@/lib/domain";

type SyncSlotPriceResult = {
  shouldUpdate: boolean;
  slotPrice: number;
  discount: number;
  total: number;
};

export function syncParticipantSlotPriceWithSessionDefault(
  payment: Pick<ParticipantPayment, "slotPrice" | "discount" | "status">,
  oldDefaultSlotPrice: number,
  newDefaultSlotPrice: number,
): SyncSlotPriceResult {
  const shouldUpdate = payment.slotPrice === oldDefaultSlotPrice && oldDefaultSlotPrice !== newDefaultSlotPrice;
  if (!shouldUpdate) {
    return {
      shouldUpdate: false,
      slotPrice: payment.slotPrice,
      discount: payment.discount,
      total: payment.status === "Free" ? 0 : Math.max(0, payment.slotPrice - payment.discount),
    };
  }

  const discount = payment.status === "Free" ? newDefaultSlotPrice : payment.discount;
  const total = payment.status === "Free" ? 0 : Math.max(0, newDefaultSlotPrice - discount);

  return {
    shouldUpdate: true,
    slotPrice: newDefaultSlotPrice,
    discount,
    total,
  };
}
