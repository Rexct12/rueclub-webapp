import { describe, expect, it } from "vitest";
import type { CourtMemberPackage, Session } from "@/lib/domain";
import { buildCourtMemberPackageUsageMap } from "@/lib/court-member-usage";

const pkg: CourtMemberPackage = {
  id: "pkg-1",
  purchaseDate: "2026-04-01",
  name: "Kaya Padel 3 Jam",
  venue: "Kaya Padel",
  totalHours: 3,
  totalAmount: 300000,
  expenseAccountId: "bca",
  notes: undefined,
  active: true,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  createdBy: "u1",
  updatedBy: "u1",
};

function makeSession(id: string, memberUsageHours: number, packageId = "pkg-1"): Session {
  return {
    id,
    date: "2026-04-01",
    time: "19:00",
    code: `KAYA-${id}`,
    venue: "Kaya Padel",
    defaultSlotPrice: 100000,
    courtPrice: 0,
    courtFree: false,
    courtExpenseAccountId: "bca",
    courtMemberPackageId: packageId,
    totalDurationHours: 2,
    memberUsageHours,
    active: true,
  };
}

describe("buildCourtMemberPackageUsageMap", () => {
  it("calculates used and remaining hours", () => {
    const map = buildCourtMemberPackageUsageMap([makeSession("s1", 1.5), makeSession("s2", 1)], [pkg]);
    expect(map.get("pkg-1")).toEqual({ usedHours: 2.5, remainingHours: 0.5 });
  });

  it("supports excluding a session when editing", () => {
    const map = buildCourtMemberPackageUsageMap([makeSession("s1", 2), makeSession("s2", 1)], [pkg], "s2");
    expect(map.get("pkg-1")).toEqual({ usedHours: 2, remainingHours: 1 });
  });

  it("clamps remaining hours at zero", () => {
    const map = buildCourtMemberPackageUsageMap([makeSession("s1", 3), makeSession("s2", 2)], [pkg]);
    expect(map.get("pkg-1")).toEqual({ usedHours: 5, remainingHours: 0 });
  });
});
