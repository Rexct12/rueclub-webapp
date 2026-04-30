import type { AppData } from "@/lib/domain";
import { buildDashboardReport } from "@/lib/reports";

function escapeCsvCell(value: unknown) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

export function exportCollectionCsv(type: string, data: AppData) {
  if (type === "participant-payments") {
    return toCsv(
      [
        "date",
        "playerName",
        "category",
        "sessionId",
        "slotPrice",
        "discount",
        "total",
        "status",
        "method",
        "accountId",
        "notes",
      ],
      data.participantPayments.map((row) => [
        row.date,
        row.playerName,
        row.category,
        row.sessionId,
        row.slotPrice,
        row.discount,
        row.total,
        row.status,
        row.method,
        row.accountId,
        row.notes,
      ]),
    );
  }

  if (type === "expenses") {
    return toCsv(
      ["date", "description", "category", "sessionId", "amount", "accountId", "intent", "notes", "reimbursed"],
      data.expenses.map((row) => [
        row.date,
        row.description,
        row.category,
        row.sessionId,
        row.amount,
        row.accountId,
        row.intent,
        row.notes,
        row.reimbursed,
      ]),
    );
  }

  if (type === "court-member-packages") {
    return toCsv(
      [
        "purchaseDate",
        "name",
        "venue",
        "totalHours",
        "totalAmount",
        "expenseAccountId",
        "notes",
        "active",
      ],
      data.courtMemberPackages.map((row) => [
        row.purchaseDate,
        row.name,
        row.venue,
        row.totalHours,
        row.totalAmount,
        row.expenseAccountId,
        row.notes,
        row.active,
      ]),
    );
  }

  if (type === "capital-deposits") {
    return toCsv(
      ["date", "description", "sessionId", "amount", "accountId", "sharingInvest"],
      data.capitalDeposits.map((row) => [
        row.date,
        row.description,
        row.sessionId,
        row.amount,
        row.accountId,
        row.sharingInvest,
      ]),
    );
  }

  if (type === "profit-sharings") {
    return toCsv(
      ["date", "sessionId", "recipientName", "role", "calculationType", "percentage", "baseAmount", "amount", "accountId", "notes"],
      data.profitSharings.map((row) => [
        row.date,
        row.sessionId,
        row.recipientName,
        row.role,
        row.calculationType,
        row.percentage,
        row.baseAmount,
        row.amount,
        row.accountId,
        row.notes,
      ]),
    );
  }

  if (type === "sessions") {
    return toCsv(
      [
        "date",
        "time",
        "code",
        "venue",
        "defaultSlotPrice",
        "courtPrice",
        "courtFree",
        "courtMemberPackageId",
        "totalDurationHours",
        "memberUsageHours",
        "active",
      ],
      data.sessions.map((row) => [
        row.date,
        row.time,
        row.code,
        row.venue,
        row.defaultSlotPrice,
        row.courtPrice,
        row.courtFree,
        row.courtMemberPackageId,
        row.totalDurationHours,
        row.memberUsageHours,
        row.active,
      ]),
    );
  }

  const report = buildDashboardReport(data);
  return toCsv(
    ["session", "date", "income", "discount", "netIncome", "costOfService", "profitBeforeSharing", "profitSharing", "profit", "slotSold"],
    report.sessionReports.map((row) => [
      row.code,
      row.date,
      row.income,
      row.discount,
      row.netIncome,
      row.costOfService,
      row.profitBeforeSharing,
      row.profitSharing,
      row.profit,
      row.slotSold,
    ]),
  );
}
