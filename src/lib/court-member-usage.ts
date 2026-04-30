import type { CourtMemberPackage, Session } from "@/lib/domain";

export type CourtMemberPackageUsage = {
  usedHours: number;
  remainingHours: number;
};

export function buildCourtMemberPackageUsageMap(
  sessions: Session[],
  courtMemberPackages: CourtMemberPackage[],
  excludeSessionId?: string,
) {
  const usedHoursByPackageId = new Map<string, number>();

  for (const row of sessions) {
    if (excludeSessionId && row.id === excludeSessionId) continue;
    if (!row.courtMemberPackageId) continue;

    const usedHours = Number.isFinite(row.memberUsageHours) ? Math.max(0, row.memberUsageHours) : 0;
    usedHoursByPackageId.set(
      row.courtMemberPackageId,
      (usedHoursByPackageId.get(row.courtMemberPackageId) ?? 0) + usedHours,
    );
  }

  const usageMap = new Map<string, CourtMemberPackageUsage>();
  for (const pkg of courtMemberPackages) {
    const usedHours = usedHoursByPackageId.get(pkg.id) ?? 0;
    const remainingHours = Math.max(0, pkg.totalHours - usedHours);
    usageMap.set(pkg.id, { usedHours, remainingHours });
  }

  return usageMap;
}
